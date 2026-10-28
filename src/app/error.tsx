"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error("TelePC:", error);
  }, [error]);

  return (
    <main className="app-shell mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-5 text-center">
      <div className="text-5xl">😵</div>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Algo falhou aqui</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mist-400">
          A ligação com o PC pode ter caído a meio. Tenta outra vez — os comandos antigos não são repetidos.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <button type="button" onClick={reset} className="btn btn-primary !py-3">
          ⟳ Tentar outra vez
        </button>
        <Link href="/" className="btn !py-3">
          🏠 Voltar aos meus computadores
        </Link>
      </div>
    </main>
  );
}
