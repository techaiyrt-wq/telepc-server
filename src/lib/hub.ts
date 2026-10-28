import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { commandLogs, devices } from "@/db/schema";
import type {
  Command,
  CommandResult,
  CommandType,
  DevicePresence,
  HubEvent,
} from "@/lib/protocol";

/** How long an agent long-poll stays open before returning empty. */
export const POLL_WAIT_MS = 8000;
/** A device is considered online while it holds an open poll or pinged recently. */
const ONLINE_WINDOW_MS = 9000;

interface QueuedCommand {
  command: Command;
  queuedAt: number;
}

interface ResultWaiter {
  resolve: (result: CommandResult) => void;
  timer: NodeJS.Timeout;
}

interface ScreenFrame {
  buffer: Buffer;
  /** Dimensões do JPEG enviado. */
  width: number;
  height: number;
  /** Dimensões físicas do monitor. */
  screenWidth?: number;
  screenHeight?: number;
  version: number;
  ts: number;
  contentType: string;
  bytes?: number;
  captureMs?: number;
  quality?: number;
  scale?: number;
}

interface InFlightCommand {
  command: Command;
  sentAt: number;
  attempts: number;
}

interface DeviceState {
  presence: DevicePresence;
  queue: QueuedCommand[];
  /** Delivered to a poll response but not yet confirmed by a result. */
  inFlight: Map<string, InFlightCommand>;
  pollWaiters: Array<() => void>;
  streamingUntil: number;
}

export interface ConnectionAttempt {
  id: number;
  at: number;
  name: string;
  platform: string;
  hostname?: string;
  hub?: string;
  status: number;
  detail: string;
  tokenPrefix?: string;
  agentVersion?: string;
  ip?: string;
}

type HubGlobal = typeof globalThis & { __telepcHub?: TeleHub };

class TeleHub {
  private states = new Map<string, DeviceState>();
  private waiters = new Map<string, ResultWaiter>();
  private screens = new Map<string, ScreenFrame>();
  private listeners = new Set<(event: HubEvent) => void>();
  private lastDbSync = new Map<string, number>();
  private attempts: ConnectionAttempt[] = [];
  private attemptSeq = 0;

  private state(deviceId: string): DeviceState {
    let state = this.states.get(deviceId);
    if (!state) {
      state = {
        presence: {
          id: deviceId,
          name: deviceId,
          platform: "unknown",
          online: false,
          polling: false,
          streaming: false,
        },
        queue: [],
        inFlight: new Map(),
        pollWaiters: [],
        streamingUntil: 0,
      };
      this.states.set(deviceId, state);
    }
    return state;
  }

  // ---------------------------------------------------------------- presence

  merge(deviceId: string, patch: Partial<DevicePresence>): DevicePresence {
    const state = this.state(deviceId);
    state.presence = { ...state.presence, ...patch, id: deviceId, lastSeenAt: Date.now() };
    state.presence.online = true;
    this.emit({ kind: "device", device: this.presence(deviceId) });
    return this.presence(deviceId);
  }

  presence(deviceId: string): DevicePresence {
    const state = this.state(deviceId);
    const lastSeen = state.presence.lastSeenAt ?? 0;
    return {
      ...state.presence,
      polling: state.pollWaiters.length > 0 || state.queue.length > 0,
      online:
        state.pollWaiters.length > 0 || Date.now() - lastSeen < ONLINE_WINDOW_MS,
      streaming: Date.now() < state.streamingUntil,
    };
  }

  listPresences(): DevicePresence[] {
    return [...this.states.keys()].map((id) => this.presence(id));
  }

  // ------------------------------------------------------- diagnóstico

  /** Guarda as tentativas de ligação falhadas para a app as poder explicar. */
  recordAttempt(attempt: Omit<ConnectionAttempt, "id" | "at">): ConnectionAttempt {
    const entry: ConnectionAttempt = { ...attempt, id: ++this.attemptSeq, at: Date.now() };
    this.attempts = [entry, ...this.attempts].slice(0, 20);
    return entry;
  }

  recentAttempts(): ConnectionAttempt[] {
    return this.attempts;
  }

  isOnline(deviceId: string): boolean {
    return this.states.has(deviceId) && this.presence(deviceId).online;
  }

  // ------------------------------------------------------------------ frames

  setFrame(deviceId: string, frame: Omit<ScreenFrame, "version">): number {
    const previous = this.screens.get(deviceId);
    const version = (previous?.version ?? 0) + 1;
    this.screens.set(deviceId, { ...frame, version });
    const state = this.state(deviceId);
    state.streamingUntil = Date.now() + 12000;
    this.emit({
      kind: "frame",
      deviceId,
      version,
      width: frame.width,
      height: frame.height,
      screenWidth: frame.screenWidth,
      screenHeight: frame.screenHeight,
      ts: frame.ts,
      bytes: frame.bytes ?? frame.buffer.byteLength,
      captureMs: frame.captureMs,
      quality: frame.quality,
      scale: frame.scale,
    });
    return version;
  }

