"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Btn, Chip, Empty, Panel, Pill, Sheet, Stat, ToastStack } from "@/components/ui";
import { explainAttempt, type Attempt } from "@/lib/attempts";
import { platformMeta, relativeTime, useDeviceList, useHub, usePairToken, useToasts } from "@/lib/client";
import type { DevicePresence } from "@/lib/protocol";
import { haptic, useCopy, useOrigin, useStandalone } from "@/lib/ux";

export default function Dashboard({ initialDevices = [] }: { initialDevices?: DevicePresence[] }) {
  const { devices: list, loading, refresh } = useDeviceList(initialDevices);
  const hub = useHub();
  const { token, origin } = usePairToken();
  const { toasts, push, dismiss } = useToasts();
  const { copied, copy } = useCopy();
  const standalone = useStandalone();
  const [about, setAbout] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const browserOrigin = useOrigin();
  const hubUrl = browserOrigin || (origin.includes("0.0.0.0") ? "" : origin);

  useEffect(() => {
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Diagnóstico: se o PC tentou ligar e falhou, dizemos exatamente porquê.
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const res = await fetch("/api/diagnostics", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { attempts?: Attempt[] };
        if (active) setAttempt(data.attempts?.[0] ?? null);
      } catch {
        /* ignore */
      }
    };
    const first = setTimeout(check, 0);
    const interval = setInterval(check, 8000);
    return () => {
      active = false;
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  // A presença em tempo real (SSE) manda sobre o retrato da base de dados.
  const allDevices = useMemo(() => {
    const merged = new Map<string, (typeof list)[number]>();
    for (const device of list) merged.set(device.id, device);
    for (const [id, device] of Object.entries(hub.devices)) {
      merged.set(id, { ...(merged.get(id) ?? device), ...device });
    }
    return [...merged.values()]
      .filter((device) => Boolean(device.id))
      .sort((a, b) => Number(b.online) - Number(a.online));
  }, [list, hub.devices]);

  const online = allDevices.filter((device) => device.online);
  const hasAny = allDevices.length > 0;

  return (
    <div className="app-shell mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-20 pt-3">
      <ToastStack toasts={toasts} dismiss={dismiss} />

      {/* ------------------------------------------------------------ header */}
      <header className="flex items-start justify-between gap-3 pt-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📡</span>
            <h1 className="text-[26px] font-extrabold tracking-tight">
                Tele<span className="gradient-text">PC</span>
            </h1>
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-mist-500">
            O teu computador na palma da mão: vê o ecrã, clica, escreve e fecha o que quiseres.
          </p>
        </div>
        <button type="button" onClick={() => setAbout(true)} className="chip !px-3 shrink-0">
          <span className={`dot ${hub.connected ? "dot-on" : "dot-off pulse"}`} />
          {hub.connected ? "Online" : "A ligar"}
        </button>
      </header>

      {/* --------------------------------------------- estado de onboarding */}
      {!hasAny && (
        <Link href="/install" className="card card-glow relative overflow-hidden p-5 active:scale-[0.99]">
          <div className="absolute -right-8 -top-10 text-[120px] leading-none opacity-[0.06]">🖥️</div>
          <Pill tone="info">Começa aqui</Pill>
          <h2 className="mt-3 text-[19px] font-extrabold leading-tight">Ligar o teu primeiro PC</h2>
          <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-mist-300">
            São 3 passos simples: descarregar um ficheiro, copiar um comando e colá-lo no computador. Eu aviso-te
            quando estiver ligado.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <span className="btn btn-primary flex-1">Abrir assistente</span>
            <span className="hint-arrow text-xl text-signal-300">›</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip>⏱️ 2 minutos</Chip>
            <Chip>🧩 Sem instalação</Chip>
            <Chip>🪟 🍎 🐧 Todos os sistemas</Chip>
          </div>
        </Link>
      )}

      {/* ------------------------------------- o PC tentou ligar e falhou */}
      {attempt && online.length === 0 && (
        <div className="card rise border-warn-400/35 bg-warn-400/5 p-4">
          <div className="flex items-start gap-2.5">
            <span className="text-lg">⚠️</span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[13.5px] font-bold text-warn-400">
                O teu PC tentou ligar e não conseguiu
              </h2>
              <p className="mt-1 text-[11.5px] leading-relaxed text-mist-300">{explainAttempt(attempt)}</p>
              <p className="mono mt-1.5 text-[10px] text-mist-600">
                {attempt.name} · {new Date(attempt.at).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Link href="/install" className="btn btn-primary flex-1 !py-2.5 text-[12.5px]">
              Resolver agora
            </Link>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- resumo rápido */}
      {hasAny && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="PCs ligados" value={`${online.length}/${allDevices.length}`} tone={online.length ? "ok" : "warn"} />
          <Stat label="Comandos hoje" value={hub.logs.length} />
          <Stat label="Hub" value={hub.connected ? "ativo" : "a ligar"} tone={hub.connected ? "ok" : "warn"} />
        </div>
      )}

      {/* ------------------------------------------------------- lista de PCs */}
      <Panel
        title="Os meus computadores"
        icon="🖥️"
        hint={hasAny ? "Toca num PC para o comandar." : undefined}
        action={
          <button
            type="button"
            onClick={() => {
              haptic("soft");
              void refresh();
            }}
            className="chip !px-3 !py-1.5 text-[10.5px]"
          >
            ⟳
          </button>
        }
      >
        {loading && !hasAny ? (
          <div className="card-flat shimmer h-24" />
        ) : !hasAny ? (
          <Empty
            emoji="🔌"
            title="Nenhum PC emparelhado"
            hint="Assim que correres o agente no computador, ele aparece aqui automaticamente."
            action={
              <Link href="/install" className="btn btn-primary">
                Ver como ligar
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {allDevices.map((device) => {
              const meta = platformMeta(device.platform);
              const cpu = device.stats?.cpuLoad ?? 0;
              return (
                <li key={device.id}>
                  <Link
                    href={`/console/${device.id}`}
                    onClick={() => haptic("tap")}
                    className={`card-flat block p-4 transition active:scale-[0.985] ${
                      device.online ? "border-go-400/30" : "opacity-75"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border text-xl ${
                          device.online ? "border-go-400/40 bg-go-500/12" : "border-line bg-ink-800"
                        }`}
                      >
                        {meta.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-[15px] font-bold">{device.name}</h3>
                          <span className={`dot ${device.online ? "dot-on pulse" : "dot-off"}`} />
                        </div>
                        <p className="mono mt-0.5 truncate text-[10.5px] text-mist-500">
                          {meta.label}
                          {device.screenWidth ? ` · ${device.screenWidth}×${device.screenHeight}` : ""}
                        </p>
                        <p className="mt-1 truncate text-[11.5px]">
                          {device.online ? (
                            <span className="text-go-400">
                              pronto a receber ordens
                              {device.streaming ? " · a transmitir ecrã" : ""}
                            </span>
                          ) : (
                            <span className="text-mist-500">desligado · visto {relativeTime(device.lastSeenAt)}</span>
                          )}
                        </p>
                      </div>
                      <span className={`btn !min-h-0 shrink-0 !px-3 !py-2 text-[12px] ${device.online ? "btn-primary" : ""}`}>
                        {device.online ? "Comandar" : "Abrir"}
                      </span>
                    </div>

                    {device.online && (
                      <>
                        {device.stats?.activeWindow && (
                          <div className="mt-3 flex items-center gap-2 rounded-xl border border-line-soft bg-ink-950/50 px-3 py-2">
                            <span className="text-xs">🪟</span>
                            <span className="truncate text-[11px] text-mist-300">{device.stats.activeWindow}</span>
                          </div>
                        )}
                        <div className="mt-2.5 grid grid-cols-3 gap-2">
                          <Stat label="CPU" value={`${cpu}%`} tone={cpu > 80 ? "bad" : cpu > 50 ? "warn" : "ok"} />
                          <Stat label="RAM livre" value={`${device.stats?.freeMemoryMb ?? 0} MB`} />
                          <Stat label="Ligado há" value={formatUptime(device.stats?.uptimeSeconds)} />
                        </div>
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* --------------------------------------------- o que podes fazer */}
      {hasAny && (
        <Panel title="O que podes fazer" hint="Tudo isto está dentro de cada PC." icon="✨">
          <div className="grid grid-cols-2 gap-2">
            {[
              { emoji: "🖥️", title: "Ver o ecrã", text: "Toca onde queres clicar" },
              { emoji: "🖱️", title: "Trackpad", text: "Move o rato com o dedo" },
              { emoji: "⌨️", title: "Escrever", text: "Teclado e atalhos" },
              { emoji: "🪟", title: "Janelas", text: "Focar, minimizar, fechar" },
              { emoji: "🎛️", title: "Programas", text: "Abrir, volume, desligar" },
              { emoji: "⚡", title: "Macros", text: "Várias ações num toque" },
            ].map((item) => (
              <div key={item.title} className="card-flat flex items-start gap-2.5 p-3">
                <span className="text-lg leading-none">{item.emoji}</span>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-bold">{item.title}</p>
                  <p className="truncate text-[10.5px] text-mist-500">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* ---------------------------------------------------- atividade */}
      {hub.logs.length > 0 && (
        <Panel title="Atividade recente" hint="Registo de tudo o que enviaste." icon="📜">
          <ul className="flex flex-col gap-1.5">
            {hub.logs.slice(0, 6).map((entry) => (
              <li key={entry.id} className="card-flat flex items-center gap-2.5 px-3 py-2">
                <span className={`dot ${entry.ok ? "dot-on" : "dot-bad"}`} />
                <span className="mono flex-1 truncate text-[11.5px] font-semibold">{entry.type}</span>
                <span className="mono text-[10px] text-mist-600">{entry.durationMs ?? 0}ms</span>
                <span className="mono text-[10px] text-mist-600">
                  {new Date(entry.createdAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ------------------------------------------------------- rodapé */}
      <div className="flex gap-2">
        <Link href="/install-mobile" className="btn flex-1">
          📲 Instalar no telemóvel
        </Link>
        <Link href="/install" className="btn flex-1">
          ➕ Ligar outro PC
        </Link>
        <Btn className="flex-1" onClick={() => setAbout(true)}>
          ℹ️ Informação
        </Btn>
      </div>

      {!standalone && (
        <div className="card-flat flex items-start gap-3 p-3.5">
          <span className="text-lg">📱</span>
          <p className="text-[11.5px] leading-relaxed text-mist-500">
            <strong className="text-mist-300">Dica:</strong> ainda não instalaste como app? Toca em{" "}
            <Link
              href="/install-mobile"
              className="text-signal-300 underline underline-offset-2 hover:text-signal-400"
            >
              Instalar no telemóvel
            </Link>{" "}
            para ficar com o TelePC no ecrã principal.
          </p>
        </div>
      )}

      <Sheet open={about} title="Como funciona" onClose={() => setAbout(false)}>
        <div className="flex flex-col gap-3 pb-2">
          <div className="card-flat p-3.5">
            <p className="text-[12.5px] font-bold">A ligação</p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-500">
              O programa que corre no PC liga-se <strong>para fora</strong>, a este hub, e fica à escuta. Por isso não
              precisas de abrir portas no router nem configurar a firewall.
            </p>
          </div>
          <div className="card-flat p-3.5">
            <p className="text-[12.5px] font-bold">O teu hub</p>
            <button
              type="button"
              onClick={() => void copy(hubUrl, "hub")}
              className="mono mt-1.5 block w-full truncate rounded-lg border border-line bg-ink-950/60 px-3 py-2 text-left text-[11px] text-signal-300"
            >
              {copied === "hub" ? "✓ copiado" : hubUrl || "—"}
            </button>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-500">
              É este endereço que o PC tem de conseguir abrir. Em casa usa o IP local; fora de casa, o endereço público
              ou uma VPN.
            </p>
          </div>
          <div className="card-flat p-3.5">
            <p className="text-[12.5px] font-bold">Código de emparelhamento</p>
            <button
              type="button"
              onClick={() => void copy(token, "tok")}
              className="mono mt-1.5 block w-full rounded-lg border border-signal-400/30 bg-signal-400/10 px-3 py-2.5 text-center text-lg font-bold tracking-[0.25em] text-signal-300"
            >
              {copied === "tok" ? "COPIADO ✓" : token || "···"}
            </button>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-500">
              Quem tiver este código controla o PC. Podes gerar um novo no assistente.
            </p>
          </div>
          <div className="card-flat p-3.5">
            <p className="text-[12.5px] font-bold">Privacidade</p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-500">
              Todos os comandos ficam guardados com hora, resultado e duração. Podes vê-los no separador Registo de
              cada PC.
            </p>
          </div>
          <Link href="/install" className="btn btn-primary w-full">
            Abrir assistente de ligação
          </Link>
        </div>
      </Sheet>
    </div>
  );
}

function formatUptime(seconds?: number) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d${h % 24}h`;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}m`;
}
