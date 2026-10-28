import { randomUUID } from "node:crypto";
import os from "node:os";

import { hub } from "@/lib/hub";
import { verifyPairingToken, issueDeviceToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RegisterBody {
  token?: string;
  deviceId?: string;
  name?: string;
  platform?: string;
  osRelease?: string;
  arch?: string;
  agentVersion?: string;
  screenWidth?: number;
  screenHeight?: number;
  cpuCount?: number;
  totalMemoryMb?: number;
}

/** The agent calls this once on boot to pair with the hub. */
export async function POST(request: Request) {
  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  if (!(await verifyPairingToken(body.token))) {
    return Response.json({ ok: false, error: "Código de emparelhamento errado" }, { status: 401 });
  }

  const id = body.deviceId?.trim() || randomUUID();
  const device = {
    id,
    name: body.name?.trim() || os.hostname() || "O meu PC",
    platform: body.platform || "unknown",
    osRelease: body.osRelease ?? null,
    arch: body.arch ?? null,
    agentVersion: body.agentVersion ?? null,
    screenWidth: body.screenWidth ?? null,
    screenHeight: body.screenHeight ?? null,
    cpuCount: body.cpuCount ?? os.cpus().length,
    totalMemoryMb: body.totalMemoryMb ?? Math.round(os.totalmem() / 1048576),
  };

  const deviceToken = issueDeviceToken(id);
  hub.merge(id, device);
  await hub.persistPresence({ ...device, token: deviceToken }, true);

  return Response.json({
    ok: true,
    deviceId: id,
    deviceToken,
    hubTime: Date.now(),
    pollWaitMs: 8000,
  });
}
