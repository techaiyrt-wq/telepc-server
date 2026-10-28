import { hub, DeviceOfflineError } from "@/lib/hub";
import type { CommandType } from "@/lib/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: CommandType[] = [
  "ping",
  "screenshot",
  "stream",
  "move",
  "click",
  "dragStart",
  "dragMove",
  "dragEnd",
  "scroll",
  "type",
  "key",
  "hotkey",
  "windows",
  "window",
  "apps",
  "launch",
  "shell",
  "system",
  "volume",
  "media",
  "clipboard",
];

/** Phone → hub → PC. Fire-and-forget for pointer streams, awaited otherwise. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: { type?: string; payload?: Record<string, unknown>; wait?: boolean; timeoutMs?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const type = body.type as CommandType;
  if (!ALLOWED.includes(type)) {
    return Response.json({ ok: false, error: `Comando desconhecido: ${String(body.type)}` }, { status: 400 });
  }

  if (type === "stream" && (body.payload as { on?: boolean } | undefined)?.on) {
    hub.keepStreamAlive(id, 15000);
  }

  try {
    const result = await hub.dispatch(id, type, body.payload ?? {}, {
      wait: body.wait ?? true,
      timeoutMs: Math.min(body.timeoutMs ?? 12000, 60000),
    });
    return Response.json({ ok: result.ok, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DeviceOfflineError) {
      return Response.json({ ok: false, error: error.message }, { status: 409 });
    }
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 },
    );
  }
}
