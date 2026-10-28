import { hub } from "@/lib/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HelloBody {
  name?: string;
  platform?: string;
  hostname?: string;
  hub?: string;
  status?: number;
  detail?: string;
  tokenPrefix?: string;
  agentVersion?: string;
}

/**
 * Beacon público: o agente avisa o hub sempre que NÃO consegue emparelhar.
 * Assim o telemóvel consegue dizer «o teu PC chegou aqui mas o código estava
 * errado» em vez de ficar só à espera para sempre.
 */
export async function POST(request: Request) {
  let body: HelloBody = {};
  try {
    body = (await request.json()) as HelloBody;
  } catch {
    body = {};
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined;

  const attempt = hub.recordAttempt({
    name: (body.name || "PC sem nome").slice(0, 80),
    platform: (body.platform || "unknown").slice(0, 40),
    hostname: body.hostname?.slice(0, 80),
    hub: body.hub?.slice(0, 200),
    status: Number(body.status) || 0,
    detail: (body.detail || "tentativa de ligação").slice(0, 240),
    tokenPrefix: body.tokenPrefix?.slice(0, 6),
    agentVersion: body.agentVersion?.slice(0, 20),
    ip,
  });

  return Response.json({ ok: true, attemptId: attempt.id }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return Response.json({ ok: true, attempts: hub.recentAttempts() }, { headers: { "Cache-Control": "no-store" } });
}
