"use client";

import { useCallback, useEffect, useState } from "react";

import type { TabProps } from "@/components/console/MirrorTab";
import { Btn, Chip, Empty, Panel, Pill, Tile } from "@/components/ui";
import { send } from "@/lib/client";
import { haptic } from "@/lib/ux";
import type { CommandType } from "@/lib/protocol";

interface Step {
  type: CommandType;
  payload?: Record<string, unknown>;
  delayMs?: number;
}

interface Shortcut {
  id: string;
  name: string;
  emoji: string;
  steps: Step[];
  deviceId?: string | null;
}

const STEP_KINDS: { type: CommandType; label: string; emoji: string; placeholder: string }[] = [
  { type: "type", label: "Escrever texto", emoji: "⌨️", placeholder: "texto a escrever" },
  { type: "hotkey", label: "Atalho de teclas", emoji: "🎹", placeholder: "ctrl+shift+s" },
  { type: "launch", label: "Abrir aplicação", emoji: "🚀", placeholder: "chrome" },
  { type: "shell", label: "Comando shell", emoji: "🧾", placeholder: "dir C:\\ ou ls -la" },
  { type: "click", label: "Clique em x,y", emoji: "🖱️", placeholder: "960,540" },
  { type: "scroll", label: "Scroll", emoji: "🖲️", placeholder: "-600 (negativo = baixo)" },
  { type: "volume", label: "Volume", emoji: "🔊", placeholder: "up | down | mute" },
  { type: "media", label: "Multimédia", emoji: "🎵", placeholder: "playpause | next | prev" },
  { type: "system", label: "Sistema", emoji: "⚙️", placeholder: "lock | sleep | info" },
  { type: "screenshot", label: "Capturar ecrã", emoji: "📸", placeholder: "(sem valor)" },
];

const EMOJIS = ["⚡", "🎬", "🧹", "🎧", "💼", "🌙", "☕", "📸", "🛠️", "🚀", "🔒", "🎮"];

function buildStep(kind: (typeof STEP_KINDS)[number], value: string, delayMs: number): Step {
  const text = value.trim();
  switch (kind.type) {
    case "click": {
      const [x, y] = text.split(/[,;x\s]+/).map((part) => Number(part.trim()));
      return { type: "click", payload: { x: x || 0, y: y || 0, button: "left" }, delayMs };
    }
    case "scroll":
      return { type: "scroll", payload: { dy: Number(text) || -600, dx: 0 }, delayMs };
    case "volume":
      return { type: "volume", payload: { action: text || "up", steps: 2 }, delayMs };
    case "media":
      return { type: "media", payload: { action: text || "playpause" }, delayMs };
    case "system":
      return { type: "system", payload: { action: text || "info" }, delayMs };
    case "hotkey":
      return { type: "hotkey", payload: { combo: text || "ctrl+c" }, delayMs };
    case "launch":
      return { type: "launch", payload: { target: text }, delayMs };
    case "shell":
      return { type: "shell", payload: { command: text }, delayMs };
    case "type":
      return { type: "type", payload: { text }, delayMs };
    default:
      return { type: "screenshot", payload: {}, delayMs };
  }
}

function describeStep(step: Step): string {
  const payload = (step.payload ?? {}) as Record<string, unknown>;
  switch (step.type) {
    case "type":
      return `escrever “${String(payload.text ?? "").slice(0, 24)}”`;
    case "hotkey":
      return `teclas ${String(payload.combo ?? "")}`;
    case "launch":
      return `abrir ${String(payload.target ?? "")}`;
    case "shell":
      return `$ ${String(payload.command ?? "").slice(0, 26)}`;
    case "click":
      return `clicar em ${String(payload.x ?? 0)},${String(payload.y ?? 0)}`;
    case "scroll":
      return `scroll ${String(payload.dy ?? 0)}`;
    case "volume":
      return `volume ${String(payload.action ?? "")}`;
    case "media":
      return `multimédia ${String(payload.action ?? "")}`;
    case "system":
      return `sistema: ${String(payload.action ?? "")}`;
    case "screenshot":
      return "capturar ecrã";
    default:
      return step.type;
  }
}

