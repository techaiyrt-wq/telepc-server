import { hub, POLL_WAIT_MS } from "@/lib/hub";
import { verifyDeviceToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Long-poll: the agent asks for work and the hub answers as soon as the phone
 * enqueues a command (or after POLL_WAIT_MS, which doubles as a heartbeat).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId");
  const deviceToken = url.searchParams.get("deviceToken") ?? request.headers.get("x-device-token");

  if (!deviceId || !(await verifyDeviceToken(deviceId, deviceToken))) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const waitMs = Math.min(Number(url.searchParams.get("wait") ?? POLL_WAIT_MS) || POLL_WAIT_MS, POLL_WAIT_MS);
  const commands = await hub.takeCommands(deviceId, waitMs, request.signal);

  return Response.json(
    { ok: true, commands, serverTime: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
