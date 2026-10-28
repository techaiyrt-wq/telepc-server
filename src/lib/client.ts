"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CommandResult, CommandType, DevicePresence, HubEvent, LogEntry } from "@/lib/protocol";

export interface SendResponse {
  ok: boolean;
  result?: CommandResult;
  error?: string;
}

/** Awaits the PC's answer (use for anything that returns data). */
export async function send(
  deviceId: string,
  type: CommandType,
  payload: Record<string, unknown> = {},
  options: { wait?: boolean; timeoutMs?: number } = {},
): Promise<SendResponse> {
  try {
    const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload, wait: options.wait ?? true, timeoutMs: options.timeoutMs }),
    });
    const json = (await res.json()) as SendResponse;
    return { ok: res.ok && json.ok === true, result: json.result, error: json.error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "falha de rede" };
  }
}

// Fila ordenada, mas com coalescência: movimentos chegam dezenas de vezes por
// segundo; guardar posições antigas faz o cursor continuar a mexer depois do
// dedo parar. Mantemos só a posição mais recente entre ações importantes.
interface FireJob {
  deviceId: string;
  type: CommandType;
  payload: Record<string, unknown>;
}
const fireQueue: FireJob[] = [];
let fireBusy = false;
const COALESCE_TYPES = new Set<CommandType>(["move", "dragMove"]);

