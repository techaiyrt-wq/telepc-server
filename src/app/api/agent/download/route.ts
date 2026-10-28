import { readAgentSource } from "@/lib/agentSource";
import { getPairingToken } from "@/lib/auth";
import { configureAgent } from "@/lib/installers";
import { hubCandidates } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Entrega o agente já com os endereços do hub e o código lá dentro. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("token")?.trim().toUpperCase();
  const token = requested || (await getPairingToken());
  const extra = (url.searchParams.get("hub") || "").split(",").map((v) => v.trim()).filter(Boolean);
  const hubs = [...new Set([...extra, ...hubCandidates(request)])];

  let source: string;
  try {
    source = await readAgentSource();
  } catch {
    return new Response("Nao encontrei o agente no servidor. Descarrega em /agent/pc-agent.js.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const configured = configureAgent(source, hubs, token);

  if (url.searchParams.get("format") === "text") {
    return new Response(configured, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return new Response(configured, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(Buffer.byteLength(configured, "utf8")),
      "Content-Disposition": 'attachment; filename="pc-agent.js"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
