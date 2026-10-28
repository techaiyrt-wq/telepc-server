import { getPairingToken } from "@/lib/auth";
import { hostingInfo } from "@/lib/hosting";
import { hub } from "@/lib/hub";
import { hubCandidates, hubOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tudo o que a app precisa para diagnosticar a ligação de um PC. */
export async function GET(request: Request) {
  const origin = hubOrigin(request);

  const devices = await hub.knownDevices();
  return Response.json(
    {
      ok: true,
      origin,
      candidates: hubCandidates(request),
      pairingToken: await getPairingToken(),
      devices,
      attempts: hub.recentAttempts(),
      hosting: hostingInfo(),
      serverTime: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
