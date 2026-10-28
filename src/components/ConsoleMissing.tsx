"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useHub } from "@/lib/client";
import type { DevicePresence } from "@/lib/protocol";

/**
 * Recuperação quando o PC indicado no endereço não existe (servidor
 * reiniciado, base de dados nova ou link antigo). Em vez de um 404, explica o
 * que aconteceu e — se o PC voltar a ligar — entra sozinho.
 */
export default function ConsoleMissing({ deviceId }: { deviceId: string }) {
  const hub = useHub(deviceId);
  const [known, setKnown] = useState<DevicePresence[]>([]);
  const shortId = deviceId.length > 14 ? `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}` : deviceId;

  const live = (
    <a
      href={`/console/${deviceId}`}
      className="btn btn-primary w-full !py-3"
    >
      ⚡ O teu PC voltou a ligar — entrar agora
    </a>
  );

  const presence = hub.devices[deviceId];
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/devices", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { devices?: DevicePresence[] };
        setKnown(data.devices ?? []);
      } catch {
        /* ignore */
      }
    };
    const first = setTimeout(load, 0);
    const interval = setInterval(load, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  const candidates = known.filter((device) => device.online);

  return (
    <main className="app-shell mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 pb-16 pt-4">
      <header className="flex items-center gap-3">
        <Link href="/" className="btn btn-ghost !min-h-0 !px-2.5 !py-2 text-lg" aria-label="Voltar">
          ‹
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] font-extrabold tracking-tight">PC não encontrado</h1>
          <p className="mono text-[10.5px] text-mist-600">id {shortId}</p>
        </div>
        <span className="chip !border-warn-400/40 !text-warn-400">offline</span>
      </header>

      {presence?.online && live}

      <div className="card card-glow p-5">
        <div className="flex items-start gap-3">
          <span className="text-3xl">🔌</span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold">Este endereço já não corresponde a um PC ligado</h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-mist-300">
              Acontece quando o servidor foi reiniciado ou o PC foi removido. O teu computador continua a funcionar
              normalmente — só precisa de se voltar a ligar à app.
            </p>
          </div>
        </div>

        {candidates.length > 0 && (
          <div className="mt-4">
            <p className="label mb-2">Estes PCs estão ligados agora</p>
            <div className="flex flex-col gap-2">
              {candidates.map((device) => (
                <a
                  key={device.id}
                  href={`/console/${device.id}`}
                  className="card-flat flex items-center gap-3 border-go-400/35 p-3 active:scale-[0.98]"
                >
                  <span className="dot dot-on pulse" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{device.name}</span>
                    <span className="mono block truncate text-[10px] text-go-400">ligado e pronto</span>
                  </span>
                  <span className="btn btn-primary !min-h-0 !px-3 !py-1.5 text-[11.5px]">Abrir ›</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <Link href="/install" className="btn btn-primary w-full !py-3">
            ⬇ Religar este PC
          </Link>
          <Link href="/" className="btn w-full">
            🏠 Ver os meus computadores
          </Link>
        </div>
      </div>

      <p className="text-center text-[11px] leading-relaxed text-mist-500">
        Dica: instala o TelePC no ecrã principal do telemóvel. Assim abres sempre o link atualizado, em vez de um
        endereço antigo.
      </p>
      <Link href="/install-mobile" className="btn btn-ghost w-full text-[12px]">
        📲 Como instalar no telemóvel
      </Link>
    </main>
  );
}
