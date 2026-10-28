"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { MirrorTab, TrackpadTab } from "@/components/console/MirrorTab";
import { KeyboardTab, TerminalTab } from "@/components/console/InputTabs";
import { ShortcutsTab } from "@/components/console/ShortcutsTab";
import { ActionsTab, LogTab, WindowsTab } from "@/components/console/SystemTabs";
import { HelpBanner, Pill, Sheet } from "@/components/ui";
import { ToastStack } from "@/components/ui";
import { platformMeta, relativeTime, useHub, useToasts } from "@/lib/client";
import type { DevicePresence } from "@/lib/protocol";
import { haptic, setFlag } from "@/lib/ux";

type TabId = "mirror" | "trackpad" | "keyboard" | "actions" | "windows" | "terminal" | "shortcuts" | "log";

interface TabDef {
  id: TabId;
  label: string;
  emoji: string;
  title: string;
  help: { emoji: string; text: string }[];
}

const TABS: Record<TabId, TabDef> = {
  mirror: {
    id: "mirror",
    label: "Espelho",
    emoji: "🖥️",
    title: "Ecrã em direto",
    help: [
      { emoji: "👆", text: "Toca na imagem e o rato clica exatamente nesse ponto do PC." },
      { emoji: "↔️", text: "Arrasta o dedo para arrastar ficheiros, selecionar texto ou mover janelas." },
      { emoji: "🖱️", text: "Liga “Botão direito” para que o próximo toque abra o menu de contexto." },
      { emoji: "🐢", text: "Se estiver lento, baixa os fps e a escala mais abaixo." },
    ],
  },
  trackpad: {
    id: "trackpad",
    label: "Trackpad",
    emoji: "🖱️",
    title: "Rato por gestos",
    help: [
      { emoji: "☝️", text: "Um dedo move o cursor, como no trackpad do portátil." },
      { emoji: "👆", text: "Toque rápido = clique esquerdo." },
      { emoji: "✌️", text: "Dois dedos deslizam = scroll; toque com dois dedos = clique direito." },
      { emoji: "🔒", text: "“Arrasto ativo” mantém o botão premido para arrastares coisas." },
    ],
  },
  keyboard: {
    id: "keyboard",
    label: "Teclado",
    emoji: "⌨️",
    title: "Escrever no PC",
    help: [
      { emoji: "✍️", text: "Escreve na caixa e toca em Enviar: o texto aparece na janela ativa do PC." },
      { emoji: "🎹", text: "Ctrl, Alt, Shift e ⊞ ficam ativos até carregares na tecla seguinte." },
      { emoji: "⚡", text: "Os atalhos prontos (Copiar, Colar, Alt+Tab…) funcionam com um toque." },
      { emoji: "📋", text: "Podes trazer o texto copiado no PC para o telemóvel e vice-versa." },
    ],
  },
  actions: {
    id: "actions",
    label: "Ações",
    emoji: "🎛️",
    title: "Programas e sistema",
    help: [
      { emoji: "🚀", text: "Toca num ícone para abrir esse programa no PC." },
      { emoji: "🔊", text: "Volume e multimédia controlam o que estiver a tocar." },
      { emoji: "⏻", text: "Reiniciar e desligar pedem confirmação — não há enganos." },
    ],
  },
  windows: {
    id: "windows",
    label: "Janelas",
    emoji: "🪟",
    title: "Janelas abertas",
    help: [
      { emoji: "🔎", text: "Lista tudo o que está aberto no PC, com a janela ativa destacada." },
      { emoji: "❌", text: "“Fechar” fecha mesmo o programa, como clicar no X." },
      { emoji: "⟳", text: "Toca em atualizar depois de abrires algo novo." },
    ],
  },
  terminal: {
    id: "terminal",
    label: "Terminal",
    emoji: "🧾",
    title: "Linha de comandos",
    help: [
      { emoji: "⌨️", text: "Escreve qualquer comando e vê a resposta do PC aqui." },
      { emoji: "💡", text: "Os botões de sugestão poupam-te a escrita." },
      { emoji: "⚠️", text: "Isto corre com as tuas permissões: cuidado com comandos destrutivos." },
    ],
  },
  shortcuts: {
    id: "shortcuts",
    label: "Atalhos",
    emoji: "⚡",
    title: "Macros de um toque",
    help: [
      { emoji: "🧩", text: "Junta vários passos (abrir app, teclas, comandos) numa só ação." },
      { emoji: "⏱️", text: "A pausa entre passos dá tempo ao PC para reagir." },
      { emoji: "💾", text: "Ficam guardados e aparecem sempre que voltares." },
    ],
  },
  log: {
    id: "log",
    label: "Registo",
    emoji: "📜",
    title: "Histórico",
    help: [
      { emoji: "✅", text: "Verde = o PC confirmou; vermelho = falhou (com o motivo)." },
      { emoji: "⏲️", text: "O tempo em ms mostra a rapidez da ligação." },
    ],
  },
};

