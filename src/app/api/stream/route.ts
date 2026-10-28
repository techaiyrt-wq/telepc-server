import { hub } from "@/lib/hub";
import type { HubEvent } from "@/lib/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-Sent Events feed that powers the live phone UI. */
export async function GET(request: Request) {
  const initialDevices = await hub.knownDevices();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: HubEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const unsubscribe = hub.subscribe(send);
      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keep-alive ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, 15000);

      send({ kind: "hello", devices: initialDevices });

      const cleanup = () => {
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // The request abort signal fires when the phone closes the EventSource.
      request.signal.addEventListener("abort", cleanup, { once: true });
      const recycler = setTimeout(cleanup, 5 * 60 * 1000);
      if (typeof recycler.unref === "function") recycler.unref();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