  getFrame(deviceId: string): ScreenFrame | undefined {
    return this.screens.get(deviceId);
  }

  keepStreamAlive(deviceId: string, ms = 12000) {
    this.state(deviceId).streamingUntil = Date.now() + ms;
  }

  // --------------------------------------------------------------- commands

  async dispatch(
    deviceId: string,
    type: CommandType,
    payload: Record<string, unknown> = {},
    options: { wait?: boolean; timeoutMs?: number; source?: string; log?: boolean } = {},
  ): Promise<CommandResult> {
    const { wait = true, timeoutMs = 12000, source = "phone", log = true } = options;
    if (!this.isOnline(deviceId)) {
      throw new DeviceOfflineError(deviceId);
    }

    const command: Command = {
      id: randomUUID(),
      type,
      payload,
      createdAt: Date.now(),
    };

    const started = Date.now();
    const promise = wait ? this.waitForResult(command.id, timeoutMs) : null;

    const state = this.state(deviceId);
    const queuedAt = Date.now();

    // Rato em tempo real: antes do agente fazer o próximo poll podem chegar
    // várias posições. Só a mais recente interessa; isto reduz o atraso sem
    // alterar a ordem de dragStart/click/dragEnd.
    const last = state.queue.at(-1);
    if ((type === "move" || type === "dragMove") && last?.command.type === type) {
      state.queue[state.queue.length - 1] = { command, queuedAt };
    } else if (type === "scroll" && last?.command.type === "scroll") {
      const oldPayload = last.command.payload ?? {};
      command.payload = {
        dx: Number(oldPayload.dx ?? 0) + Number(payload.dx ?? 0),
        dy: Number(oldPayload.dy ?? 0) + Number(payload.dy ?? 0),
      };
      state.queue[state.queue.length - 1] = { command, queuedAt };
    } else {
      state.queue.push({ command, queuedAt });
    }
    // A fila nunca cresce indefinidamente numa ligação lenta.
    if (state.queue.length > 160) state.queue.splice(0, state.queue.length - 160);
    const waiters = state.pollWaiters.splice(0, state.pollWaiters.length);
    for (const wake of waiters) wake();

    if (!promise) {
      return { id: command.id, ok: true, data: { queued: true }, ms: 0 };
    }

    try {
      const result = await promise;
      if (log) await this.writeLog(deviceId, command, result, source);
      return result;
    } catch (error) {
      const result: CommandResult = {
        id: command.id,
        ok: false,
        error: error instanceof Error ? error.message : "timeout",
        ms: Date.now() - started,
      };
      if (log) await this.writeLog(deviceId, command, result, source);
      return result;
    }
  }

