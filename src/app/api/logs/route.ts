import { hub } from "@/lib/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Activity trail of everything the phone did to the PC. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 60) || 60, 300);
  const entries = await hub.recentLogs(deviceId, limit);
  return Response.json({ ok: true, entries }, { headers: { "Cache-Control": "no-store" } });
}
