"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Btn, Chip, CodeBlock, Panel, Pill, Sheet, Step, ToastStack } from "@/components/ui";
import { platformMeta, useHub, usePairToken, useToasts } from "@/lib/client";
import type { DevicePresence } from "@/lib/protocol";
import { explainAttempt, type Attempt } from "@/lib/attempts";
import { haptic, useCopy, useOrigin, useStandalone } from "@/lib/ux";

type OsKey = "windows" | "macos" | "linux";

const OS_TABS: { key: OsKey; label: string; emoji: string; file: string }[] = [
  { key: "windows", label: "Windows", emoji: "🪟", file: "Instalar-TelePC-Windows.bat" },
  { key: "macos", label: "macOS", emoji: "🍎", file: "Instalar-TelePC-Mac.command" },
  { key: "linux", label: "Linux", emoji: "🐧", file: "instalar-telepc.sh" },
];

export default function SetupWizard() {
  const { token, rotate } = usePairToken();
  const hub = useHub();
  const { toasts, push, dismiss } = useToasts();
  const { copied, copy } = useCopy();
  const standalone = useStandalone();
  const origin = useOrigin();

  const [os, setOs] = useState<OsKey>("windows");
  const [started, setStarted] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [troubleshoot, setTroubleshoot] = useState(false);
  const [manual, setManual] = useState(false);
  const [downloadHelp, setDownloadHelp] = useState(false);
  const [onPhone, setOnPhone] = useState(false);
  const [hosting, setHosting] = useState<{ serverless: boolean; platform: string | null; warning: string | null } | null>(null);

  const hubUrl = origin || "http://IP-DO-PC:3000";
  const currentOs = OS_TABS.find((item) => item.key === os) ?? OS_TABS[0];
  const online = useMemo(
    () => Object.values(hub.devices).filter((device) => device.online && Boolean(device.id)),
    [hub.devices],
  );

  const loadDiagnostics = useCallback(async () => {
    try {
      const res = await fetch("/api/diagnostics", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        attempts?: Attempt[];
        candidates?: string[];
        hosting?: { serverless: boolean; platform: string | null; warning: string | null };
      };
      setAttempts(data.attempts ?? []);
      setCandidates(data.candidates ?? []);
      setHosting(data.hosting ?? null);
    } catch {
      /* ignore */
    }
    setChecked(true);
  }, []);

  useEffect(() => {
    const tick = () => void loadDiagnostics();
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [loadDiagnostics]);

  const installerUrl = useCallback(
    (which: OsKey) =>
      `/api/installer?os=${which}&token=${encodeURIComponent(token || "")}&hub=${encodeURIComponent(origin || "")}`,
    [token, origin],
  );

  // Deteta telemóvel para avisar que o instalador tem de correr no PC.
  useEffect(() => {
    const ua = navigator.userAgent;
    setOnPhone(/iPhone|iPad|iPod|Android/i.test(ua));
  }, []);

  const powerShellCommand = useMemo(
    () =>
      `$u='${origin || "https://o-teu-hub"}${installerUrl(os)}'; ` +
      `$f="$env:USERPROFILE\\Downloads\\${currentOs.file}"; ` +
      `New-Item -ItemType Directory -Force "$env:USERPROFILE\\Downloads" | Out-Null; ` +
      `Invoke-WebRequest -UseBasicParsing $u -OutFile $f; Start-Process $f`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [origin, token, os, currentOs.file],
  );

  const copyInstaller = useCallback(async () => {
    try {
      const res = await fetch(installerUrl(os) + "&format=text", { cache: "no-store" });
      const text = await res.text();
      return await copy(text, "installer");
    } catch {
      return false;
    }
  }, [copy, installerUrl, os]);

  const onDownloadClick = () => {
    haptic("ok");
    setStarted(true);
    push(`A descarregar ${currentOs.file}`, "ok");
    // Se ao fim de 2,5s nada aconteceu, abrimos as alternativas sozinhos.
    setTimeout(() => setDownloadHelp(true), 2500);
  };

  const recentAttempt = attempts[0];

  const stepState = (step: number): "todo" | "active" | "done" => {
    if (step === 1) return started ? "done" : "active";
    if (step === 2) return online.length > 0 ? "done" : started ? "active" : "todo";
    return online.length > 0 ? "active" : "todo";
  };

  return (
    <div className="app-shell mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-20 pt-3">
      <ToastStack toasts={toasts} dismiss={dismiss} />

      <header className="flex items-center gap-3 pt-1">
        <Link href="/" className="btn btn-ghost !min-h-0 !px-2.5 !py-2 text-lg" aria-label="Voltar">
          ‹
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-extrabold tracking-tight">
            Ligar o <span className="gradient-text">teu PC</span>
          </h1>
          <p className="text-[12px] text-mist-500">Um ficheiro, duplo clique. Sem terminal, sem instalações.</p>
        </div>
        {online.length > 0 ? (
          <Pill tone="ok">
            <span className="dot dot-on" /> {online.length} ligado{online.length === 1 ? "" : "s"}
          </Pill>
        ) : (
          <Pill tone="info">
            <span className="dot dot-off pulse" /> à espera
          </Pill>
        )}
      </header>

      {/* ------------------------------------------- aviso de alojamento */}
      {hosting?.serverless && (
        <div className="card card-glow border-danger-400/40 bg-danger-500/8 p-4">
          <div className="flex items-start gap-2.5">
            <span className="text-xl">🛑</span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-extrabold text-danger-400">
                Este servidor ({hosting.platform ?? "serverless"}) não serve para o TelePC
              </h2>
              <p className="mt-1 text-[11.5px] leading-relaxed text-mist-300">
                Em {hosting.platform ?? "serverless"} cada pedido vai para uma cópia diferente do servidor, por isso o
                PC liga e é logo desligado («Sessão expirada» sem parar). O TelePC precisa de um servidor{" "}
                <strong>sempre-ligado</strong>.
              </p>
              <p className="mt-2 text-[11.5px] font-bold text-mist-200">Aloja num destes (gratuitos):</p>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {[
                  ["Render", "render.com"],
                  ["Railway", "railway.app"],
                  ["Fly.io", "fly.io"],
                ].map(([name, url]) => (
                  <a
                    key={name}
                    href={`https://${url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="card-flat px-2 py-2 text-center active:scale-95"
                  >
                    <span className="block text-[12px] font-bold text-signal-300">{name}</span>
                    <span className="mono block truncate text-[9px] text-mist-600">{url}</span>
                  </a>
                ))}
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-mist-500">
                Não é preciso base de dados. Depois do deploy, define as variáveis{" "}
                <span className="mono">TELEPC_SECRET</span> e <span className="mono">PAIRING_TOKEN</span> e descarrega o
                instalador a partir do novo endereço.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------- qual é o teu PC? */}
      <Panel title="Que computador vais ligar?" hint="Escolhe o sistema: o instalador é diferente." icon="💻">
        <div className="grid grid-cols-3 gap-2">
          {OS_TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                haptic("tap");
                setOs(item.key);
              }}
              className={`card-flat flex flex-col items-center gap-1.5 py-3 transition active:scale-95 ${
                os === item.key ? "border-signal-400/60 bg-signal-400/10" : ""
              }`}
            >
              <span className="text-2xl">{item.emoji}</span>
              <span className={`text-[12px] font-bold ${os === item.key ? "text-signal-300" : "text-mist-300"}`}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </Panel>

      {/* ----------------------------------------------------------- passos */}
      <Panel title="Passo a passo" hint="Faz isto no computador (não no telemóvel)." icon="🧭" glow>
        <Step index={1} title="Descarregar e abrir o instalador" state={stepState(1)}>
          <div className="rounded-xl border border-signal-400/30 bg-signal-400/8 p-3">
            <p className="text-[11.5px] leading-relaxed text-mist-300">
              O instalador traz <strong>o programa completo</strong>, <strong>o endereço do teu hub</strong> e{" "}
              <strong>o teu código</strong> lá dentro — não precisa de descarregar mais nada. Se o PC não tiver
              Node.js, ele prepara uma versão portátil sozinho.
            </p>
          </div>

          {onPhone && (
            <div className="mt-2.5 rounded-xl border border-warn-400/35 bg-warn-400/8 p-3">
              <p className="text-[11.5px] font-bold text-warn-400">Estás no telemóvel: o ficheiro tem de ir para o PC</p>
              <p className="mt-1 text-[11px] leading-relaxed text-mist-300">
                Um instalador Windows só corre no computador. Abre o endereço abaixo <strong>no navegador do PC</strong>{" "}
                e descarrega lá — ou usa o botão «Enviar para o PC» com o endereço.
              </p>
              <button
                type="button"
                onClick={() => void copy(hubUrl + "/install", "pc-url")}
                className="mono mt-2 w-full truncate rounded-lg border border-line bg-ink-950/60 px-3 py-2 text-left text-[11px] text-signal-300 active:scale-[0.99]"
              >
                {copied === "pc-url" ? "✓ endereço copiado" : `${hubUrl}/install`}
              </button>
            </div>
          )}

          {/* Link real (não simulado): funciona mesmo sem JavaScript e no Safari */}
          <a
            href={installerUrl(os)}
            download={currentOs.file}
            target="_blank"
            rel="noopener"
            onClick={onDownloadClick}
            className="btn btn-primary mt-3 w-full !py-3.5 text-[15px]"
          >
            ⬇ Descarregar para {currentOs.label}
          </a>
          <p className="mono mt-1.5 text-center text-[10px] text-mist-600">{currentOs.file}</p>

          <button
            type="button"
            onClick={() => setDownloadHelp((value) => !value)}
            className="mt-2 w-full py-1.5 text-[11px] font-bold text-signal-300 active:scale-[0.99]"
          >
            {downloadHelp ? "▲ esconder opções" : "O download não começou? Abre as opções ›"}
          </button>

          {downloadHelp && (
            <div className="rise mt-1 flex flex-col gap-2 rounded-xl border border-line bg-ink-950/50 p-3">
              <p className="text-[11px] leading-relaxed text-mist-300">
                O Safari/Chrome às vezes bloqueia ficheiros <span className="mono">.bat</span>. Qual destas funciona
                contigo:
              </p>

              <a
                href={installerUrl(os) + "&format=text"}
                target="_blank"
                rel="noopener"
                className="btn !min-h-0 !py-2.5 text-[12px]"
              >
                📄 Abrir o instalador como texto (copiar)
              </a>

              <Btn
                className="!min-h-0 !py-2.5 text-[12px]"
                onClick={async () => {
                  const ok = await copyInstaller();
                  push(
                    ok ? "Instalador copiado — cola no PC num ficheiro .bat" : "Não consegui copiar; usa o botão acima",
                    ok ? "ok" : "warn",
                  );
                }}
              >
                {copied === "installer" ? "✓ instalador copiado" : "📋 Copiar o instalador"}
              </Btn>

              {os === "windows" && (
                <>
                  <p className="mt-1 text-[11px] leading-relaxed text-mist-300">
                    Ou cola isto no <strong>PowerShell do PC</strong> (abre com Windows + X) e carrega Enter:
                  </p>
                  <CodeBlock code={powerShellCommand} id="ps-dl" />
                </>
              )}

              <p className="mt-1 text-[10.5px] leading-relaxed text-mist-600">
                Ainda sem download? Abre <span className="mono">{hubUrl}/api/installer?os={os}</span> diretamente no
                navegador do PC.
              </p>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <Btn className="flex-1" onClick={() => void copy(hubUrl + "/install", "url")}>
              {copied === "url" ? "✓ copiado" : "📋 Copiar endereço do PC"}
            </Btn>
            <Btn
              className="flex-1"
              onClick={() => {
                haptic("warn");
                void rotate();
                push("Código novo — descarrega o instalador outra vez", "ok");
                setStarted(false);
              }}
            >
              ⟳ Novo código
            </Btn>
          </div>
        </Step>

        <Step index={2} title="Duplo clique no ficheiro" state={stepState(2)}>
          <p className="text-[12px] leading-relaxed text-mist-300">
            Vai à pasta <strong>Transferências</strong> e abre <span className="mono">{currentOs.file}</span> com duplo
            clique. Vai abrir uma janela preta — é normal, é o agente a trabalhar.
          </p>

          {os === "windows" && (
            <div className="mt-2.5 flex flex-col gap-2 text-[11.5px] leading-relaxed text-mist-500">
              <p className="rounded-xl border border-line bg-ink-950/60 px-3 py-2">
                Se o Windows mostrar <strong>«O Windows protegeu o seu PC»</strong>, toca em{" "}
                <strong>Mais informações → Executar mesmo assim</strong>. É o aviso normal para ficheiros
                descarregados da internet.
              </p>
              <p className="rounded-xl border border-line bg-ink-950/60 px-3 py-2">
                Se aparecer um aviso do antivírus, permite o ficheiro: ele só faz ligações de saída para o teu hub.
              </p>
            </div>
          )}

          {os === "macos" && (
            <div className="mt-2.5 flex flex-col gap-2 text-[11.5px] leading-relaxed text-mist-500">
              <p className="rounded-xl border border-line bg-ink-950/60 px-3 py-2">
                Se o macOS disser que não pode abrir: clica com o <strong>botão direito no ficheiro → Abrir</strong> e
                depois <strong>Abrir</strong> de novo. Ou vai a Definições → Privacidade e Segurança → «Abrir mesmo
                assim».
              </p>
              <p className="rounded-xl border border-line bg-ink-950/60 px-3 py-2">
                Na primeira vez o macOS pede <strong>Acessibilidade</strong> e <strong>Gravação do ecrã</strong> ao
                Terminal. Sem isso o rato, o teclado e o espelho não funcionam.
              </p>
            </div>
          )}

          {os === "linux" && (
            <div className="mt-2.5 flex flex-col gap-2 text-[11.5px] leading-relaxed text-mist-500">
              <p className="rounded-xl border border-line bg-ink-950/60 px-3 py-2">
                Se o duplo clique não fizer nada, abre o Terminal na pasta e corre:
              </p>
              <CodeBlock code={`bash ${currentOs.file}`} id="linux-run" />
              <p className="rounded-xl border border-line bg-ink-950/60 px-3 py-2">
                Para controlo total instala as ferramentas:{" "}
                <span className="mono">sudo apt install -y xdotool wmctrl scrot</span>
              </p>
            </div>
          )}

          <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-line-soft bg-ink-950/50 px-3 py-2">
            <span className="text-sm">🔒</span>
            <p className="text-[11px] leading-relaxed text-mist-500">
              O PC liga-se <strong>para fora</strong> ao teu hub: não abres portas no router nem mexes na firewall.
            </p>
          </div>
        </Step>

        <Step index={3} title={online.length > 0 ? "Ligado! Já podes comandar" : "A app deteta o PC sozinha"} state={stepState(3)} last>
          {online.length === 0 ? (
            <div className="card-flat shimmer flex items-center gap-3 px-3 py-3.5">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-signal-400/35 border-t-signal-400" />
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-mist-300">À espera do teu PC…</p>
                <p className="text-[11px] text-mist-500">
                  Quando a janela preta disser <span className="mono text-go-400">LIGADO ✔</span>, aparece aqui em
                  segundos.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {online.map((device) => (
                <Link
                  key={device.id}
                  href={`/console/${device.id}`}
                  className="card-flat pop flex items-center gap-3 border-go-400/40 px-3 py-3 active:scale-[0.98]"
                >
                  <span className="text-xl">{platformMeta(device.platform).emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold">{device.name}</p>
                    <p className="mono truncate text-[10.5px] text-go-400">ligado e a responder</p>
                  </div>
                  <span className="btn btn-primary !min-h-0 !py-2 text-[12px]">Comandar ›</span>
                </Link>
              ))}
            </div>
          )}
        </Step>
      </Panel>

      {/* ------------------------------------------------------- diagnóstico */}
      <Panel
        title="Diagnóstico da ligação"
        icon="🩺"
        hint="Se algo falhou, aqui vês exatamente o quê."
        action={
          <button type="button" onClick={() => void loadDiagnostics()} className="chip !px-3 !py-1.5 text-[10.5px]">
            ⟳ verificar
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          <div className="card-flat flex items-center gap-2.5 px-3 py-2.5">
            <span className={`dot ${hub.connected ? "dot-on" : "dot-bad"}`} />
            <span className="flex-1 text-[11.5px] text-mist-300">Hub acessível neste endereço</span>
            <span className="mono max-w-[52%] truncate text-[10px] text-signal-300">{hubUrl}</span>
          </div>

          <div className="card-flat flex items-center gap-2.5 px-3 py-2.5">
            <span className={`dot ${online.length > 0 ? "dot-on" : "dot-off"}`} />
            <span className="flex-1 text-[11.5px] text-mist-300">PCs ligados</span>
            <span className="mono text-[10px] text-mist-500">{online.length}</span>
          </div>

          {recentAttempt ? (
            <div className="card-flat border-warn-400/30 bg-warn-400/5 p-3">
              <div className="flex items-center gap-2">
                <span className="text-base">⚠️</span>
                <p className="flex-1 text-[12px] font-bold text-warn-400">
                  O teu PC tentou ligar e não conseguiu
                </p>
                <span className="mono text-[9.5px] text-mist-600">
                  {new Date(recentAttempt.at).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="mono mt-1.5 text-[10.5px] text-mist-400">
                {recentAttempt.name} · {recentAttempt.hostname ?? recentAttempt.platform} ·{" "}
                {recentAttempt.status === 0 ? "sem ligação" : `estado ${recentAttempt.status}`}
              </p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-300">{explainAttempt(recentAttempt)}</p>
              <a
                href={installerUrl(os)}
                download={currentOs.file}
                target="_blank"
                rel="noopener"
                onClick={onDownloadClick}
                className="btn btn-primary mt-2.5 w-full"
              >
                ⬇ Descarregar instalador atualizado
              </a>
            </div>
          ) : checked && online.length === 0 ? (
            <div className="card-flat p-3">
              <p className="text-[12px] font-bold text-mist-300">Ainda não recebemos nenhum contacto do teu PC.</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-[11px] leading-relaxed text-mist-500">
                <li>• Descarregaste o instalador <strong>para o PC</strong> (não para o telemóvel)?</li>
                <li>• Fizeste duplo clique e apareceu a janela preta?</li>
                <li>• Leste a última linha dessa janela? É lá que o erro aparece.</li>
              </ul>
              <button
                type="button"
                onClick={() => setTroubleshoot(true)}
                className="mt-2.5 w-full rounded-xl border border-line bg-ink-950/60 py-2 text-[11.5px] font-bold text-signal-300 active:scale-[0.99]"
              >
                Ver soluções passo a passo ›
              </button>
            </div>
          ) : (
            <div className="card-flat px-3 py-2.5 text-[11px] text-mist-500">Tudo pronto: um PC já está ligado.</div>
          )}
        </div>
      </Panel>

      {/* ---------------------------------------------------------- endereço */}
      <Panel
        title="Endereço do teu hub"
        icon="🌐"
        hint="É para aqui que o PC se liga. O instalador já o traz, mas se te pedir, é este."
        glow
      >
        <button
          type="button"
          onClick={() => void copy(hubUrl, "hub-main")}
          className="mono w-full truncate rounded-2xl border border-signal-400/35 bg-gradient-to-b from-signal-400/16 to-signal-400/5 px-4 py-3.5 text-center text-[13.5px] font-bold text-signal-300 active:scale-[0.98]"
        >
          {copied === "hub-main" ? "✓ ENDEREÇO COPIADO" : hubUrl}
        </button>

        {candidates.length > 1 && (
          <div className="mt-2 flex flex-col gap-1">
            <p className="label">Endereços alternativos (o instalador tenta todos)</p>
            {candidates
              .filter((item) => item !== hubUrl)
              .map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => void copy(item, item)}
                  className="mono truncate rounded-lg border border-line bg-ink-950/60 px-3 py-2 text-left text-[10.5px] text-mist-300 active:scale-[0.99]"
                >
                  {copied === item ? "✓ copiado" : item}
                </button>
              ))}
          </div>
        )}

        <div className="mt-3 rounded-xl border border-warn-400/30 bg-warn-400/8 p-3">
          <p className="text-[11.5px] font-bold text-warn-400">⚠️ Este endereço muda quando o servidor é reiniciado</p>
          <p className="mt-1 text-[11px] leading-relaxed text-mist-300">
            Se vires no PC <span className="mono">Unexpected token &lt;</span> ou «nenhum endereço respondeu», é porque
            o instalador tem um endereço antigo. <strong>Descarrega o instalador outra vez</strong> — ou, na janela
            preta, escreve o endereço acima quando ele to pedir.
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href={`${hubUrl}/api/health`}
            target="_blank"
            rel="noopener"
            className="btn !min-h-0 !py-2.5 text-[12px]"
          >
            🧪 Testar endereço
          </a>
          <Btn className="!min-h-0 !py-2.5 text-[12px]" onClick={() => void copy(`${hubUrl}/api/health`, "health")}>
            {copied === "health" ? "✓ copiado" : "📋 Copiar teste p/ PC"}
          </Btn>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-mist-600">
          Abre esse teste <strong>no navegador do PC</strong>: se aparecer <span className="mono">{"{\"ok\":true}"}</span>, o
          PC consegue chegar à app. Se aparecer uma página de login ou erro, usa um endereço alternativo.
        </p>
      </Panel>

      {/* ------------------------------------------------------------ código */}
      <Panel
        title="O teu código de emparelhamento"
        hint="Já vai dentro do instalador. Só precisas dele na alternativa manual."
        icon="🔑"
      >
        <button
          type="button"
          onClick={() => void copy(token, "token")}
          className="mono w-full rounded-2xl border border-signal-400/35 bg-gradient-to-b from-signal-400/16 to-signal-400/5 px-4 py-4 text-center text-[26px] font-extrabold tracking-[0.3em] text-signal-300 active:scale-[0.98]"
        >
          {copied === "token" ? "COPIADO ✓" : token || "···"}
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-mist-500">
          Quem tiver este código e o endereço do hub controla o PC por completo. Gera um novo se tiveres dúvidas — mas
          depois tens de descarregar o instalador outra vez.
        </p>
      </Panel>

      {/* ----------------------------------------------------- alternativa */}
      <Panel title="Alternativa manual (avançado)" icon="🧰" hint="Só se preferires usar o terminal.">
        <button
          type="button"
          onClick={() => setManual((value) => !value)}
          className="chip !px-3 !py-1.5 text-[10.5px]"
        >
          {manual ? "esconder" : "mostrar comandos"}
        </button>
        {manual && (
          <div className="mt-2.5 flex flex-col gap-2.5">
            <p className="text-[11.5px] leading-relaxed text-mist-500">
              1) Descarrega o agente já configurado (traz hub e código dentro):
            </p>
            <a
              href={`/api/agent/download?token=${encodeURIComponent(token)}`}
              className="btn w-full"
              download="pc-agent.js"
            >
              ⬇ pc-agent.js configurado
            </a>
            <p className="text-[11.5px] leading-relaxed text-mist-500">
              2) Na pasta do ficheiro, com Node.js 18+:
            </p>
            <CodeBlock code="node pc-agent.js" label="sem argumentos" id="manual-run" />
            <p className="text-[11px] leading-relaxed text-mist-500">
              Precisas do Node.js só nesta alternativa. A app descarrega-o automaticamente em{" "}
              <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-signal-300 underline">
                nodejs.org
              </a>
              .
            </p>
          </div>
        )}
      </Panel>

      {/* --------------------------------------------------------- app no iOS */}
      {!standalone && (
        <Panel title="Instalar também a app no telemóvel" icon="📱" hint="Fica grátis no ecrã principal.">
          <Link href="/install-mobile" className="btn btn-go w-full">
            📲 Ver como instalar no telemóvel
          </Link>
        </Panel>
      )}

      <div className="flex gap-2">
        <Link href="/" className="btn flex-1">
          ‹ Painel
        </Link>
        {online[0] && (
          <Link href={`/console/${online[0].id}`} className="btn btn-primary flex-[2]">
            Comandar {online[0].name} ›
          </Link>
        )}
      </div>

      <Sheet open={troubleshoot} title="Não está a funcionar?" onClose={() => setTroubleshoot(false)}>
        <div className="flex flex-col gap-2.5 pb-2">
          {TROUBLES.map((item) => (
            <div key={item.q} className="card-flat p-3.5">
              <p className="text-[12.5px] font-bold text-mist-100">{item.q}</p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-500">{item.a}</p>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

const TROUBLES = [
  {
    q: "«Sessão expirada» a repetir sem parar (liga e desliga logo)",
    a: "O servidor onde alojaste o TelePC é «serverless» (ex.: Vercel/Netlify): cada pedido vai para uma cópia diferente e a sessão perde-se. Aloja num servidor sempre-ligado — Render.com, Railway ou Fly.io (gratuitos, sem base de dados) — e descarrega o instalador do novo endereço.",
  },
  {
    q: "«SyntaxError: Unexpected token '<'» com <!DOCTYPE html>",
    a: "O instalador antigo tentou descarregar o agente de um endereço que já não existe e recebeu uma página web. O instalador novo traz o agente lá dentro e testa o endereço antes de arrancar. Descarrega-o outra vez e apaga o pc-agent.js antigo.",
  },
  {
    q: "«Nenhum destes enderecos respondeu como app TelePC»",
    a: "O endereço da app mudou (servidor reiniciado) ou pede login no navegador. Copia o «Endereço do teu hub» desta página e escreve-o na janela preta quando ela pedir.",
  },
  {
    q: "«O Windows protegeu o seu PC» ao abrir o instalador",
    a: "Normal para ficheiros descarregados. Toca em «Mais informações» e depois em «Executar mesmo assim».",
  },
  {
    q: "«node não é reconhecido» / «command not found: node»",
    a: "O instalador automático já resolve isto sozinho (descarrega uma versão portátil). Se vires este erro é porque estás a usar a alternativa manual: instala em nodejs.org e volta a tentar.",
  },
  {
    q: "A janela preta abre e fecha logo",
    a: "Falta o código ou o endereço. Descarrega o instalador pela app outra vez — o ficheiro certo traz os dois valores dentro e mantém a janela aberta no fim.",
  },
  {
    q: "Diz «nao consegui chegar ao hub»",
    a: "O endereço do hub mudou (acontece quando o servidor reinicia) ou o PC está sem internet. Abre a app no telemóvel, descarrega o instalador atualizado e volta a abri-lo.",
  },
  {
    q: "Diz «o codigo de emparelhamento esta errado»",
    a: "Geraste um código novo depois de descarregar o instalador. Descarrega outra vez. Se a janela estiver aberta e tiver terminal, podes escrever o código novo lá mesmo, sem fechar.",
  },
  {
    q: "Ligou mas o espelho do ecrã fica preto",
    a: "No Windows o ecrã bloqueado não pode ser capturado; desbloqueia o PC. No macOS autoriza «Gravação do ecrã» para o Terminal. No Linux instala scrot ou grim.",
  },
  {
    q: "O PC desaparece da app ao fim de um tempo",
    a: "A janela do agente foi fechada (ou o PC suspendeu). Volta a abrir o instalador: ele guarda a configuração e reconecta sozinho.",
  },
  {
    q: "Quero que arranque com o Windows",
    a: "Faz Win+R, escreve «shell:startup» e coloca lá um atalho para o Instalar-TelePC-Windows.bat. O agente liga-se assim que iniciares sessão.",
  },
];

export type { DevicePresence };