  private waitForResult(commandId: string, timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(commandId);
        reject(new Error(`Tempo limite excedido (${timeoutMs}ms) — o PC não respondeu.`));
      }, timeoutMs);
      this.waiters.set(commandId, { resolve, timer });
    });
  }

  /**
   * Called by the agent's long-poll. Delivery is at-least-once: a batch stays
   * "in flight" until the agent reports its results, so a dropped connection
   * never swallows a tap. Each command is retried at most once and expires
   * after 30s, so an old click is never replayed out of context.
   */
  takeCommands(deviceId: string, waitMs = POLL_WAIT_MS, signal?: AbortSignal): Promise<Command[]> {
    const state = this.state(deviceId);

    const rescue = (): Command[] => {
      const now = Date.now();
      const recovered: Command[] = [];
      for (const [id, entry] of state.inFlight) {
        if (now - entry.sentAt > 30000 || entry.attempts >= 2) {
          state.inFlight.delete(id);
          continue;
        }
        entry.attempts += 1;
        entry.sentAt = now;
        recovered.push(entry.command);
      }
      return recovered;
    };

    const drain = (): Command[] => {
      const fresh = state.queue.splice(0, state.queue.length).map((item) => item.command);
      const now = Date.now();
      for (const command of fresh) {
        state.inFlight.set(command.id, { command, sentAt: now, attempts: 1 });
      }
      return fresh;
    };

    if (signal?.aborted) return Promise.resolve([]);

    const recovered = rescue();
    if (recovered.length > 0 || state.queue.length > 0) {
      return Promise.resolve([...recovered, ...drain()]);
    }

    return new Promise<Command[]>((resolve) => {
      let settled = false;
      const finish = (aborted: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const index = state.pollWaiters.indexOf(wake);
        if (index >= 0) state.pollWaiters.splice(index, 1);
        resolve(aborted ? [] : drain());
      };
      const wake = () => finish(false);
      const onAbort = () => finish(true);
      const timer = setTimeout(wake, waitMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      state.pollWaiters.push(wake);
      this.emit({ kind: "device", device: this.presence(deviceId) });
    });
  }

  submitResults(deviceId: string, results: CommandResult[]) {
    const state = this.state(deviceId);
    for (const result of results) {
      // Confirmado pelo PC: já não precisa de ser reenviado.
      state.inFlight.delete(result.id);
      const waiter = this.waiters.get(result.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.waiters.delete(result.id);
        waiter.resolve(result);
      }
      this.emit({ kind: "result", deviceId, result, type: "agent" });
    }
  }

  // ------------------------------------------------------------------- logs

  private async writeLog(
    deviceId: string,
    command: Command,
    result: CommandResult,
    source: string,
  ) {
    const entry = {
      id: command.id,
      deviceId,
      type: command.type,
      payload: command.payload ?? null,
      ok: result.ok,
      error: result.error ?? null,
      durationMs: result.ms ?? Date.now() - command.createdAt,
      source,
      createdAt: Date.now(),
    };
    this.emit({ kind: "log", deviceId, entry });
    // Never let logging break a control command.
    db.insert(commandLogs)
      .values({
        id: entry.id,
        deviceId,
        type: entry.type,
        payload: entry.payload,
        ok: entry.ok,
        error: entry.error,
        durationMs: entry.durationMs,
        source,
      })
      .catch(() => undefined);
  }

  /** Throttled persistence of presence so the DB reflects who is connected. */
  async persistPresence(device: {
    id: string;
    name: string;
    platform: string;
    token: string;
    osRelease?: string | null;
    arch?: string | null;
    agentVersion?: string | null;
    screenWidth?: number | null;
    screenHeight?: number | null;
    cpuCount?: number | null;
    totalMemoryMb?: number | null;
  }, force = false) {
    const now = new Date();
    const last = this.lastDbSync.get(device.id) ?? 0;
    if (!force && last > 0 && now.getTime() - last < 20000) return;
    this.lastDbSync.set(device.id, now.getTime());
    try {
      await db
        .insert(devices)
        .values({ ...device, lastSeenAt: now, createdAt: now })
        .onConflictDoUpdate({
          target: devices.id,
          set: {
            name: device.name,
            platform: device.platform,
            token: device.token || undefined,
            osRelease: device.osRelease,
            arch: device.arch,
            agentVersion: device.agentVersion,
            screenWidth: device.screenWidth,
            screenHeight: device.screenHeight,
            cpuCount: device.cpuCount,
            totalMemoryMb: device.totalMemoryMb,
            lastSeenAt: now,
          },
        });
    } catch {
      // The hub stays usable even if the database is briefly unavailable.
    }
  }

  async knownDevices(): Promise<DevicePresence[]> {
    try {
      const rows = await db.select().from(devices).orderBy(desc(devices.lastSeenAt)).limit(50);
      const byId = new Map<string, (typeof rows)[number] | undefined>(
        rows.map((row) => [row.id, row]),
      );
      for (const presence of this.listPresences()) {
        if (!byId.has(presence.id)) byId.set(presence.id, undefined);
      }
      const merged: DevicePresence[] = [];
      for (const [id, row] of byId) {
        if (!row) {
          merged.push(this.presence(id));
          continue;
        }
        merged.push({
          ...this.presence(id),
          id,
          name: row.name,
          platform: row.platform,
          osRelease: row.osRelease,
          arch: row.arch,
          agentVersion: row.agentVersion,
          screenWidth: row.screenWidth ?? this.presence(id).screenWidth,
          screenHeight: row.screenHeight ?? this.presence(id).screenHeight,
          cpuCount: row.cpuCount,
          totalMemoryMb: row.totalMemoryMb,
          lastSeenAt: row.lastSeenAt ? row.lastSeenAt.getTime() : null,
        });
      }
      return merged.sort((a, b) => Number(b.online) - Number(a.online));
    } catch {
      return this.listPresences();
    }
  }

  async recentLogs(deviceId?: string, limit = 60) {
    try {
      const rows = await db
        .select()
        .from(commandLogs)
        .where(deviceId ? eq(commandLogs.deviceId, deviceId) : undefined)
        .orderBy(desc(commandLogs.createdAt))
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        deviceId: row.deviceId,
        type: row.type,
        payload: row.payload,
        ok: row.ok,
        error: row.error,
        durationMs: row.durationMs,
        source: row.source,
        createdAt: row.createdAt.getTime(),
      }));
    } catch {
      return [];
    }
  }

  // --------------------------------------------------------------------- sse

  subscribe(listener: (event: HubEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: HubEvent) {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }
}

export class DeviceOfflineError extends Error {
  constructor(public deviceId: string) {
    super("O PC não está ligado ao hub neste momento.");
    this.name = "DeviceOfflineError";
  }
}

const globalHub = globalThis as HubGlobal;
export const hub = globalHub.__telepcHub ?? (globalHub.__telepcHub = new TeleHub());
