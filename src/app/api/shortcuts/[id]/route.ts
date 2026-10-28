import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shortcuts } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    await db.delete(shortcuts).where(eq(shortcuts.id, id));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Falha ao remover" }, { status: 500 });
  }
}
