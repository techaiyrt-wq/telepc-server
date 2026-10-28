import { hub } from "@/lib/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All PCs known to the hub (live presence merged with the database). */
export async function GET() {
  const devices = await hub.knownDevices();
  return Response.json(
    { ok: true, devices, serverTime: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
