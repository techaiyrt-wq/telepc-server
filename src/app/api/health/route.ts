import { sql } from "drizzle-orm";

import { db } from "@/db";
import { hostingInfo } from "@/lib/hosting";

export const dynamic = "force-dynamic";

/**
 * Saúde do hub. O núcleo (emparelhar, comandos, espelho) funciona SEM base de
 * dados — ela só guarda histórico. Por isso devolvemos sempre `ok: true` se o
 * servidor responde; o estado da base de dados vai como informação extra.
 */
export async function GET() {
  let database = false;
  try {
    await db.execute(sql`select 1`);
    database = true;
  } catch {
    database = false;
  }

  const hosting = hostingInfo();
  return Response.json(
    { ok: true, database, serverless: hosting.serverless, platform: hosting.platform },
    { headers: { "Cache-Control": "no-store" } },
  );
}
