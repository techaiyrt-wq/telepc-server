import { hub } from "@/lib/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BOUNDARY = "telepc-frame";
const encoder = new TextEncoder();

/**
 * MJPEG contínuo: o browser mantém um único pedido aberto e cada frame segue
 * assim que chega do PC. Elimina o ciclo SSE → novo GET → nova imagem.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastVersion = 0;

      const writeFrame = () => {
        if (closed || (controller.desiredSize ?? 1) < 0) return;
        const frame = hub.getFrame(id);
        if (!frame || frame.version === lastVersion) return;
        lastVersion = frame.version;
        const head =
          `--${BOUNDARY}\r\n` +
          `Content-Type: ${frame.contentType}\r\n` +
          `Content-Length: ${frame.buffer.byteLength}\r\n` +
          `X-Frame-Version: ${frame.version}\r\n` +
          `X-Frame-Time: ${frame.ts}\r\n\r\n`;
        try {
          controller.enqueue(encoder.encode(head));
          controller.enqueue(new Uint8Array(frame.buffer));
          controller.enqueue(encoder.encode("\r\n"));
        } catch {
          closed = true;
        }
      };

      // Mostra imediatamente o frame atual e depois só os novos deste PC.
      writeFrame();
      const unsubscribe = hub.subscribe((event) => {
        if (event.kind === "frame" && event.deviceId === id) writeFrame();
      });

      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, no-transform",
      Pragma: "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
