/**
 * Deteta onde o hub está a correr.
 *
 * O TelePC precisa de um servidor **sempre ligado e numa só instância**: o
 * espelho do ecrã (MJPEG), os comandos (long-poll) e a presença (SSE) vivem em
 * memória e exigem ligações longas. Plataformas "serverless" como a Vercel
 * criam uma cópia nova por pedido e cortam ligações longas — por isso o PC liga
 * e é logo desligado ("Sessão expirada" em ciclo).
 */
export interface HostingInfo {
  serverless: boolean;
  platform: string | null;
  hasSharedSecret: boolean;
  /** true quando dá para usar o espelho + comandos em tempo real. */
  realtimeOk: boolean;
  warning: string | null;
}

export function hostingInfo(): HostingInfo {
  const vercel = Boolean(process.env.VERCEL);
  const netlify = Boolean(process.env.NETLIFY);
  const lambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  const cfPages = Boolean(process.env.CF_PAGES);
  const serverless = vercel || netlify || lambda || cfPages;

  const platform = vercel
    ? "Vercel"
    : netlify
      ? "Netlify"
      : lambda
        ? "AWS Lambda"
        : cfPages
          ? "Cloudflare Pages"
          : null;

  const hasSharedSecret = Boolean(process.env.TELEPC_SECRET);

  return {
    serverless,
    platform,
    hasSharedSecret,
    realtimeOk: !serverless,
    warning: serverless
      ? `Este servidor (${platform ?? "serverless"}) não consegue manter o ecrã ao vivo nem os comandos em tempo real: cada pedido vai para uma cópia diferente do servidor. Aloja o TelePC num servidor sempre-ligado (Render, Railway ou Fly.io) para funcionar.`
      : null,
  };
}
