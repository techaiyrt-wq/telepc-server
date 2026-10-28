import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { shortcuts } from "@/db/schema";
import type { CommandType } from "@/lib/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: CommandType[] = [
  "click",
  "move",
  "scroll",
  "type",
  "key",
  "hotkey",
  "window",
  "launch",
  "shell",
  "system",
  "volume",
  "media",
  "clipboard",
  "screenshot",
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId");
  try {
    const rows = deviceId
      ? await db
          .select()
          .from(shortcuts)
          .where(eq(shortcuts.deviceId, deviceId))
          .orderBy(desc(shortcuts.createdAt))
      : await db.select().from(shortcuts).orderBy(desc(shortcuts.createdAt));
    return Response.json({ ok: true, shortcuts: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: true, shortcuts: [] });
  }
}

interface Step {
  type: CommandType;
  payload?: Record<string, unknown>;
  delayMs?: number;
}

export async function POST(request: Request) {
  let body: { name?: string; emoji?: string; deviceId?: string | null; steps?: Step[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const name = body.name?.trim();
  const steps = Array.isArray(body.steps) ? body.steps : [];
  if (!name) return Response.json({ ok: false, error: "Indica um nome" }, { status: 400 });
  if (steps.length === 0) {
    return Response.json({ ok: false, error: "Adiciona pelo menos um passo" }, { status: 400 });
  }
  const cleanSteps = steps
    .filter((step) => ALLOWED.includes(step?.type))
    .map((step) => ({
      type: step.type,
      payload: (step.payload ?? {}) as Record<string, unknown>,
      delayMs: Math.min(Math.max(Number(step.delayMs ?? 0) || 0, 0), 10000),
    }));
  if (cleanSteps.length === 0) {
    return Response.json({ ok: false, error: "Nenhum passo válido" }, { status: 400 });
  }

  const row = {
    id: randomUUID(),
    deviceId: body.deviceId ?? null,
    name,
    emoji: body.emoji?.trim() || "⚡",
    steps: cleanSteps,
    createdAt: new Date(),
  };

  try {
    await db.insert(shortcuts).values(row);
  } catch {
    return Response.json({ ok: false, error: "Falha ao guardar o atalho" }, { status: 500 });
  }
  return Response.json({ ok: true, shortcut: row });
}


