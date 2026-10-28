import { getPairingToken, rotatePairingToken } from "@/lib/auth";
import { hub } from "@/lib/hub";
import { hubOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pairing code shown on the phone and typed into the PC agent. */
export async function GET(request: Request) {
  const token = await getPairingToken();
  const origin = hubOrigin(request);
  return Response.json(
    {
      ok: true,
      token,
      origin,
      onlineDevices: hub.listPresences().filter((device) => device.online).length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST() {
  const token = await rotatePairingToken();
  return Response.json({ ok: true, token }, { headers: { "Cache-Control": "no-store" } });
}
