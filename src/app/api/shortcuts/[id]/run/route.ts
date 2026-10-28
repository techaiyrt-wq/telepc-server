import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shortcuts } from "@/db/schema";
import { DeviceOfflineError, hub } from "@/lib/hub";
import type { CommandType } from "@/lib/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Step {
  type: CommandType;
  payload?: Record<string, unknown>;
  delayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Executes a saved macro: each step is dispatched to the PC in order. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: { deviceId?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  let row;
  try {
    const rows = await db.select().from(shortcuts).where(eq(shortcuts.id, id)).limit(1);
    row = rows[0];
  } catch {
    row = undefined;
  }
  if (!row) return Response.json({ ok: false, error: "Atalho não encontrado" }, { status: 404 });

  const deviceId = body.deviceId || row.deviceId;
  if (!deviceId) {
    return Response.json({ ok: false, error: "Escolhe um PC de destino" }, { status: 400 });
  }
  if (!hub.isOnline(deviceId)) {
    return Response.json({ ok: false, error: "O PC está desligado ou sem o agente a correr" }, { status: 409 });
  }

  const steps = (row.steps as Step[]) ?? [];
  const executed: { type: string; ok: boolean; error?: string }[] = [];

  for (const step of steps) {
    try {
      const result = await hub.dispatch(deviceId, step.type, step.payload ?? {}, {
        wait: true,
        timeoutMs: 10000,
        source: `macro:${row.name}`,
      });
      executed.push({ type: step.type, ok: result.ok, error: result.error });
    } catch (error) {
      if (error instanceof DeviceOfflineError) {
        return Response.json({ ok: false, error: error.message, executed }, { status: 409 });
      }
      executed.push({
        type: step.type,
        ok: false,
        error: error instanceof Error ? error.message : "erro",
      });
    }
    if (step.delayMs) await sleep(step.delayMs);
  }

  return Response.json({ ok: executed.every((step) => step.ok), executed });
}