export function ShortcutsTab({ deviceId, push }: TabProps) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("⚡");
  const [steps, setSteps] = useState<Step[]>([]);
  const [kind, setKind] = useState<(typeof STEP_KINDS)[number] | null>(null);
  const [value, setValue] = useState("");
  const [delayMs, setDelayMs] = useState(300);
  const [running, setRunning] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/shortcuts?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" });
      const json = (await res.json()) as { shortcuts?: Shortcut[] };
      setShortcuts(json.shortcuts ?? []);
    } catch {
      /* ignore */
    }
  }, [deviceId]);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  const addStep = () => {
    if (!kind) return;
    if (kind.type !== "screenshot" && !value.trim()) {
      push("Preenche o valor do passo", "warn");
      return;
    }
    setSteps((prev) => [...prev, buildStep(kind, value, delayMs)]);
    setValue("");
    setKind(null);
  };

  const save = async () => {
    if (!name.trim()) {
      push("Dá um nome ao atalho", "warn");
      return;
    }
    if (steps.length === 0) {
      push("Adiciona pelo menos um passo", "warn");
      return;
    }
    const res = await fetch("/api/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), emoji, deviceId, steps }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (json.ok) {
      push("Atalho guardado", "ok");
      setName("");
      setSteps([]);
      void refresh();
    } else {
      push(json.error ?? "Falhou", "danger");
    }
  };

  const run = async (shortcut: Shortcut) => {
    haptic("heavy");
    setRunning(shortcut.id);
    const res = await fetch(`/api/shortcuts/${shortcut.id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setRunning(null);
    push(json.ok ? `“${shortcut.name}” executado` : json.error ?? "Falhou", json.ok ? "ok" : "danger");
  };

  const remove = async (shortcut: Shortcut) => {
    await fetch(`/api/shortcuts/${shortcut.id}`, { method: "DELETE" });
    push("Atalho removido", "ok");
    void refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Os meus atalhos"
        icon="⚡"
        hint="Um toque executa todos os passos seguidos no PC."
        glow
        action={shortcuts.length > 0 ? <Pill tone="info">{shortcuts.length}</Pill> : undefined}
      >
        {shortcuts.length === 0 ? (
          <Empty
            emoji="⚡"
            title="Ainda não tens macros"
            hint="Exemplo: “Modo filme” = mostrar a secretária, abrir o Spotify e baixar o volume — tudo com um toque. Cria já em baixo."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {shortcuts.map((shortcut) => (
              <li key={shortcut.id} className="card-flat flex items-center gap-3 p-3">
                <span className="text-xl">{shortcut.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{shortcut.name}</div>
                  <div className="mono truncate text-[10px] text-mist-500">
                    {shortcut.steps.length} passo{shortcut.steps.length === 1 ? "" : "s"} ·{" "}
                    {shortcut.steps.map(describeStep).join(" → ").slice(0, 60)}
                  </div>
                </div>
                <Btn variant="primary" className="!px-3 !py-2 text-[12px]" disabled={running === shortcut.id} onClick={() => void run(shortcut)}>
                  {running === shortcut.id ? "…" : "Executar"}
                </Btn>
                <button type="button" onClick={() => void remove(shortcut)} className="text-mist-500 active:text-danger-400">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Criar um atalho novo" icon="🧩" hint="1) dá-lhe um nome · 2) junta passos · 3) guarda.">
        <div className="flex gap-2">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome (ex.: Modo filme)" className="field" />
        </div>
        <div className="scroll-x mt-2 flex gap-2">
          {EMOJIS.map((option) => (
            <Chip key={option} active={emoji === option} onClick={() => setEmoji(option)}>
              {option}
            </Chip>
          ))}
        </div>

        {steps.length > 0 && (
          <ol className="mt-3 flex flex-col gap-1.5">
            {steps.map((step, index) => (
              <li key={index} className="card-flat flex items-center gap-2 px-3 py-2">
                <span className="mono text-[10px] text-signal-300">{index + 1}</span>
                <span className="mono flex-1 truncate text-[11px]">{describeStep(step)}</span>
                <span className="mono text-[10px] text-mist-500">+{step.delayMs ?? 0}ms</span>
                <button type="button" onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))} className="text-mist-500 active:text-danger-400">
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}

        {kind ? (
          <div className="card-flat mt-3 p-3">
            <div className="label mb-2">
              {kind.emoji} {kind.label}
            </div>
            {kind.type !== "screenshot" && (
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={kind.placeholder}
                className="field field-mono text-[13px]"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {[0, 150, 300, 600, 1200].map((ms) => (
                <Chip key={ms} active={delayMs === ms} onClick={() => setDelayMs(ms)}>
                  {ms}ms
                </Chip>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Btn variant="primary" className="flex-1" onClick={addStep}>
                Adicionar passo
              </Btn>
              <Btn onClick={() => setKind(null)}>Cancelar</Btn>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {STEP_KINDS.map((option) => (
              <button key={option.type} type="button" onClick={() => setKind(option)} className="card-flat flex items-center gap-2 px-3 py-2.5 text-left active:scale-[0.97]">
                <span>{option.emoji}</span>
                <span className="truncate text-[12px] font-semibold">{option.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <Btn variant="go" className="flex-1" onClick={() => void save()} disabled={steps.length === 0}>
            💾 Guardar atalho
          </Btn>
          <Btn onClick={() => setSteps([])} disabled={steps.length === 0}>
            Limpar
          </Btn>
        </div>
        <p className="mt-2 text-[11px] text-mist-500">
          Dica: no separador Espelho podes ver as coordenadas para usares num passo “Clique em x,y”.
        </p>
      </Panel>

      <Panel title="Ações imediatas" icon="🎯" hint="Prontas a usar, sem precisares de criar nada.">
        <div className="grid grid-cols-4 gap-2">
          <Tile emoji="🖥️" label="Secretária" onClick={() => void send(deviceId, "hotkey", { combo: "meta+d" })} />
          <Tile emoji="🔒" label="Bloquear" onClick={() => void send(deviceId, "hotkey", { combo: "meta+l" })} />
          <Tile emoji="❌" label="Fechar" tone="danger" onClick={() => void send(deviceId, "hotkey", { combo: "alt+f4" })} />
          <Tile emoji="🖼️" label="Print" onClick={() => void send(deviceId, "hotkey", { combo: "printscreen" })} />
        </div>
      </Panel>
    </div>
  );
}