async function drainFireQueue() {
  if (fireBusy) return;
  fireBusy = true;
  while (fireQueue.length > 0) {
    const job = fireQueue.shift()!;
    try {
      await fetch(`/api/devices/${encodeURIComponent(job.deviceId)}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: job.type, payload: job.payload, wait: false }),
        keepalive: true,
      });
    } catch {
      /* o evento seguinte volta a tentar a ligação */
    }
  }
  fireBusy = false;
}

/** Fire-and-forget para rato/gestos, com ordem preservada e sem atraso acumulado. */
export function fire(deviceId: string, type: CommandType, payload: Record<string, unknown> = {}) {
  if (COALESCE_TYPES.has(type)) {
    const last = fireQueue.at(-1);
    if (last?.deviceId === deviceId && last.type === type) fireQueue[fireQueue.length - 1] = { deviceId, type, payload };
    else fireQueue.push({ deviceId, type, payload });
  } else if (type === "scroll") {
    const last = fireQueue.at(-1);
    if (last?.deviceId === deviceId && last.type === "scroll") {
      const previous = last.payload;
      fireQueue[fireQueue.length - 1] = {
        deviceId,
        type,
        payload: {
          dx: Number(previous.dx ?? 0) + Number(payload.dx ?? 0),
          dy: Number(previous.dy ?? 0) + Number(payload.dy ?? 0),
        },
      };
    } else fireQueue.push({ deviceId, type, payload });
  } else {
    fireQueue.push({ deviceId, type, payload });
  }
  // Uma fila muito cheia indica rede lenta: movimentos já foram coalescidos;
  // preservamos apenas as 80 ações mais recentes.
  if (fireQueue.length > 80) fireQueue.splice(0, fireQueue.length - 80);
  void drainFireQueue();
}

export interface FrameInfo {
  version: number;
  /** Resolução realmente transmitida. */
  width: number;
  height: number;
  screenWidth?: number;
  screenHeight?: number;
  ts: number;
  bytes?: number;
  captureMs?: number;
  quality?: number;
  scale?: number;
}

export interface HubState {
  connected: boolean;
  devices: Record<string, DevicePresence>;
  frames: Record<string, FrameInfo>;
  logs: LogEntry[];
  results: Record<string, CommandResult>;
}

/** Subscribes to the server-sent event feed from the hub. */
export function useHub(deviceId?: string): HubState {
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<Record<string, DevicePresence>>({});
  const [frames, setFrames] = useState<Record<string, FrameInfo>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [results, setResults] = useState<Record<string, CommandResult>>({});
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      const source = new EventSource("/api/stream");
      sourceRef.current = source;
      source.onopen = () => !disposed && setConnected(true);
      source.onerror = () => {
        if (disposed) return;
        setConnected(false);
      };
      source.onmessage = (event) => {
        if (disposed) return;
        let message: HubEvent;
        try {
          message = JSON.parse(event.data) as HubEvent;
        } catch {
          return;
        }
        setConnected(true);
        if (message.kind === "hello") {
          setDevices((prev) => {
            const next = { ...prev };
            for (const device of message.devices) next[device.id] = { ...next[device.id], ...device };
            return next;
          });
        } else if (message.kind === "device") {
          setDevices((prev) => ({ ...prev, [message.device.id]: { ...prev[message.device.id], ...message.device } }));
        } else if (message.kind === "frame") {
          setFrames((prev) => ({
            ...prev,
            [message.deviceId]: {
              version: message.version,
              width: message.width,
              height: message.height,
              screenWidth: message.screenWidth,
              screenHeight: message.screenHeight,
              ts: message.ts,
              bytes: message.bytes,
              captureMs: message.captureMs,
              quality: message.quality,
              scale: message.scale,
            },
          }));
        } else if (message.kind === "result") {
          setResults((prev) => ({ ...prev, [message.result.id]: message.result }));
        } else if (message.kind === "log") {
          setLogs((prev) => [message.entry, ...prev].slice(0, 120));
        }
      };
    };

    connect();
    const recycler = setInterval(() => {
      sourceRef.current?.close();
      connect();
    }, 4 * 60 * 1000);

    return () => {
      disposed = true;
      clearInterval(recycler);
      sourceRef.current?.close();
    };
  }, []);

  // Seed the log feed from Postgres so history survives reloads.
  useEffect(() => {
    let alive = true;
    const url = deviceId ? `/api/logs?deviceId=${encodeURIComponent(deviceId)}&limit=60` : "/api/logs?limit=60";
    fetch(url)
      .then((res) => res.json())
      .then((json: { entries?: LogEntry[] }) => {
        if (alive && Array.isArray(json.entries)) {
          setLogs((prev) => {
            const seen = new Set(prev.map((entry) => entry.id));
            const merged = [...prev, ...json.entries!.filter((entry) => !seen.has(entry.id))];
            return merged.sort((a, b) => b.createdAt - a.createdAt).slice(0, 120);
          });
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [deviceId]);

  return useMemo(() => ({ connected, devices, frames, logs, results }), [connected, devices, frames, logs, results]);
}

export function useDeviceList(initial: DevicePresence[] = []) {
  const [devices, setDevices] = useState<DevicePresence[]>(initial);
  const [loading, setLoading] = useState(initial.length === 0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      const json = (await res.json()) as { devices?: DevicePresence[] };
      setDevices(json.devices ?? []);
    } catch {
      /* the SSE feed will fill this in */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { devices, setDevices, loading, refresh };
}

export function usePairToken() {
  const [token, setToken] = useState<string>("");
  const [origin, setOrigin] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/pair", { cache: "no-store" });
      const json = (await res.json()) as { token?: string; origin?: string };
      if (json.token) setToken(json.token);
      if (json.origin) setOrigin(json.origin);
    } catch {
      /* ignore */
    }
  }, []);

  const rotate = useCallback(async () => {
    try {
      const res = await fetch("/api/pair", { method: "POST" });
      const json = (await res.json()) as { token?: string };
      if (json.token) setToken(json.token);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
    const interval = setInterval(() => void refresh(), 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { token, origin, rotate, refresh };
}

export interface Toast {
  id: number;
  text: string;
  tone: "ok" | "warn" | "danger";
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = ++seq.current;
    setToasts((prev) => [...prev, { id, text, tone }].slice(-3));
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 2600);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((toast) => toast.id !== id)), []);
  return { toasts, push, dismiss };
}

export function screenUrl(deviceId: string, version: number) {
  return `/api/devices/${encodeURIComponent(deviceId)}/screen?v=${version}`;
}

export function relativeTime(ts?: number | null) {
  if (!ts) return "nunca";
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 5000) return "agora";
  if (diff < 60000) return `há ${Math.round(diff / 1000)}s`;
  if (diff < 3600000) return `há ${Math.round(diff / 60000)}m`;
  if (diff < 86400000) return `há ${Math.round(diff / 3600000)}h`;
  return new Date(ts).toLocaleDateString("pt-PT");
}

export const PLATFORM_META: Record<string, { label: string; emoji: string }> = {
  win32: { label: "Windows", emoji: "🪟" },
  windows: { label: "Windows", emoji: "🪟" },
  darwin: { label: "macOS", emoji: "🍎" },
  macos: { label: "macOS", emoji: "🍎" },
  linux: { label: "Linux", emoji: "🐧" },
  unknown: { label: "Desconhecido", emoji: "🖥️" },
};

export function platformMeta(platform?: string | null) {
  return PLATFORM_META[String(platform ?? "unknown").toLowerCase()] ?? PLATFORM_META.unknown;
}