const PRIMARY: TabId[] = ["mirror", "trackpad", "keyboard", "actions"];
const SECONDARY: TabId[] = ["windows", "terminal", "shortcuts", "log"];

export default function ConsoleClient({
  deviceId,
  initialPresence,
}: {
  deviceId: string;
  initialPresence?: DevicePresence;
}) {
  const [tab, setTab] = useState<TabId>("mirror");
  const [more, setMore] = useState(false);
  const hub = useHub(deviceId);
  const { toasts, push, dismiss } = useToasts();

  const presence = hub.devices[deviceId] ?? initialPresence;
  const meta = platformMeta(presence?.platform);
  const frame = hub.frames[deviceId];
  const online = Boolean(presence?.online);
  const current = TABS[tab];
  const cpu = presence?.stats?.cpuLoad ?? 0;
  const agentNeedsUpdate = Boolean(
    presence?.agentVersion &&
      presence.agentVersion
        .split(".")
        .map(Number)
        .reduce((value, part) => value * 100 + part, 0) < 10200,
  );

  const tabProps = { deviceId, presence, frame, frameVersion: frame?.version ?? 0, push };

  const go = (id: TabId) => {
    haptic("tap");
    setTab(id);
    setMore(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // O "?" traz de volta as dicas do ecrã atual.
  const showHelp = () => {
    haptic("soft");
    setFlag(`help:${tab}`, false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    document.title = `${presence?.name ?? "PC"} · ${current.title} — TelePC`;
  }, [presence?.name, current.title]);

  return (
    <div className="app-shell with-tabbar flex min-h-dvh flex-col">
      <ToastStack toasts={toasts} dismiss={dismiss} />

      {/* ------------------------------------------------------------ header */}
      <header
        className="glass sticky top-0 z-30 border-b border-line px-4 pb-3"
        style={{ paddingTop: "calc(var(--safe-top) + 10px)" }}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2.5">
          <Link
            href="/"
            onClick={() => haptic("soft")}
            className="btn btn-ghost !min-h-0 !px-2 !py-1.5 text-xl"
            aria-label="Voltar ao painel"
          >
            ‹
          </Link>
          <div
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-base ${
              online ? "border-go-400/40 bg-go-500/12" : "border-line bg-ink-800"
            }`}
          >
            {meta.emoji}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-[15px] font-bold tracking-tight">{presence?.name ?? "O meu PC"}</h1>
              {online && (
                <span className="inline-flex items-center gap-1 rounded-full bg-go-500/12 px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-wider text-go-400">
                  <span className="dot dot-on !h-1.5 !w-1.5 pulse" /> ligado
                </span>
              )}
            </div>
            <p className="mono truncate text-[10px] text-mist-500">
              {online
                ? `${current.emoji} ${current.title}${frame?.width ? ` · ${frame.width}×${frame.height}` : presence?.screenWidth ? ` · ${presence.screenWidth}×${presence.screenHeight}` : ""}`
                : `desligado · visto ${relativeTime(presence?.lastSeenAt ?? null)}`}
            </p>
          </div>
          {online && (
            <Pill
              tone={presence?.streaming ? "ok" : cpu > 80 ? "bad" : cpu > 50 ? "warn" : "default"}
              className="shrink-0"
            >
              {presence?.streaming ? "📡 LIVE" : `CPU ${cpu}%`}
            </Pill>
          )}
          <button type="button" onClick={showHelp} className="chip !px-3 shrink-0" aria-label="Ajuda deste ecrã">
            ?
          </button>
        </div>

        {!online && (
          <div className="mx-auto mt-2.5 flex max-w-2xl items-center gap-2.5 rounded-xl border border-warn-400/30 bg-warn-400/8 px-3 py-2">
            <span className="text-base">🔌</span>
            <p className="flex-1 text-[11px] leading-snug text-warn-400">
              O PC não está a responder. Confirma que a janela do agente continua aberta no computador.
            </p>
            <Link href="/install" className="chip !border-warn-400/40 !px-2.5 !py-1 !text-[10px] !text-warn-400">
              Ajuda
            </Link>
          </div>
        )}

        {online && agentNeedsUpdate && (
          <div className="mx-auto mt-2.5 flex max-w-2xl items-center gap-2.5 rounded-xl border border-signal-400/30 bg-signal-400/8 px-3 py-2">
            <span className="text-base">🚀</span>
            <p className="flex-1 text-[10.5px] leading-snug text-signal-300">
              Atualiza o agente para ter até 10 fps, imagem HD e menos atraso.
            </p>
            <Link href="/install" className="chip !border-signal-400/40 !px-2.5 !py-1 !text-[10px] !text-signal-300">
              Atualizar
            </Link>
          </div>
        )}

        {online && presence?.stats?.activeWindow && (
          <div className="mx-auto mt-2.5 flex max-w-2xl items-center gap-2 rounded-xl border border-line-soft bg-ink-950/50 px-3 py-1.5">
            <span className="text-[11px]">🪟</span>
            <span className="truncate text-[10.5px] text-mist-500">
              em primeiro plano: <span className="text-mist-300">{presence.stats.activeWindow}</span>
            </span>
          </div>
        )}
      </header>

      {/* ------------------------------------------------------------ conteúdo */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        <div key={tab} className="rise flex flex-col gap-3">
          <HelpBanner id={tab} title={`${current.emoji} ${current.title}`} lines={current.help} />

          {tab === "mirror" && <MirrorTab {...tabProps} />}
          {tab === "trackpad" && <TrackpadTab {...tabProps} />}
          {tab === "keyboard" && <KeyboardTab {...tabProps} />}
          {tab === "actions" && <ActionsTab {...tabProps} />}
          {tab === "windows" && <WindowsTab {...tabProps} />}
          {tab === "terminal" && <TerminalTab {...tabProps} />}
          {tab === "shortcuts" && <ShortcutsTab {...tabProps} />}
          {tab === "log" && <LogTab logs={hub.logs} deviceId={deviceId} />}
        </div>

        <p className="mono pt-5 text-center text-[9.5px] text-mist-600">
          hub {hub.connected ? "ligado" : "a reconectar…"} · {online ? "PC a responder" : "PC em silêncio"}
        </p>
      </main>

      {/* --------------------------------------------------------- tab bar */}
      <nav className="tabbar">
        <div className="mx-auto flex max-w-2xl">
          {PRIMARY.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              className={`tabbar-item ${tab === id ? "tabbar-on" : ""}`}
            >
              <span className="tabbar-icon">{TABS[id].emoji}</span>
              {TABS[id].label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              haptic("tap");
              setMore(true);
            }}
            className={`tabbar-item ${SECONDARY.includes(tab) ? "tabbar-on" : ""}`}
          >
            <span className="tabbar-icon">{SECONDARY.includes(tab) ? TABS[tab].emoji : "⋯"}</span>
            {SECONDARY.includes(tab) ? TABS[tab].label : "Mais"}
          </button>
        </div>
      </nav>

      <Sheet open={more} title="Mais ferramentas" onClose={() => setMore(false)}>
        <div className="grid grid-cols-2 gap-2.5 pb-2">
          {SECONDARY.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              className={`card-flat flex flex-col items-start gap-1 p-4 text-left active:scale-[0.97] ${
                tab === id ? "border-signal-400/50 bg-signal-400/8" : ""
              }`}
            >
              <span className="text-2xl">{TABS[id].emoji}</span>
              <span className="text-[13px] font-bold">{TABS[id].label}</span>
              <span className="text-[10.5px] leading-snug text-mist-500">{TABS[id].title}</span>
            </button>
          ))}
          <Link href="/" className="card-flat col-span-2 flex items-center gap-3 p-4 active:scale-[0.98]">
            <span className="text-xl">🏠</span>
            <span className="flex-1 text-[13px] font-bold">Voltar ao painel</span>
            <span className="text-mist-500">›</span>
          </Link>
        </div>
      </Sheet>
    </div>
  );
}
