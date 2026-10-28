"use client";

import { useCallback, useEffect, useState } from "react";

import type { TabProps } from "@/components/console/MirrorTab";
import { Btn, Chip, ConfirmSheet, Empty, Panel, Pill, Spinner, Stat, Tile } from "@/components/ui";
import { platformMeta, send } from "@/lib/client";
import { haptic } from "@/lib/ux";
import { APP_SUGGESTIONS } from "@/lib/protocol";
import type { LogEntry } from "@/lib/protocol";

/* ===========================================================================
   Janelas
   =========================================================================== */
interface RemoteWindow {
  id: string;
  title?: string;
  app?: string;
  active?: boolean;
  pid?: number;
}

export function WindowsTab({ deviceId, push }: TabProps) {
  const [windows, setWindows] = useState<RemoteWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<RemoteWindow | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await send(deviceId, "windows", {}, { timeoutMs: 20000 });
    const data = res.result?.data as { windows?: RemoteWindow[] } | undefined;
    if (res.ok && res.result?.ok) {
      setWindows(data?.windows ?? []);
      setError(null);
    } else {
      setError(res.result?.error ?? res.error ?? "Não consegui ler as janelas do PC");
    }
    setLoading(false);
  }, [deviceId]);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  const act = async (win: RemoteWindow, action: "focus" | "minimize" | "maximize" | "close") => {
    const res = await send(deviceId, "window", { id: win.id, action });
    const ok = res.ok && res.result?.ok !== false;
    const names = { focus: "trazida para a frente", minimize: "minimizada", maximize: "maximizada", close: "fechada" };
    push(ok ? `Janela ${names[action]}` : res.result?.error ?? res.error ?? "Falhou", ok ? "ok" : "danger");
    if (ok) setTimeout(refresh, 700);
  };

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Janelas abertas no PC"
        icon="🪟"
        hint={windows.length ? `${windows.length} janela${windows.length === 1 ? "" : "s"} encontrada${windows.length === 1 ? "" : "s"}.` : undefined}
        action={
          <button
            type="button"
            onClick={() => {
              haptic("soft");
              void refresh();
            }}
            className="chip !px-3 !py-1.5 text-[10.5px]"
          >
            ⟳ atualizar
          </button>
        }
      >
        {loading && windows.length === 0 ? (
          <Spinner label="a perguntar ao computador…" />
        ) : error ? (
          <Empty emoji="⚠️" title="Não consigo ver as janelas" hint={error} />
        ) : windows.length === 0 ? (
          <Empty emoji="🪟" title="Nenhuma janela visível" hint="O PC pode estar bloqueado ou sem programas abertos." />
        ) : (
          <ul className="flex flex-col gap-2">
            {windows.map((win) => (
              <li
                key={`${win.id}-${win.title}`}
                className={`card-flat p-3 ${win.active ? "border-signal-400/45 bg-signal-400/5" : ""}`}
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-base">{win.active ? "🔵" : "⬜"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">{win.title || "(sem título)"}</div>
                    <div className="mono mt-0.5 truncate text-[10px] text-mist-600">
                      {win.app || "programa"}
                      {win.pid ? ` · pid ${win.pid}` : ""}
                    </div>
                  </div>
                  {win.active && <Pill tone="info">à frente</Pill>}
                </div>
                <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                  <Btn className="!min-h-0 !px-1 !py-2 text-[10.5px]" onClick={() => act(win, "focus")}>
                    👁️ Ver
                  </Btn>
                  <Btn className="!min-h-0 !px-1 !py-2 text-[10.5px]" onClick={() => act(win, "minimize")}>
                    ➖ Esconder
                  </Btn>
                  <Btn className="!min-h-0 !px-1 !py-2 text-[10.5px]" onClick={() => act(win, "maximize")}>
                    ⬜ Grande
                  </Btn>
                  <Btn className="!min-h-0 !px-1 !py-2 text-[10.5px]" variant="danger" onClick={() => setClosing(win)}>
                    ✕ Fechar
                  </Btn>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ConfirmSheet
        open={Boolean(closing)}
        title="Fechar esta janela?"
        message={`“${closing?.title ?? ""}” vai ser fechada no PC. Se houver trabalho por gravar, o programa pode pedir confirmação no computador.`}
        confirmLabel="Fechar janela"
        onCancel={() => setClosing(null)}
        onConfirm={() => {
          if (closing) void act(closing, "close");
          setClosing(null);
        }}
      />
    </div>
  );
}

/* ===========================================================================
   Ações — programas, som, sistema
   =========================================================================== */
export function ActionsTab({ deviceId, presence, push }: TabProps) {
  const [apps, setApps] = useState(APP_SUGGESTIONS.map((app) => ({ ...app })));
  const [custom, setCustom] = useState("");
  const [info, setInfo] = useState<Record<string, string> | null>(null);
  const [confirm, setConfirm] = useState<{ action: string; label: string; message: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await send(deviceId, "apps", {}, { timeoutMs: 10000 });
      const data = res.result?.data as { apps?: { target: string; label: string }[] } | undefined;
      if (data?.apps?.length) {
        setApps(
          data.apps.map((app) => ({
            target: app.target,
            label: app.label,
            emoji: APP_SUGGESTIONS.find((suggestion) => suggestion.target === app.target)?.emoji ?? "🚀",
          })),
        );
      }
    })();
  }, [deviceId]);

  const launch = async (target: string) => {
    const res = await send(deviceId, "launch", { target }, { timeoutMs: 15000 });
    const ok = res.ok && res.result?.ok !== false;
    push(ok ? `A abrir ${target} no PC` : res.result?.error ?? res.error ?? "Não consegui abrir", ok ? "ok" : "danger");
  };

  const system = async (action: string) => {
    const res = await send(deviceId, "system", { action }, { timeoutMs: 20000 });
    const ok = res.ok && res.result?.ok !== false;
    if (action === "info" && ok) {
      const data = res.result?.data as Record<string, string> | undefined;
      if (data) setInfo(data);
      push("Informação recebida", "ok");
      return;
    }
    push(ok ? "Ordem enviada ao PC" : res.result?.error ?? res.error ?? "Falhou", ok ? "ok" : "danger");
  };

  const meta = platformMeta(presence?.platform);

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Abrir programas" icon="🚀" hint="Um toque abre no computador." glow>
        <div className="grid grid-cols-3 gap-2">
          {apps.map((app) => (
            <Tile key={app.target} emoji={app.emoji} label={app.label} sub={app.target} onClick={() => void launch(app.target)} />
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && custom.trim()) void launch(custom.trim());
            }}
            placeholder="outro programa ou caminho…"
            className="field field-mono text-[13px]"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Btn variant="primary" disabled={!custom.trim()} onClick={() => void launch(custom.trim())}>
            Abrir
          </Btn>
        </div>
      </Panel>

      <Panel title="Som" icon="🔊" hint="Controla o volume do computador.">
        <div className="grid grid-cols-3 gap-2">
          <Btn onClick={() => void send(deviceId, "volume", { action: "down", steps: 2 })}>🔉 Baixar</Btn>
          <Btn onClick={() => void send(deviceId, "volume", { action: "mute" })}>🔇 Silêncio</Btn>
          <Btn onClick={() => void send(deviceId, "volume", { action: "up", steps: 2 })}>🔊 Subir</Btn>
        </div>
        <div className="label mt-3 mb-1.5">Música e vídeo</div>
        <div className="grid grid-cols-4 gap-2">
          <Btn onClick={() => void send(deviceId, "media", { action: "prev" })}>⏮</Btn>
          <Btn variant="go" onClick={() => void send(deviceId, "media", { action: "playpause" })}>
            ⏯
          </Btn>
          <Btn onClick={() => void send(deviceId, "media", { action: "next" })}>⏭</Btn>
          <Btn onClick={() => void send(deviceId, "media", { action: "stop" })}>⏹</Btn>
        </div>
      </Panel>

      <Panel
        title="Energia e sessão"
        icon="⚙️"
        hint={`${meta.emoji} ${meta.label}${presence?.osRelease ? ` · ${presence.osRelease}` : ""}`}
      >
        <div className="grid grid-cols-2 gap-2">
          <Btn onClick={() => void system("lock")}>🔒 Bloquear ecrã</Btn>
          <Btn onClick={() => void system("sleep")}>🌙 Suspender</Btn>
          <Btn onClick={() => void system("info")}>ℹ️ Ver detalhes</Btn>
          <Btn
            onClick={() =>
              setConfirm({
                action: "logoff",
                label: "Terminar sessão",
                message: "A sessão no PC vai ser encerrada e os programas fechados. Grava o teu trabalho primeiro.",
              })
            }
          >
            👤 Sair da conta
          </Btn>
          <Btn
            variant="danger"
            onClick={() =>
              setConfirm({
                action: "restart",
                label: "Reiniciar o computador",
                message: "O PC reinicia dentro de ~10 segundos. Vais perder a ligação até ele voltar e o agente arrancar.",
              })
            }
          >
            ♻️ Reiniciar
          </Btn>
          <Btn
            variant="danger"
            onClick={() =>
              setConfirm({
                action: "shutdown",
                label: "Desligar o computador",
                message: "O PC desliga dentro de ~10 segundos. Depois disto já não o consegues ligar pelo telemóvel.",
              })
            }
          >
            ⏻ Desligar
          </Btn>
        </div>

        {info && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat label="Sistema" value={info.osName ?? "—"} />
            <Stat label="Versão" value={String(info.version ?? "—").slice(0, 20)} />
            <Stat label="Utilizador" value={info.user ?? "—"} />
            <Stat label="Nome do PC" value={info.machine ?? "—"} />
          </div>
        )}

        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-line-soft bg-ink-950/50 px-3 py-2.5">
          <span className="text-sm">💡</span>
          <p className="text-[11px] leading-relaxed text-mist-500">
            Depois de reiniciares, o PC só volta a aparecer aqui quando o agente arrancar outra vez. Vê no assistente
            como o deixar a arrancar sozinho.
          </p>
        </div>
      </Panel>

      <ConfirmSheet
        open={Boolean(confirm)}
        title={confirm?.label ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel="Sim, executar"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void system(confirm.action);
          setConfirm(null);
        }}
      />
    </div>
  );
}

