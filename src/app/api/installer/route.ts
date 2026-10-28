import { readAgentSource } from "@/lib/agentSource";
import { getPairingToken } from "@/lib/auth";
import { buildInstaller, installerFilename, type InstallerOs } from "@/lib/installers";
import { hubCandidates } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseOs(value: string | null): InstallerOs {
  const raw = (value || "windows").toLowerCase();
  if (raw === "macos" || raw === "mac") return "macos";
  if (raw === "linux") return "linux";
  return "windows";
}

async function payload(request: Request) {
  const url = new URL(request.url);
  const os = parseOs(url.searchParams.get("os"));
  const token = (url.searchParams.get("token") || (await getPairingToken())).trim().toUpperCase();
  const extra = (url.searchParams.get("hub") || "").split(",").map((v) => v.trim()).filter(Boolean);
  const hubs = [...new Set([...extra, ...hubCandidates(request)])];
  const script = buildInstaller(os, hubs, token, await readAgentSource());
  return { os, token, hubs, script };
}

/**
 * Entrega o instalador com o agente já lá dentro (não precisa de segundo
 * download). `application/octet-stream` para o Safari aceitar guardar.
 */
export async function GET(request: Request) {
  const { os, script } = await payload(request);
  const url = new URL(request.url);

  if (url.searchParams.get("format") === "text") {
    return new Response(script, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return new Response(script, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(Buffer.byteLength(script, "utf8")),
      "Content-Disposition": `attachment; filename="${installerFilename(os)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function HEAD(request: Request) {
  const { os, script } = await payload(request);
  return new Response(null, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(Buffer.byteLength(script, "utf8")),
      "Content-Disposition": `attachment; filename="${installerFilename(os)}"`,
      "Cache-Control": "no-store",
    },
  });
}
