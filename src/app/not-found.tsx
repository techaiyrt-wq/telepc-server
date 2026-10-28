import Link from "next/link";

export default function NotFound() {
  return (
    <main className="app-shell mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-5 text-center">
      <div className="text-5xl">🧭</div>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Esta página não existe</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mist-400">
          O endereço pode estar incompleto ou ser de uma versão antiga da app. Os teus computadores estão no painel.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Link href="/" className="btn btn-primary !py-3">
          🏠 Ir para os meus computadores
        </Link>
        <Link href="/install" className="btn !py-3">
          🔌 Ligar um PC
        </Link>
        <Link href="/install-mobile" className="btn !py-3">
          📲 Instalar a app no telemóvel
        </Link>
      </div>
    </main>
  );
}
