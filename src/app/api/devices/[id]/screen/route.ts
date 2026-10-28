import { hub } from "@/lib/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves the latest screen frame captured by the agent. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const frame = hub.getFrame(id);

  if (!frame) {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  return new Response(new Uint8Array(frame.buffer), {
    headers: {
      "Content-Type": frame.contentType,
      "Cache-Control": "no-store, max-age=0",
      "X-Frame-Version": String(frame.version),
      "X-Frame-Width": String(frame.width),
      "X-Frame-Height": String(frame.height),
      "X-Screen-Width": String(frame.screenWidth ?? 0),
      "X-Screen-Height": String(frame.screenHeight ?? 0),
      "X-Capture-Ms": String(frame.captureMs ?? 0),
      "X-Frame-Bytes": String(frame.bytes ?? frame.buffer.byteLength),
    },
  });
}
