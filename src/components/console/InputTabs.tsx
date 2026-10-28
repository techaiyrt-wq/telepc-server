"use client";

import { useEffect, useRef, useState } from "react";

import type { TabProps } from "@/components/console/MirrorTab";
import { Btn, Chip, Empty, Panel, Pill } from "@/components/ui";
import { send } from "@/lib/client";
import { haptic } from "@/lib/ux";
import { HOTKEYS, KEY_ROWS } from "@/lib/protocol";

const KEY_ALIAS: Record<string, string> = {
  esc: "escape",
  capslock: "capslock",
  backspace: "backspace",
  enter: "enter",
  space: "space",
  tab: "tab",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
};

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Meta"];

/* ===========================================================================
   Teclado
   =========================================================================== */
export function KeyboardTab({ deviceId, push }: TabProps) {
  const [text, setText] = useState("");
  const [modifiers, setModifiers] = useState<string[]>([]);
  const [clipboardText, setClipboardText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showKeys, setShowKeys] = useState(true);

  const toggleModifier = (key: string) =>
    setModifiers((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));

  const pressKey = async (label: string) => {
    haptic("tap");
    if (MODIFIERS.includes(label)) {
      toggleModifier(label.toLowerCase());
      return;
    }

    const named = KEY_ALIAS[label.toLowerCase()] ?? (label.length > 1 ? label.toLowerCase() : null);
    const comboParts = [...modifiers];

    if (named) {
      comboParts.push(named);
    } else if (label.length === 1) {
      const char = modifiers.includes("shift") ? label.toUpperCase() : label;
      if (comboParts.length === 0) {
        await send(deviceId, "type", { text: char });
        setModifiers([]);
        return;
      }
      comboParts.push(char);
    } else {
      comboParts.push(label.toLowerCase());
    }

    const res = await send(deviceId, "hotkey", { combo: comboParts.join("+") });
    setModifiers([]);
    if (!res.ok || (res.result && !res.result.ok)) {
      push(res.result?.error ?? res.error ?? "A tecla não chegou ao PC", "danger");
    }
  };

  const sendText = async () => {
    if (!text) return;
    setBusy(true);
    const res = await send(deviceId, "type", { text }, { timeoutMs: 30000 });
    setBusy(false);
    const ok = res.ok && res.result?.ok !== false;
    push(ok ? `Escrito no PC (${text.length} caracteres)` : res.result?.error ?? res.error ?? "Falhou", ok ? "ok" : "danger");
    if (ok) setText("");
  };

  const readClipboard = async () => {
    const res = await send(deviceId, "clipboard", { action: "get" });
    const value = ((res.result?.data as { text?: string } | undefined)?.text ?? "").trim();
    setClipboardText(value);
    push(res.ok ? (value ? "Texto trazido do PC" : "A área de transferência do PC está vazia") : res.error ?? "Falhou", res.ok ? "ok" : "danger");
  };

  const writeClipboard = async () => {
    let fromPhone = "";
    try {
      fromPhone = await navigator.clipboard.readText();
    } catch {
      fromPhone = text;
    }
    if (!fromPhone) {
      push("Copia algo no telemóvel primeiro", "warn");
      return;
    }
    const res = await send(deviceId, "clipboard", { action: "set", text: fromPhone });
    push(res.ok ? "Colado na memória do PC (Ctrl+V lá)" : res.error ?? "Falhou", res.ok ? "ok" : "danger");
  };

  return (
    <div className="flex flex-col gap-3">
      {/* -------------------------------------------------- escrever texto */}
      <Panel title="Escrever no computador" icon="✍️" hint="Vai parar à janela que estiver à frente no PC." glow>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void sendText();
            }}
            placeholder="Escreve aqui e toca em enviar…"
            className="field"
          />
          <Btn variant="primary" onClick={sendText} disabled={busy || !text}>
            {busy ? "…" : "Enviar"}
          </Btn>
        </div>
        <div className="scroll-x mt-2 flex gap-2 pb-1">
          <Chip onClick={() => void send(deviceId, "key", { name: "enter" })}>↵ Enter</Chip>
          <Chip onClick={() => void send(deviceId, "key", { name: "backspace" })}>⌫ Apagar</Chip>
          <Chip onClick={() => void send(deviceId, "hotkey", { combo: "ctrl+a" })}>Selecionar tudo</Chip>
          <Chip onClick={() => void send(deviceId, "hotkey", { combo: "ctrl+v" })}>Colar no PC</Chip>
          <Chip onClick={() => setText("")}>Limpar caixa</Chip>
        </div>
      </Panel>

      {/* ------------------------------------------------------- atalhos */}
      <Panel title="Atalhos num toque" icon="⚡" hint="As combinações do dia-a-dia, já prontas.">
        <div className="grid grid-cols-2 gap-2">
          {HOTKEYS.map((hotkey) => (
            <button
              key={hotkey.combo}
              type="button"
              onClick={() => {
                haptic("tap");
                void send(deviceId, "hotkey", { combo: hotkey.combo });
              }}
              className="card-flat flex items-center gap-2.5 px-3 py-2.5 text-left transition active:scale-[0.97]"
            >
              <span className="text-base leading-none">{hotkey.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-bold">{hotkey.label}</span>
                <span className="mono block truncate text-[9.5px] text-mist-600">{hotkey.combo}</span>
              </span>
            </button>
          ))}
        </div>
      </Panel>

      {/* ------------------------------------------------- teclado físico */}
      <Panel
        title="Teclado completo"
        icon="🎹"
        hint={
          modifiers.length
            ? `Ativo: ${modifiers.join(" + ").toUpperCase()} — carrega agora na tecla seguinte`
            : "Ctrl, Alt, Shift e ⊞ ficam presos até à tecla seguinte."
        }
        action={
          <button type="button" onClick={() => setShowKeys((value) => !value)} className="chip !px-3 !py-1.5 text-[10.5px]">
            {showKeys ? "esconder" : "mostrar"}
          </button>
        }
      >
        {modifiers.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {modifiers.map((modifier) => (
              <Pill key={modifier} tone="info">
                {modifier.toUpperCase()}
                <button type="button" onClick={() => toggleModifier(modifier)} className="ml-0.5">
                  ✕
                </button>
              </Pill>
            ))}
          </div>
        )}
        {showKeys && (
          <div className="flex flex-col gap-1.5">
            {KEY_ROWS.map((row, rowIndex) => (
              <div key={rowIndex} className="flex gap-1.5">
                {row.map((label, index) => (
                  <button
                    key={`${label}-${index}`}
                    type="button"
                    onClick={() => void pressKey(label)}
                    className={`key flex-1 ${modifiers.includes(label.toLowerCase()) ? "key-on" : ""} ${
                      label === "Space" ? "flex-[3]" : ""
                    }`}
                  >
                    {label === "Meta" ? "⊞" : label === "Space" ? "espaço" : label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* -------------------------------------------------- transferência */}
      <Panel title="Copiar entre telemóvel e PC" icon="📋" hint="Texto nos dois sentidos, sem cabos.">
        <div className="grid grid-cols-2 gap-2">
          <Btn onClick={readClipboard}>⬇ Trazer do PC</Btn>
          <Btn onClick={writeClipboard}>⬆ Enviar para o PC</Btn>
        </div>
        {clipboardText && (
          <>
            <div className="label mt-3">Veio do PC</div>
            <textarea readOnly value={clipboardText} className="field field-mono mt-1.5 h-28 resize-none text-[12px]" />
          </>
        )}
      </Panel>
    </div>
  );
}

/* ===========================================================================
   Terminal
   =========================================================================== */
interface HistoryEntry {
  id: number;
  command: string;
  output: string;
  code?: number;
  at: number;
  error?: string;
  running: boolean;
}

export function TerminalTab({ deviceId, presence, push }: TabProps) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [running, setRunning] = useState(false);
  const seq = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history]);

  const isWindows = presence?.platform === "win32";
  const suggestions = isWindows
    ? [
        { cmd: "whoami", label: "Quem sou" },
        { cmd: "hostname", label: "Nome do PC" },
        { cmd: "ipconfig", label: "Rede" },
        { cmd: "tasklist", label: "Programas a correr" },
        { cmd: "dir", label: "Ficheiros aqui" },
        { cmd: "systeminfo", label: "Info do sistema" },
      ]
    : [
        { cmd: "whoami", label: "Quem sou" },
        { cmd: "hostname", label: "Nome do PC" },
        { cmd: "uname -a", label: "Sistema" },
        { cmd: "ls -la", label: "Ficheiros aqui" },
        { cmd: "df -h", label: "Espaço em disco" },
        { cmd: "ps aux | head -20", label: "Processos" },
      ];

  const run = async (raw?: string) => {
    const cmd = (raw ?? command).trim();
    if (!cmd || running) return;
    haptic("tap");
    setRunning(true);
    const entry: HistoryEntry = { id: ++seq.current, command: cmd, output: "", at: Date.now(), running: true };
    setHistory((prev) => [...prev, entry]);
    setCommand("");

    const res = await send(deviceId, "shell", { command: cmd }, { timeoutMs: 60000 });
    const data = res.result?.data as { output?: string; code?: number } | undefined;
    const failed = !res.ok || res.result?.ok === false;

    setHistory((prev) =>
      prev.map((item) =>
        item.id === entry.id
          ? {
              ...item,
              running: false,
              output: data?.output ?? "",
              code: data?.code,
              error: failed ? res.result?.error ?? res.error ?? "Falhou" : undefined,
            }
          : item,
      ),
    );
    setRunning(false);
    if (failed) push(res.result?.error ?? res.error ?? "O comando falhou", "danger");
  };

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Linha de comandos"
        icon="🧾"
        hint={isWindows ? "Corre no cmd do Windows." : "Corre na shell do sistema."}
        glow
        action={<Pill tone="warn">poder total</Pill>}
      >
        <div className="flex gap-2">
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void run();
            }}
            placeholder={isWindows ? "ex.: dir" : "ex.: ls -la"}
            className="field field-mono"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Btn variant="primary" onClick={() => void run()} disabled={running || !command.trim()}>
            {running ? "…" : "▶"}
          </Btn>
        </div>
        <div className="label mt-3 mb-1.5">Sugestões</div>
        <div className="grid grid-cols-3 gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.cmd}
              type="button"
              onClick={() => void run(suggestion.cmd)}
              className="card-flat px-2 py-2 text-center transition active:scale-95"
            >
              <span className="block truncate text-[11px] font-bold">{suggestion.label}</span>
              <span className="mono block truncate text-[9px] text-mist-600">{suggestion.cmd}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        title="Resultado"
        icon="📤"
        action={
          history.length > 0 ? (
            <button type="button" onClick={() => setHistory([])} className="chip !px-3 !py-1.5 text-[10.5px]">
              limpar
            </button>
          ) : undefined
        }
      >
        {history.length === 0 ? (
          <Empty emoji="⌨️" title="Nada executado ainda" hint="Toca numa sugestão acima para experimentares sem risco." />
        ) : (
          <div className="flex max-h-[52vh] flex-col gap-2.5 overflow-y-auto pr-1">
            {history.map((entry) => (
              <div key={entry.id} className="card-flat p-3">
                <div className="mono flex items-start gap-2 text-[12px]">
                  <span className={entry.error ? "text-danger-400" : "text-go-400"}>›</span>
                  <span className="flex-1 break-all font-semibold text-mist-100">{entry.command}</span>
                  {entry.running && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-signal-400/35 border-t-signal-400" />}
                </div>
                {entry.error && (
                  <div className="mono mt-2 rounded-lg border border-danger-400/25 bg-danger-500/10 px-2 py-1.5 text-[11px] text-danger-400">
                    {entry.error}
                  </div>
                )}
                {entry.output && (
                  <pre className="mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ink-950/75 p-2.5 text-[11px] leading-relaxed text-mist-300">
                    {entry.output}
                  </pre>
                )}
                {!entry.output && !entry.error && !entry.running && (
                  <p className="mono mt-2 text-[10.5px] text-mist-600">(sem resposta de texto — comando executado)</p>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </Panel>
    </div>
  );
}
