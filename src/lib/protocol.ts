/**
 * Wire protocol shared by the Next.js hub, the phone UI and the PC agent.
 * The agent polls the hub over HTTP (long-poll) so it only ever makes
 * outbound connections — no port forwarding, no firewall rules.
 */

export type CommandType =
  | "ping"
  | "screenshot"
  | "stream"
  | "move"
  | "click"
  | "dragStart"
  | "dragMove"
  | "dragEnd"
  | "scroll"
  | "type"
  | "key"
  | "hotkey"
  | "windows"
  | "window"
  | "apps"
  | "launch"
  | "shell"
  | "system"
  | "volume"
  | "media"
  | "clipboard";

export interface Command {
  id: string;
  type: CommandType;
  payload?: Record<string, unknown>;
  createdAt: number;
}

export interface CommandResult {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  ms?: number;
}

export interface DevicePresence {
  id: string;
  name: string;
  platform: string;
  osRelease?: string | null;
  arch?: string | null;
  agentVersion?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  cpuCount?: number | null;
  totalMemoryMb?: number | null;
  lastSeenAt?: number | null;
  online: boolean;
  polling: boolean;
  streaming: boolean;
  battery?: { level: number; charging: boolean } | null;
  stats?: { cpuLoad?: number; freeMemoryMb?: number; uptimeSeconds?: number; activeWindow?: string };
}

export interface FrameEvent {
  kind: "frame";
  deviceId: string;
  version: number;
  /** Resolução do JPEG transmitido. */
  width: number;
  height: number;
  /** Resolução física do ecrã, usada para mapear o toque. */
  screenWidth?: number;
  screenHeight?: number;
  ts: number;
  bytes?: number;
  captureMs?: number;
  quality?: number;
  scale?: number;
}

export type HubEvent =
  | { kind: "device"; device: DevicePresence }
  | { kind: "result"; deviceId: string; result: CommandResult; type: string }
  | FrameEvent
  | { kind: "log"; deviceId: string; entry: LogEntry }
  | { kind: "hello"; devices: DevicePresence[] };

export interface LogEntry {
  id: string;
  deviceId: string;
  type: string;
  payload?: unknown;
  ok: boolean;
  error?: string | null;
  durationMs?: number | null;
  source: string;
  createdAt: number;
}

/** Human readable catalogue used to render the phone UI. */
export const HOTKEYS: { combo: string; label: string; emoji: string }[] = [
  { combo: "ctrl+c", label: "Copiar", emoji: "📄" },
  { combo: "ctrl+v", label: "Colar", emoji: "📋" },
  { combo: "ctrl+x", label: "Cortar", emoji: "✂️" },
  { combo: "ctrl+z", label: "Desfazer", emoji: "↩️" },
  { combo: "ctrl+shift+z", label: "Refazer", emoji: "↪️" },
  { combo: "ctrl+a", label: "Selecionar tudo", emoji: "🅰️" },
  { combo: "ctrl+s", label: "Gravar", emoji: "💾" },
  { combo: "ctrl+p", label: "Imprimir", emoji: "🖨️" },
  { combo: "ctrl+f", label: "Procurar", emoji: "🔎" },
  { combo: "ctrl+w", label: "Fechar separador", emoji: "🗂️" },
  { combo: "ctrl+t", label: "Novo separador", emoji: "➕" },
  { combo: "ctrl+n", label: "Nova janela", emoji: "🪟" },
  { combo: "ctrl+shift+t", label: "Reabrir separador", emoji: "⏮️" },
  { combo: "alt+tab", label: "Trocar de janela", emoji: "🔀" },
  { combo: "alt+f4", label: "Fechar programa", emoji: "❌" },
  { combo: "meta+d", label: "Mostrar secretária", emoji: "🖥️" },
  { combo: "meta+l", label: "Bloquear PC", emoji: "🔒" },
  { combo: "meta+e", label: "Explorador", emoji: "📁" },
  { combo: "meta+shift+s", label: "Captura de ecrã", emoji: "📸" },
  { combo: "ctrl+alt+delete", label: "Ctrl+Alt+Del", emoji: "🚨" },
  { combo: "printscreen", label: "Print Screen", emoji: "🖼️" },
  { combo: "f5", label: "Atualizar", emoji: "🔄" },
  { combo: "f11", label: "Ecrã inteiro", emoji: "⛶" },
  { combo: "escape", label: "Esc", emoji: "🚪" },
];

export const APP_SUGGESTIONS = [
  { target: "chrome", label: "Chrome", emoji: "🌐" },
  { target: "msedge", label: "Edge", emoji: "🌀" },
  { target: "firefox", label: "Firefox", emoji: "🦊" },
  { target: "explorer", label: "Explorador", emoji: "📁" },
  { target: "notepad", label: "Bloco de notas", emoji: "📝" },
  { target: "calc", label: "Calculadora", emoji: "🧮" },
  { target: "spotify", label: "Spotify", emoji: "🎧" },
  { target: "code", label: "VS Code", emoji: "💻" },
  { target: "terminal", label: "Terminal", emoji: "⌨️" },
  { target: "taskmgr", label: "Gestor de tarefas", emoji: "📊" },
];

export const KEY_ROWS: string[][] = [
  ["Esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"],
  ["Tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "Backspace"],
  ["CapsLock", "a", "s", "d", "f", "g", "h", "j", "k", "l", "ç", "Enter"],
  ["Shift", "z", "x", "c", "v", "b", "n", "m", ",", ".", "-", "Shift"],
  ["Ctrl", "Meta", "Alt", "Space", "Alt", "Up", "Down", "Left", "Right"],
];
