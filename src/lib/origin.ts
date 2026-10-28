/**
 * Endereços públicos do hub.
 *
 * Atrás do proxy da plataforma o pedido chega como http, mas o endereço que o
 * PC tem de usar é https. Além disso, nesta plataforma o domínio muda a cada
 * reconstrução — por isso devolvemos *vários* candidatos (o que o telemóvel
 * usa, o do sandbox e um fixo opcional) e o PC experimenta todos.
 */
export function hubOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || url.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);

  const isLocal =
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(host) ||
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host);

  let proto: string;
  if (forwardedProto === "https" || isPrivate) {
    proto = forwardedProto === "https" ? "https" : url.protocol.replace(":", "");
  } else if (isLocal) {
    proto = url.protocol.replace(":", "");
  } else {
    proto = "https";
  }

  const cleanHost = host.startsWith("0.0.0.0") ? host.replace("0.0.0.0", "127.0.0.1") : host;
  return `${proto}://${cleanHost}`.replace(/\/+$/, "");
}

/** Endereço do sandbox (E2B) onde este servidor está a correr, se existir. */
export function sandboxOrigin(): string | null {
  const id = process.env.E2B_SANDBOX_ID;
  if (!id) return null;
  const port = process.env.PORT || "3000";
  return `https://${port}-${id}.e2b.app`;
}

/** Lista única e ordenada de endereços que o PC deve experimentar. */
export function hubCandidates(request: Request): string[] {
  const list = [
    process.env.PUBLIC_HUB_URL?.trim().replace(/\/+$/, "") || "",
    hubOrigin(request),
    sandboxOrigin() || "",
  ].filter(Boolean);
  return [...new Set(list)];
}
