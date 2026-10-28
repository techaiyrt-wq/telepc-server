import { readFile } from "node:fs/promises";
import path from "node:path";

/** Código-fonte do agente, lido do disco (sem cache: muda em cada build). */
export async function readAgentSource(): Promise<string> {
  return readFile(path.join(process.cwd(), "public", "agent", "pc-agent.js"), "utf8");
}
