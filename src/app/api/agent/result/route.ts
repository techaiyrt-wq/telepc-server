import { hub } from "@/lib/hub";
import { verifyDeviceToken } from "@/lib/auth";
import type { CommandResult } from "@/lib/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResultBody {
  deviceId?: string;
  deviceToken?: string;
  results?: CommandResult[];
  presence?: {
    name?: string;
    platform?: string;
    screenWidth?: number;
    screenHeight?: number;
    battery?: { level: number; charging: boolean };
    stats?: {
      cpuLoad?: number;
      freeMemoryMb?: number;
      uptimeSeconds?: number;
      activeWindow?: string;
    };
  };
}

/** Agent → hub: command results plus a lightweight presence heartbeat. */
export async function POST(request: Request) {
  let body: ResultBody;
  try {
    body = (await request.json()) as ResultBody;
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const { deviceId, deviceToken } = body;
  if (!deviceId || !(await verifyDeviceToken(deviceId, deviceToken ?? null))) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  if (body.presence) hub.merge(deviceId, body.presence);
  else hub.merge(deviceId, {});

  if (Array.isArray(body.results) && body.results.length > 0) {
    hub.submitResults(deviceId, body.results);
  }

  return Response.json({ ok: true });
}