/* ===========================================================================
   Registo
   =========================================================================== */
const FILTERS = [
  { value: "", label: "Tudo" },
  { value: "click", label: "Cliques" },
  { value: "hotkey", label: "Teclas" },
  { value: "type", label: "Texto" },
  { value: "shell", label: "Comandos" },
  { value: "window", label: "Janelas" },
  { value: "launch", label: "Programas" },
  { value: "system", label: "Sistema" },
];

export function LogTab({ logs, deviceId }: { logs: LogEntry[]; deviceId: string }) {
  const [filter, setFilter] = useState("");
  const entries = logs
    .filter((entry) => entry.deviceId === deviceId)
    .filter((entry) => (filter ? entry.type.toLowerCase().includes(filter) : true));

  const failures = entries.filter((entry) => !entry.ok).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Comandos" value={entries.length} />
        <Stat label="Falhas" value={failures} tone={failures ? "bad" : "ok"} />
        <Stat
          label="Média"
          value={`${entries.length ? Math.round(entries.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0) / entries.length) : 0}ms`}
        />
      </div>

      <Panel title="Histórico de comandos" icon="📜" hint="Guardado em base de dados — não se perde ao fechar a app.">
        <div className="scroll-x mb-3 flex gap-2 pb-1">
          {FILTERS.map((item) => (
            <Chip key={item.value || "all"} active={filter === item.value} onClick={() => setFilter(item.value)} className="shrink-0">
              {item.label}
            </Chip>
          ))}
        </div>
        {entries.length === 0 ? (
          <Empty emoji="📜" title="Ainda sem registos" hint="Tudo o que fizeres ao PC aparece aqui com hora e resultado." />
        ) : (
          <ul className="flex max-h-[56vh] flex-col gap-1.5 overflow-y-auto pr-1">
            {entries.map((entry) => (
              <li key={entry.id} className="card-flat px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`dot ${entry.ok ? "dot-on" : "dot-bad"}`} />
                  <span className="mono flex-1 truncate text-[12px] font-bold">{entry.type}</span>
                  <span className="mono text-[9.5px] text-mist-600">{entry.durationMs ?? 0}ms</span>
                  <span className="mono text-[9.5px] text-mist-600">
                    {new Date(entry.createdAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </div>
                {entry.error && <div className="mono mt-1 truncate text-[10px] text-danger-400">{entry.error}</div>}
                {entry.payload && typeof entry.payload === "object" && Object.keys(entry.payload).length > 0 ? (
                  <div className="mono mt-1 truncate text-[9.5px] text-signal-300/70">{JSON.stringify(entry.payload)}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
