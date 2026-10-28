#!/usr/bin/env node
/**
 * TelePC Agent  —  corre no teu PC e obedece ao telemovel.
 *
 * Sem dependencias: apenas Node.js 18+ (fetch nativo).
 *
 *   node pc-agent.js --hub http://SEU-HUB --token CODIGO-DE-EMPARELHAMENTO
 *
 * Variaveis de ambiente equivalentes: TELEPC_HUB, TELEPC_TOKEN, TELEPC_NAME
 * O agente so faz ligacoes de saida (HTTPS/HTTP) — nao precisa de portas abertas.
 */
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const AGENT_VERSION = '1.2.0';
const PLATFORM = process.platform; // win32 | darwin | linux

// O hub injeta estes dois valores no ficheiro ao descarregar, para que
// "node pc-agent.js" funcione sem escrever nada.
const INJECTED_HUB = "";
const INJECTED_TOKEN = "";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { out[key] = true; } else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`TelePC Agent ${AGENT_VERSION}

Uso: node pc-agent.js --hub <url> --token <codigo> [--name <nome>] [--fps 2] [--scale 0.5]

  --hub     endereco do hub (ex.: https://telepc.example.com ou http://192.168.1.20:3000)
  --token   codigo de emparelhamento mostrado na app do telemovel (alias: --code)
  --name    nome amigavel deste computador
  --fps     frames por segundo do espelho de ecra (1 - 12, por omissao 6)
  --scale   escala da captura (0.3 - 1, por omissao 0.7)
  --quality qualidade JPEG (25 - 92, por omissao 74)
`);
  process.exit(0);
}

const HUB_CANDIDATES = String(args.hub || args.server || process.env.TELEPC_HUB || INJECTED_HUB || '')
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);
for (let i = HUB_CANDIDATES.length - 1; i >= 0; i--) {
  if (HUB_CANDIDATES.indexOf(HUB_CANDIDATES[i]) !== i) HUB_CANDIDATES.splice(i, 1);
}
let HUB = HUB_CANDIDATES[0] || '';
let PAIR_TOKEN = String(args.token || args.code || process.env.TELEPC_TOKEN || INJECTED_TOKEN || '').trim();
const NAME = String(args.name || process.env.TELEPC_NAME || os.hostname() || 'O meu PC');
const DEFAULT_FPS = clamp(Number(args.fps) || 6, 1, 12);
const DEFAULT_SCALE = clamp(Number(args.scale) || 0.7, 0.3, 1);
const DEFAULT_QUALITY = clamp(Number(args.quality) || 74, 25, 92);
const CONFIG_FILE = path.join(os.homedir(), '.telepc-agent.json');
const TMP_DIR = fs.realpathSync(os.tmpdir());

function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }
function num(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

const state = {
  deviceId: null,
  deviceToken: null,
  screen: { width: 0, height: 0 },
  stream: { active: false, until: 0, fps: DEFAULT_FPS, scale: DEFAULT_SCALE, quality: DEFAULT_QUALITY, timer: null, busy: false },
  dragging: false,
  cpu: { load: 0, prev: null },
  activeWindow: '',
};

// ---------------------------------------------------------------------------
// Helpers de processo
// ---------------------------------------------------------------------------
function run(cmd, cmdArgs, { timeout = 20000, input = null, binary = false, cwd } = {}) {
  return new Promise((resolve) => {
    let stdout = binary ? [] : '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, cmdArgs, { cwd, windowsHide: true });
    } catch (error) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String(error && error.message) });
      return;
    }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeout);
    child.stdout.on('data', (d) => { if (binary) stdout.push(d); else stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout: '', stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const out = binary ? Buffer.concat(stdout) : stdout;
      resolve({ ok: code === 0, code, stdout: out, stderr });
    });
    if (input != null) { try { child.stdin.write(input); child.stdin.end(); } catch { try { child.stdin.end(); } catch {} } }
    else { try { child.stdin.end(); } catch {} }
  });
}

function tempFile(prefix, ext) {
  return path.join(TMP_DIR, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
}

/** Devolve o caminho do binario (string nao vazia) ou '' se nao existir. */
async function which(bin) {
  const probe = PLATFORM === 'win32' ? 'where' : 'which';
  const r = await run(probe, [bin], { timeout: 5000 });
  if (!r.ok) return '';
  return String(r.stdout).split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
}

// ---------------------------------------------------------------------------
// Windows: processo PowerShell persistente (compila o SendInput uma unica vez)
// ---------------------------------------------------------------------------
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class TeleNative {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public const uint MOVE = 0x0001, LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008,
    RIGHTUP = 0x0010, MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040, WHEEL = 0x0800, HWHEEL = 0x1000,
    KEYUP = 0x0002, UNICODE = 0x0004;
  public static void Down(uint f) { mouse_event(f, 0, 0, 0, UIntPtr.Zero); }
  public static void Wheel(int d) { mouse_event(WHEEL, 0, 0, d, UIntPtr.Zero); }
  public static void HWheel(int d) { mouse_event(HWHEEL, 0, 0, d, UIntPtr.Zero); }
  public static void Key(int vk, bool up) { keybd_event((byte)vk, 0, up ? KEYUP : 0, UIntPtr.Zero); }
  public static void Char(int c, bool up) { keybd_event(0, (byte)c, up ? (KEYUP | UNICODE) : UNICODE, UIntPtr.Zero); }
  public static string Title(IntPtr h) { StringBuilder sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
}
"@

function Send-Obj($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }

function Get-Shot($p, $scale, $quality) {
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $src = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
  $g = [System.Drawing.Graphics]::FromImage($src)
  $g.CopyFromScreen($vs.Left, $vs.Top, 0, 0, $src.Size)
  $g.Dispose()
  $w = [int][Math]::Max(1, ($src.Width * $scale))
  $h = [int][Math]::Max(1, ($src.Height * $scale))
  $dst = New-Object System.Drawing.Bitmap $w, $h
  $g2 = [System.Drawing.Graphics]::FromImage($dst)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
  $g2.DrawImage($src, 0, 0, $w, $h)
  $g2.Dispose()
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
  $dst.Save($p, $enc, $ep)
  $ep.Dispose(); $dst.Dispose(); $src.Dispose()
  return @{ width = $vs.Width; height = $vs.Height; outputWidth = $w; outputHeight = $h }
}

function Get-WinList {
  $fg = [TeleNative]::GetForegroundWindow()
  $list = @()
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } | ForEach-Object {
    $hwnd = $_.MainWindowHandle
    $list += @{ id = "$hwnd"; pid = $_.Id; title = $_.MainWindowTitle; app = $_.ProcessName; active = ($hwnd -eq $fg) }
  }
  return $list
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  $req = $null
  try { $req = $line | ConvertFrom-Json } catch { continue }
  try {
    $op = $req.op
    $data = $null
    if ($op -eq 'move') { [TeleNative]::SetCursorPos([int]$req.x, [int]$req.y) | Out-Null }
    elseif ($op -eq 'down' -or $op -eq 'up') {
      if ($req.x -ne $null) { [TeleNative]::SetCursorPos([int]$req.x, [int]$req.y) | Out-Null }
      $f = @{ left = $(if ($op -eq 'down') { 2 } else { 4 }); right = $(if ($op -eq 'down') { 8 } else { 16 }); middle = $(if ($op -eq 'down') { 32 } else { 64 }) }[$req.button]
      [TeleNative]::Down([uint32]$f)
    }
    elseif ($op -eq 'wheel') { [TeleNative]::Wheel([int]$req.dy); if ($req.dx) { [TeleNative]::HWheel([int]$req.dx) } }
    elseif ($op -eq 'key') { foreach ($k in $req.keys) { [TeleNative]::Key([int]$k.vk, [bool]$k.up) } }
    elseif ($op -eq 'chars') { foreach ($c in $req.text.ToCharArray()) { [TeleNative]::Char([int]$c, $false); [TeleNative]::Char([int]$c, $true) } }
    elseif ($op -eq 'shot') { $data = Get-Shot $req.path ([double]$req.scale) ([int]$req.quality) }
    elseif ($op -eq 'screen') {
      $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $data = @{ width = $b.Width; height = $b.Height }
    }
    elseif ($op -eq 'windows') { $data = @{ items = @(Get-WinList) } }
    elseif ($op -eq 'window') {
      $h = [IntPtr]([long]$req.hwnd)
      if ($req.action -eq 'focus') { [TeleNative]::SetForegroundWindow($h) | Out-Null }
      elseif ($req.action -eq 'minimize') { [TeleNative]::ShowWindow($h, 6) | Out-Null }
      elseif ($req.action -eq 'maximize') { [TeleNative]::ShowWindow($h, 3) | Out-Null }
      elseif ($req.action -eq 'restore') { [TeleNative]::ShowWindow($h, 9) | Out-Null }
      elseif ($req.action -eq 'close') { [TeleNative]::PostMessage($h, 16, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
    }
    elseif ($op -eq 'active') { $data = @{ title = [TeleNative]::Title([TeleNative]::GetForegroundWindow()) } }
    elseif ($op -eq 'launch') { Start-Process -FilePath $req.target; $data = @{ launched = $req.target } }
    elseif ($op -eq 'shell') {
      $out = & cmd.exe /c $req.command 2>&1 | Out-String
      $data = @{ output = $out }
    }
    elseif ($op -eq 'ps') {
      $out = Invoke-Expression $req.command 2>&1 | Out-String
      $data = @{ output = $out }
    }
    elseif ($op -eq 'volume') {
      $vk = @{ up = 175; down = 174; mute = 173 }[$req.action]
      $steps = if ($req.steps) { [int]$req.steps } else { 1 }
      for ($i = 0; $i -lt $steps; $i++) { [TeleNative]::Key([int]$vk, $false); [TeleNative]::Key([int]$vk, $true); Start-Sleep -Milliseconds 40 }
    }
    elseif ($op -eq 'media') {
      $vk = @{ playpause = 179; next = 176; prev = 177; stop = 178 }[$req.action]
      [TeleNative]::Key([int]$vk, $false); [TeleNative]::Key([int]$vk, $true)
    }
    elseif ($op -eq 'clipboard') {
      if ($req.action -eq 'get') { $data = @{ text = (Get-Clipboard -Raw | Out-String) } }
      else { Set-Clipboard -Value $req.text; $data = @{ set = $true } }
    }
    elseif ($op -eq 'system') {
      $a = $req.action
      if ($a -eq 'lock') { rundll32.exe user32.dll,LockWorkStation }
      elseif ($a -eq 'sleep') { Start-Process rundll32.exe -ArgumentList 'powrprof.dll,SetSuspendState','0,1,0' }
      elseif ($a -eq 'logoff') { Start-Process shutdown.exe -ArgumentList '/l','/f' }
      elseif ($a -eq 'restart') { Start-Process shutdown.exe -ArgumentList '/r','/t','10' }
      elseif ($a -eq 'shutdown') { Start-Process shutdown.exe -ArgumentList '/s','/t','10' }
      elseif ($a -eq 'cancel') { Start-Process shutdown.exe -ArgumentList '/a' }
      $data = @{ action = $a }
    }
    elseif ($op -eq 'info') {
      $cs = Get-CimInstance Win32_OperatingSystem
      $data = @{ osName = $cs.Caption; version = $cs.Version; user = $env:USERNAME; machine = $env:COMPUTERNAME }
    }
    else { throw ("op desconhecida: " + $op) }
    Send-Obj @{ id = $req.id; ok = $true; data = $data }
  } catch {
    Send-Obj @{ id = $req.id; ok = $false; error = ($_.Exception.Message) }
  }
}
`;

const WIN_VK = {
  backspace: 8, tab: 9, enter: 13, shift: 16, ctrl: 17, control: 17, alt: 18, option: 18,
  pause: 19, capslock: 20, escape: 27, esc: 27, space: 32, pageup: 33, pagedown: 34, end: 35,
  home: 36, left: 37, up: 38, right: 39, down: 40, printscreen: 44, insert: 45, delete: 46,
  meta: 91, win: 91, command: 91, super: 91, menu: 93,
  volumeup: 175, volumedown: 174, volumemute: 173, playpause: 179, nexttrack: 176, prevtrack: 177,
};
for (let i = 0; i < 26; i++) WIN_VK[String.fromCharCode(97 + i)] = 65 + i;
for (let i = 0; i <= 9; i++) WIN_VK[String(i)] = 48 + i;
for (let i = 1; i <= 24; i++) WIN_VK[`f${i}`] = 111 + i;
Object.assign(WIN_VK, {
  ';': 186, '=': 187, ',': 188, '-': 189, '.': 190, '/': 191, '`': 192,
  '[': 219, '\\': 220, ']': 221, "'": 222, '+': 187,
});

class WinDriver {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.pending = new Map();
    this.seq = 0;
    this.scriptPath = path.join(TMP_DIR, `telepc-agent-${process.pid}.ps1`);
  }

  async start() {
    if (this.child) return;
    fs.writeFileSync(this.scriptPath, PS_SCRIPT, 'utf8');
    const exe = await which('pwsh') ? 'pwsh' : 'powershell.exe';
    this.child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.onData(chunk));
    this.child.stderr.on('data', (d) => {
      const text = d.toString().trim();
      if (text) process.stderr.write(`[powershell] ${text}\n`);
    });
    this.child.on('exit', (code) => {
      this.child = null;
      for (const [, entry] of this.pending) entry.reject(new Error(`PowerShell terminou (codigo ${code})`));
      this.pending.clear();
      setTimeout(() => { this.start().catch(() => {}); }, 2000);
    });
    // wait for the engine to warm up
    await this.request({ op: 'screen' }, 25000);
  }

  onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.startsWith('{')) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const entry = this.pending.get(msg.id);
      if (!entry) continue;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) entry.resolve(msg.data);
      else entry.reject(new Error(msg.error || 'falha no PowerShell'));
    }
  }

  request(payload, timeout = 20000) {
    return new Promise((resolve, reject) => {
      if (!this.child || !this.child.stdin.writable) {
        reject(new Error('Motor PowerShell indisponivel'));
        return;
      }
      const id = String(++this.seq);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('timeout do PowerShell'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}

const win = new WinDriver();

// ---------------------------------------------------------------------------
// macOS: JXA + Quartz (nativo, sem instalacoes) com fallback para cliclick
// ---------------------------------------------------------------------------
const MAC_KEYCODES = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15,
  y: 16, t: 17, o: 31, u: 32, i: 34, p: 35, l: 37, j: 38, k: 40, n: 45, m: 46,
  '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23, '9': 25, '7': 26, '8': 28, '0': 29,
  enter: 36, return: 36, tab: 48, space: 49, backspace: 51, delete: 51, escape: 53, esc: 53,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
  left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121,
  forwarddelete: 117,
};
const MAC_FLAGS = { shift: 0x20000, ctrl: 0x40000, control: 0x40000, alt: 0x80000, option: 0x80000, meta: 0x100000, command: 0x100000, cmd: 0x100000 };
const MAC_MOD_NAMES = { ctrl: 'control down', control: 'control down', alt: 'option down', option: 'option down', shift: 'shift down', meta: 'command down', command: 'command down', cmd: 'command down' };

async function jxa(code, timeout = 15000) {
  return run('osascript', ['-l', 'JavaScript', '-e', code], { timeout });
}
async function applescript(code, timeout = 15000) {
  return run('osascript', ['-e', code], { timeout });
}
function applescriptString(text) {
  return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

let hasCliclick = null;
async function macMouse(action, x, y, button) {
  if (hasCliclick === null) hasCliclick = await which('cliclick');
  const b = button === 'right' ? 'r' : 'l';
  if (hasCliclick) {
    const op = action === 'move' ? 'm' : action === 'down' ? `${b}d` : action === 'up' ? `${b}u` : `${b}`;
    return run('cliclick', [`${op}:${Math.round(x)},${Math.round(y)}`], { timeout: 8000 });
  }
  const event = action === 'move' ? 'kCGEventMouseMoved'
    : action === 'down' ? (button === 'right' ? 'kCGEventRightMouseDown' : 'kCGEventLeftMouseDown')
    : action === 'up' ? (button === 'right' ? 'kCGEventRightMouseUp' : 'kCGEventLeftMouseUp')
    : (button === 'right' ? 'kCGEventRightMouseDown' : 'kCGEventLeftMouseDown');
  const mb = button === 'right' ? 'kCGMouseButtonRight' : 'kCGMouseButtonLeft';
  const code = [
    "ObjC.import('Quartz');",
    `var pt = $.CGPointMake(${Number(x)}, ${Number(y)});`,
    `var mv = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, pt, $.${mb});`,
    '$.CGEventPost($.kCGHIDEventTap, mv);',
    action === 'move' ? '' : `var dn = $.CGEventCreateMouseEvent(null, $.${event}, pt, $.${mb}); $.CGEventPost($.kCGHIDEventTap, dn); delay(0.04);`,
    (action === 'click' || action === 'up') ? `var up = $.CGEventCreateMouseEvent(null, $.${action === 'click' ? (button === 'right' ? 'kCGEventRightMouseUp' : 'kCGEventLeftMouseUp') : event}, pt, $.${mb}); $.CGEventPost($.kCGHIDEventTap, up);` : '',
    "'ok'",
  ].join('\n');
  return jxa(code);
}

// ---------------------------------------------------------------------------
// Linux: xdotool / wmctrl / wtype (X11 e Wayland)
// ---------------------------------------------------------------------------
const isWayland = String(process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland';
let linuxTools = null;
async function getLinuxTools() {
  if (linuxTools) return linuxTools;
  linuxTools = {
    xdotool: await which('xdotool'),
    wmctrl: await which('wmctrl'),
    wtype: await which('wtype'),
    shot: (await which('maim')) || (await which('scrot')) || (await which('grim')) || (await which('import')) || (await which('gnome-screenshot')),
  };
  return linuxTools;
}
const XDO_KEYS = {
  meta: 'super', command: 'super', win: 'super', ctrl: 'ctrl', control: 'ctrl', alt: 'alt', option: 'alt',
  enter: 'Return', return: 'Return', escape: 'Escape', esc: 'Escape', backspace: 'BackSpace',
  delete: 'Delete', space: 'space', tab: 'Tab', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  pageup: 'Prior', pagedown: 'Next', home: 'Home', end: 'End', printscreen: 'Print', capslock: 'Caps_Lock',
};
function xkeyName(name) {
  const k = String(name).toLowerCase();
  if (XDO_KEYS[k]) return XDO_KEYS[k];
  if (/^f\d{1,2}$/.test(k)) return k.toUpperCase();
  return k;
}

// ---------------------------------------------------------------------------
// Captura de ecra multi-plataforma
// ---------------------------------------------------------------------------
async function captureScreen({ scale = DEFAULT_SCALE, quality = DEFAULT_QUALITY } = {}) {
  const file = tempFile('telepc-shot', '.jpg');
  let frameWidth = 0;
  let frameHeight = 0;
  try {
    if (PLATFORM === 'win32') {
      await win.start();
      const data = await win.request({ op: 'shot', path: file, scale, quality }, 25000);
      if (data && data.width) state.screen = { width: data.width, height: data.height };
      frameWidth = Number(data && data.outputWidth) || Math.round((state.screen.width || 1920) * scale);
      frameHeight = Number(data && data.outputHeight) || Math.round((state.screen.height || 1080) * scale);
    } else if (PLATFORM === 'darwin') {
      const r = await run('screencapture', ['-x', '-t', 'jpg', file], { timeout: 15000 });
      if (!r.ok) throw new Error(`screencapture falhou: ${r.stderr}`);
      if (!state.screen.width) {
        const bounds = await applescript('tell application "Finder" to get bounds of window of desktop');
        const parts = String(bounds.stdout).split(',').map((s) => Number(s.trim()));
        if (parts.length === 4 && Number.isFinite(parts[2])) state.screen = { width: parts[2], height: parts[3] };
      }
    } else {
      const tools = await getLinuxTools();
      if (!tools.shot) throw new Error('Instala maim, scrot, grim ou gnome-screenshot para capturar o ecra');
      const shotArgs = tools.shot.endsWith('import') ? ['-window', 'root', file]
        : tools.shot.endsWith('gnome-screenshot') ? ['-f', file]
        : tools.shot.endsWith('grim') ? [file]
        : [file];
      const r = await run(tools.shot, shotArgs, { timeout: 15000 });
      if (!r.ok) throw new Error(`captura falhou: ${r.stderr}`);
      if (!state.screen.width && tools.xdotool) {
        const geo = await run(tools.xdotool, ['getdisplaygeometry'], { timeout: 5000 });
        const [w, h] = String(geo.stdout).trim().split(/\s+/).map(Number);
        if (w && h) state.screen = { width: w, height: h };
      }
    }

    if (!frameWidth) {
      frameWidth = state.screen.width || 1920;
      frameHeight = state.screen.height || 1080;
    }
    let buffer = fs.readFileSync(file);
    // Redimensiona fora do Windows quando a escala pedida e menor que 1.
    if (PLATFORM !== 'win32' && scale < 1 && (await which('sips') || (await which('convert')))) {
      const scaled = tempFile('telepc-scaled', '.jpg');
      const w = Math.max(1, Math.round((state.screen.width || 1920) * scale));
      const useSips = await which('sips');
      const r = useSips
        ? await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(Math.round(quality)), '--resampleWidth', String(w), file, '--out', scaled], { timeout: 15000 })
        : await run('convert', [file, '-resize', `${Math.round(scale * 100)}%`, '-quality', String(Math.round(quality)), scaled], { timeout: 20000 });
      if (r.ok && fs.existsSync(scaled)) {
        buffer = fs.readFileSync(scaled);
        frameWidth = w;
        frameHeight = Math.max(1, Math.round((state.screen.height || 1080) * scale));
      }
      try { fs.unlinkSync(scaled); } catch {}
    }
    return { buffer, bytes: buffer.length, width: frameWidth, height: frameHeight };
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
}

async function readScreenSize() {
  if (state.screen.width) return state.screen;
  if (PLATFORM === 'win32') {
    try {
      await win.start();
      const data = await win.request({ op: 'screen' }, 20000);
      if (data) state.screen = { width: data.width, height: data.height };
    } catch {}
  } else if (PLATFORM === 'darwin') {
    const bounds = await applescript('tell application "Finder" to get bounds of window of desktop');
    const parts = String(bounds.stdout).split(',').map((s) => Number(s.trim()));
    if (parts.length === 4) state.screen = { width: parts[2], height: parts[3] };
  } else {
    const tools = await getLinuxTools();
    if (tools.xdotool) {
      const geo = await run(tools.xdotool, ['getdisplaygeometry'], { timeout: 5000 });
      const [w, h] = String(geo.stdout).trim().split(/\s+/).map(Number);
      if (w && h) state.screen = { width: w, height: h };
    }
  }
  return state.screen;
}

// ---------------------------------------------------------------------------
// Executores por comando
// ---------------------------------------------------------------------------
function splitCombo(combo) {
  return String(combo || '').toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
}

async function pressCombo(keys) {
  if (PLATFORM === 'win32') {
    await win.start();
    const ops = [];
    for (const k of keys) ops.push({ vk: WIN_VK[k] ?? k.toUpperCase().charCodeAt(0), up: false });
    for (const k of [...keys].reverse()) ops.push({ vk: WIN_VK[k] ?? k.toUpperCase().charCodeAt(0), up: true });
    await win.request({ op: 'key', keys: ops });
    return { keys };
  }
  if (PLATFORM === 'darwin') {
    const mods = [];
    let main = null;
    for (const k of keys) { if (MAC_FLAGS[k]) mods.push(MAC_FLAGS[k]); else main = k; }
    const flags = mods.reduce((a, b) => a + b, 0);
    const lines = ["ObjC.import('Quartz');"];
    const press = (code, down) => {
      lines.push(`var e${down ? 'd' : 'u'}${code} = $.CGEventCreateKeyboardEvent(null, ${code}, ${down});`);
      if (flags) lines.push(`$.CGEventSetFlags(e${down ? 'd' : 'u'}${code}, ${flags});`);
      lines.push(`$.CGEventPost($.kCGHIDEventTap, e${down ? 'd' : 'u'}${code});`);
    };
    const code = main ? (MAC_KEYCODES[main] ?? null) : null;
    if (code === null) throw new Error(`Tecla nao suportada em macOS: ${main}`);
    press(code, true);
    lines.push('delay(0.03);');
    press(code, false);
    lines.push("'ok'");
    const r = await jxa(lines.join('\n'));
    if (!r.ok) throw new Error(r.stderr || 'falha ao premir teclas');
    return { keys };
  }
  const tools = await getLinuxTools();
  const combo = keys.map(xkeyName).join('+');
  let sender = null;
  if (tools.xdotool) {
    sender = [tools.xdotool, ['key', '--clearmodifiers', combo]];
  } else if (tools.wtype) {
    const mods = keys.slice(0, -1);
    const main = keys[keys.length - 1];
    const wargs = [];
    for (const m of mods) wargs.push('-M', m === 'super' ? 'logo' : m);
    wargs.push('-P', main, '-p', main);
    for (const m of [...mods].reverse()) wargs.push('-m', m === 'super' ? 'logo' : m);
    sender = [tools.wtype, wargs];
  }
  if (!sender) throw new Error('Instala xdotool (X11) ou wtype (Wayland)');
  const r = await run(sender[0], sender[1], { timeout: 8000 });
  if (!r.ok) throw new Error(r.stderr || 'falha ao premir teclas');
  return { keys, combo };
}

async function typeText(text) {
  if (PLATFORM === 'win32') {
    await win.start();
    await win.request({ op: 'chars', text: String(text) }, 30000);
    return { chars: String(text).length };
  }
  if (PLATFORM === 'darwin') {
    const r = await applescript(`tell application "System Events" to keystroke ${applescriptString(text)}`);
    if (!r.ok) throw new Error(r.stderr || 'falha ao escrever');
    return { chars: String(text).length };
  }
  const tools = await getLinuxTools();
  if (tools.xdotool) {
    const r = await run(tools.xdotool, ['type', '--clearmodifiers', '--delay', '12', '--', String(text)], { timeout: 30000 });
    if (!r.ok) throw new Error(r.stderr);
  } else if (tools.wtype) {
    const r = await run(tools.wtype, ['--', String(text)], { timeout: 30000 });
    if (!r.ok) throw new Error(r.stderr);
  } else throw new Error('Instala xdotool ou wtype');
  return { chars: String(text).length };
}

async function mouseAction(action, payload) {
  const x = num(payload.x, state.screen.width / 2);
  const y = num(payload.y, state.screen.height / 2);
  const button = payload.button === 'right' || payload.button === 'middle' ? payload.button : 'left';

  if (PLATFORM === 'win32') {
    await win.start();
    if (action === 'move') return win.request({ op: 'move', x, y });
    if (action === 'click') {
      await win.request({ op: 'move', x, y });
      await new Promise((r) => setTimeout(r, 25));
      await win.request({ op: 'down', x, y, button });
      await new Promise((r) => setTimeout(r, 40));
      await win.request({ op: 'up', button });
      if (payload.double) {
        await new Promise((r) => setTimeout(r, 60));
        await win.request({ op: 'down', button });
        await new Promise((r) => setTimeout(r, 40));
        await win.request({ op: 'up', button });
      }
      return { x, y, button };
    }
    if (action === 'down') return win.request({ op: 'down', x, y, button });
    if (action === 'up') return win.request({ op: 'up', x, y, button });
  }

  if (PLATFORM === 'darwin') {
    const r = await macMouse(action, x, y, button);
    if (!r.ok) throw new Error(r.stderr || 'falha do rato');
    if (action === 'click' && payload.double) await macMouse('click', x, y, button);
    return { x, y, button };
  }

  const tools = await getLinuxTools();
  if (!tools.xdotool) throw new Error('Instala xdotool');
  const btn = button === 'right' ? '3' : button === 'middle' ? '2' : '1';
  if (action === 'move') await run(tools.xdotool, ['mousemove', '--', String(x), String(y)], { timeout: 8000 });
  else if (action === 'click') {
    await run(tools.xdotool, ['mousemove', '--', String(x), String(y)], { timeout: 8000 });
    await run(tools.xdotool, payload.double ? ['click', '--repeat', '2', '--delay', '70', btn] : ['click', btn], { timeout: 8000 });
  } else if (action === 'down') await run(tools.xdotool, ['mousemove', '--', String(x), String(y), 'mousedown', btn], { timeout: 8000 });
  else if (action === 'up') await run(tools.xdotool, ['mousemove', '--', String(x), String(y), 'mouseup', btn], { timeout: 8000 });
  return { x, y, button };
}

async function scrollAction(payload) {
  const dx = num(payload.dx, 0);
  const dy = num(payload.dy, 0);
  if (PLATFORM === 'win32') {
    await win.start();
    if (payload.x != null) await win.request({ op: 'move', x: num(payload.x, 0), y: num(payload.y, 0) });
    return win.request({ op: 'wheel', dy: Math.round(dy), dx: Math.round(dx) });
  }
  if (PLATFORM === 'darwin') {
    const code = [
      "ObjC.import('Quartz');",
      `var ev = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitPixel, 2, ${Math.round(dy)}, ${Math.round(dx)});`,
      '$.CGEventPost($.kCGHIDEventTap, ev);',
      "'ok'",
    ].join('\n');
    const r = await jxa(code);
    if (!r.ok) throw new Error(r.stderr || 'falha no scroll');
    return { dx, dy };
  }
  const tools = await getLinuxTools();
  if (!tools.xdotool) throw new Error('Instala xdotool');
  const clicks = Math.max(1, Math.round(Math.abs(dy) / 60));
  const button = dy > 0 ? '5' : '4';
  for (let i = 0; i < clicks; i++) await run(tools.xdotool, ['click', button], { timeout: 5000 });
  return { dx, dy };
}

async function listWindows() {
  if (PLATFORM === 'win32') {
    await win.start();
    const data = await win.request({ op: 'windows' });
    // ConvertTo-Json do PowerShell 5.1 desfaz arrays de um so elemento.
    const items = data && data.items !== undefined ? data.items : data;
    if (Array.isArray(items)) return items;
    return items ? [items] : [];
  }
  if (PLATFORM === 'darwin') {
    const script = [
      'tell application "System Events"',
      'set out to ""',
      'repeat with p in (every process whose background only is false)',
      'set out to out & (name of p) & "||" & (unix id of p) & "\\n"',
      'end repeat',
      'return out',
      'end tell',
    ].join('\n');
    const r = await applescript(script);
    return String(r.stdout).split('\n').filter(Boolean).map((line, i) => {
      const [title, pid] = line.split('||');
      return { id: String(pid || i), title: title || 'Janela', app: title || '', active: false };
    });
  }
  const tools = await getLinuxTools();
  if (tools.wmctrl) {
    const r = await run(tools.wmctrl, ['-l'], { timeout: 8000 });
    return String(r.stdout).split('\n').filter(Boolean).map((line) => {
      const parts = line.split(/\s+/);
      return { id: parts[0], title: parts.slice(4).join(' '), app: parts[3] || '', active: false };
    });
  }
  if (tools.xdotool) {
    const r = await run(tools.xdotool, ['search', '--name', ''], { timeout: 8000 });
    const ids = String(r.stdout).split('\n').filter(Boolean).slice(0, 60);
    const out = [];
    for (const id of ids) {
      const name = await run(tools.xdotool, ['getwindowname', id], { timeout: 3000 });
      const title = String(name.stdout).trim();
      if (title) out.push({ id, title, app: '', active: false });
    }
    return out;
  }
  throw new Error('Instala wmctrl ou xdotool');
}

async function windowAction(payload) {
  const action = String(payload.action || 'focus');
  const id = String(payload.id || '');
  if (!id) throw new Error('id da janela em falta');
  if (PLATFORM === 'win32') {
    await win.start();
    return win.request({ op: 'window', hwnd: id, action });
  }
  if (PLATFORM === 'darwin') {
    if (action === 'focus') {
      const r = await applescript(`tell application "System Events" to set frontmost of (first process whose unix id is ${Number(id) || 0}) to true`);
      if (!r.ok) throw new Error(r.stderr);
      return { action, id };
    }
    if (action === 'close') {
      const r = await applescript(`tell application "System Events" to tell (first process whose unix id is ${Number(id) || 0}) to set value of attribute "AXPressed" of (first button whose subrole is "AXCloseButton") of window 1 to true`);
      if (!r.ok) throw new Error(r.stderr);
      return { action, id };
    }
    throw new Error(`Acao "${action}" nao suportada em macOS`);
  }
  const tools = await getLinuxTools();
  if (!tools.wmctrl) throw new Error('Instala wmctrl');
  const flag = action === 'focus' ? ['-i', '-a', id]
    : action === 'minimize' ? ['-i', '-b', 'add,hidden', id]
    : action === 'maximize' ? ['-i', '-b', 'toggle,maximized_vert,maximized_horz', id]
    : action === 'restore' ? ['-i', '-b', 'remove,hidden', id]
    : action === 'close' ? ['-i', '-c', id] : null;
  if (!flag) throw new Error(`Acao desconhecida: ${action}`);
  const r = await run(tools.wmctrl, flag, { timeout: 8000 });
  if (!r.ok) throw new Error(r.stderr);
  return { action, id };
}

async function launchApp(target) {
  const value = String(target || '').trim();
  if (!value) throw new Error('Indica a aplicacao');
  if (PLATFORM === 'win32') {
    await win.start();
    return win.request({ op: 'launch', target: value });
  }
  if (PLATFORM === 'darwin') {
    const map = { chrome: 'Google Chrome', msedge: 'Microsoft Edge', firefox: 'Firefox', notepad: 'TextEdit', calc: 'Calculator', terminal: 'Terminal', explorer: 'Finder', code: 'Visual Studio Code', spotify: 'Spotify' };
    const app = map[value.toLowerCase()] || value;
    const r = await run('open', ['-a', app], { timeout: 10000 });
    if (!r.ok) {
      const r2 = await run('open', [value.startsWith('/') ? value : `/Applications/${app}.app`], { timeout: 10000 });
      if (!r2.ok) throw new Error(r2.stderr || `Nao consegui abrir ${app}`);
    }
    return { launched: app };
  }
  const r = await run('/bin/sh', ['-c', `nohup ${value} >/dev/null 2>&1 &`], { timeout: 8000 });
  if (!r.ok) throw new Error(r.stderr);
  return { launched: value };
}

async function runShell(command) {
  const cmd = String(command || '').trim();
  if (!cmd) throw new Error('Comando vazio');
  if (PLATFORM === 'win32') {
    await win.start();
    const data = await win.request({ op: 'shell', command: cmd }, 60000);
    return { output: String(data && data.output ? data.output : '').slice(0, 20000) };
  }
  const shell = PLATFORM === 'darwin' ? '/bin/zsh' : '/bin/bash';
  const r = await run(shell, ['-lc', cmd], { timeout: 60000 });
  const output = `${r.stdout || ''}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`.slice(0, 20000);
  return { output, code: r.code };
}

async function systemAction(action) {
  if (PLATFORM === 'win32') {
    await win.start();
    if (action === 'info') return win.request({ op: 'info' });
    return win.request({ op: 'system', action });
  }
  if (PLATFORM === 'darwin') {
    const map = {
      lock: 'tell application "System Events" to keystroke "q" using {command down, control down}',
      sleep: 'tell application "System Events" to sleep',
      restart: 'tell application "System Events" to restart',
      shutdown: 'tell application "System Events" to shut down',
      logoff: 'tell application "System Events" to log out',
    };
    if (action === 'info') {
      const r = await run('sw_vers', [], { timeout: 5000 });
      return { osName: 'macOS', version: String(r.stdout).replace(/\n/g, ' '), user: os.userInfo().username, machine: os.hostname() };
    }
    if (!map[action]) throw new Error(`Acao nao suportada: ${action}`);
    const r = await applescript(map[action]);
    if (!r.ok) throw new Error(r.stderr || 'falha');
    return { action };
  }
  const cmds = {
    lock: 'loginctl lock-session || xdg-screensaver lock || xset dpms force off',
    sleep: 'systemctl suspend',
    restart: 'systemctl reboot',
    shutdown: 'systemctl poweroff',
    logoff: 'loginctl terminate-user $USER',
  };
  if (action === 'info') {
    const r = await run('/bin/sh', ['-c', 'uname -a; cat /etc/os-release 2>/dev/null | head -2'], { timeout: 5000 });
    return { osName: 'Linux', version: String(r.stdout).split('\n')[0], user: os.userInfo().username, machine: os.hostname() };
  }
  if (!cmds[action]) throw new Error(`Acao nao suportada: ${action}`);
  const r = await run('/bin/sh', ['-c', cmds[action]], { timeout: 15000 });
  return { action, code: r.code, output: String(r.stdout).slice(0, 500) };
}

async function clipboardAction(payload) {
  const action = payload.action === 'set' ? 'set' : 'get';
  if (PLATFORM === 'win32') {
    await win.start();
    return win.request({ op: 'clipboard', action, text: String(payload.text || '') });
  }
  if (PLATFORM === 'darwin') {
    if (action === 'get') {
      const r = await run('pbpaste', [], { timeout: 5000 });
      return { text: String(r.stdout).slice(0, 8000) };
    }
    const r = await run('pbcopy', [], { timeout: 5000, input: String(payload.text || '') });
    if (!r.ok) throw new Error(r.stderr);
    return { set: true };
  }
  const getter = (await which('xclip')) ? ['xclip', ['-selection', 'clipboard', '-o']]
    : (await which('wl-paste')) ? ['wl-paste', []]
    : (await which('xsel')) ? ['xsel', ['--clipboard', '--output']] : null;
  if (action === 'get') {
    if (!getter) throw new Error('Instala xclip, xsel ou wl-clipboard');
    const r = await run(getter[0], getter[1], { timeout: 5000 });
    return { text: String(r.stdout).slice(0, 8000) };
  }
  const setter = (await which('xclip')) ? ['xclip', ['-selection', 'clipboard'], String(payload.text || '')]
    : (await which('wl-copy')) ? ['wl-copy', [String(payload.text || '')], null]
    : null;
  if (!setter) throw new Error('Instala xclip ou wl-clipboard');
  const r = await run(setter[0], setter[1], { timeout: 5000, input: setter[2] });
  if (!r.ok) throw new Error(r.stderr);
  return { set: true };
}

async function volumeAction(payload) {
  const action = ['up', 'down', 'mute'].includes(payload.action) ? payload.action : 'up';
  const steps = clamp(num(payload.steps, 1), 1, 20);
  if (PLATFORM === 'win32') {
    await win.start();
    return win.request({ op: 'volume', action, steps });
  }
  if (PLATFORM === 'darwin') {
    const script = action === 'mute' ? 'set volume output muted (not (output muted of (get volume settings)))'
      : `set volume output volume ((output volume of (get volume settings)) ${action === 'up' ? '+' : '-'} ${steps * 6})`;
    const r = await applescript(script);
    if (!r.ok) throw new Error(r.stderr);
    return { action };
  }
  const tool = (await which('pactl')) ? ['pactl', action === 'mute' ? ['set-sink-mute', '@DEFAULT_SINK@', 'toggle'] : ['set-sink-volume', '@DEFAULT_SINK@', `${action === 'up' ? '+' : '-'}${steps * 5}%`]]
    : (await which('amixer')) ? ['amixer', ['-q', 'sset', 'Master', action === 'mute' ? 'toggle' : `${steps * 5}%${action === 'up' ? '+' : '-'}`]] : null;
  if (!tool) throw new Error('Instala pactl (pulseaudio) ou amixer (alsa)');
  const r = await run(tool[0], tool[1], { timeout: 5000 });
  if (!r.ok) throw new Error(r.stderr);
  return { action };
}

async function mediaAction(payload) {
  const action = ['playpause', 'next', 'prev', 'stop'].includes(payload.action) ? payload.action : 'playpause';
  if (PLATFORM === 'win32') {
    await win.start();
    return win.request({ op: 'media', action });
  }
  if (PLATFORM === 'darwin') {
    const verb = { playpause: 'playpause', next: 'next track', prev: 'previous track', stop: 'stop' }[action];
    const players = ['Music', 'Spotify'];
    for (const player of players) {
      const running = await applescript(`application "${player}" is running`);
      if (String(running.stdout).trim() !== 'true') continue;
      const r = await applescript(`tell application "${player}" to ${verb}`);
      if (r.ok) return { action, player };
    }
    throw new Error('Nenhum leitor de musica aberto (Music ou Spotify)');
  }
  const r = await run('/bin/sh', ['-c', `playerctl ${action === 'playpause' ? 'play-pause' : action === 'next' ? 'next' : action === 'prev' ? 'previous' : 'stop'} 2>&1 || xdotool key XF86AudioPlay`], { timeout: 8000 });
  if (!r.ok) throw new Error(r.stderr);
  return { action };
}

async function activeWindowTitle() {
  try {
    if (PLATFORM === 'win32') {
      await win.start();
      const data = await win.request({ op: 'active' }, 8000);
      return String((data && data.title) || '');
    }
    if (PLATFORM === 'darwin') {
      const r = await applescript('tell application "System Events" to get name of first process whose frontmost is true');
      return String(r.stdout).trim();
    }
    const tools = await getLinuxTools();
    if (tools.xdotool) {
      const r = await run(tools.xdotool, ['getactivewindow', 'getwindowname'], { timeout: 5000 });
      return String(r.stdout).trim();
    }
  } catch { /* ignore */ }
  return '';
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------
async function execute(cmd) {
  const p = cmd.payload || {};
  switch (cmd.type) {
    case 'ping': return { pong: true, platform: PLATFORM, agent: AGENT_VERSION, screen: await readScreenSize() };
    case 'screenshot': {
      const shot = await captureScreen({ scale: num(p.scale, DEFAULT_SCALE), quality: num(p.quality, DEFAULT_QUALITY) });
      return { base64: shot.buffer.toString('base64'), bytes: shot.bytes, width: shot.width, height: shot.height };
    }
    case 'stream': {
      if (p.on === false) { stopStream(); return { streaming: false }; }
      state.stream.fps = clamp(num(p.fps, state.stream.fps), 1, 12);
      state.stream.scale = clamp(num(p.scale, state.stream.scale), 0.3, 1);
      state.stream.quality = clamp(num(p.quality, state.stream.quality), 25, 92);
      state.stream.active = true;
      state.stream.until = Date.now() + 12000;
      startStream();
      return { streaming: true, fps: state.stream.fps, scale: state.stream.scale };
    }
    case 'move': return mouseAction('move', p);
    case 'click': return mouseAction('click', p);
    case 'dragStart': state.dragging = true; return mouseAction('down', p);
    case 'dragMove': return mouseAction('move', p);
    case 'dragEnd': state.dragging = false; return mouseAction('up', p);
    case 'scroll': return scrollAction(p);
    case 'type': return typeText(String(p.text ?? ''));
    case 'key': return pressCombo([String(p.name || p.key || 'enter').toLowerCase()]);
    case 'hotkey': return pressCombo(splitCombo(p.combo));
    case 'windows': return { windows: await listWindows() };
    case 'window': return windowAction(p);
    case 'apps': return { apps: defaultApps() };
    case 'launch': return launchApp(p.target ?? p.app);
    case 'shell': return runShell(p.command);
    case 'system': return systemAction(String(p.action || 'info'));
    case 'volume': return volumeAction(p);
    case 'media': return mediaAction(p);
    case 'clipboard': return clipboardAction(p);
    default: throw new Error(`Comando desconhecido: ${cmd.type}`);
  }
}

function defaultApps() {
  if (PLATFORM === 'win32') {
    return [
      { target: 'chrome', label: 'Chrome' }, { target: 'msedge', label: 'Edge' }, { target: 'firefox', label: 'Firefox' },
      { target: 'explorer', label: 'Explorador' }, { target: 'notepad', label: 'Bloco de notas' }, { target: 'calc', label: 'Calculadora' },
      { target: 'taskmgr', label: 'Gestor de tarefas' }, { target: 'code', label: 'VS Code' }, { target: 'spotify', label: 'Spotify' },
      { target: 'cmd', label: 'CMD' }, { target: 'powershell', label: 'PowerShell' },
    ];
  }
  if (PLATFORM === 'darwin') {
    return [
      { target: 'chrome', label: 'Chrome' }, { target: 'safari', label: 'Safari' }, { target: 'firefox', label: 'Firefox' },
      { target: 'finder', label: 'Finder' }, { target: 'notepad', label: 'TextEdit' }, { target: 'calc', label: 'Calculadora' },
      { target: 'terminal', label: 'Terminal' }, { target: 'code', label: 'VS Code' }, { target: 'spotify', label: 'Spotify' },
    ];
  }
  return [
    { target: 'firefox', label: 'Firefox' }, { target: 'google-chrome', label: 'Chrome' }, { target: 'nautilus', label: 'Ficheiros' },
    { target: 'gedit', label: 'Editor' }, { target: 'gnome-terminal', label: 'Terminal' }, { target: 'code', label: 'VS Code' },
    { target: 'spotify', label: 'Spotify' }, { target: 'gimp', label: 'GIMP' },
  ];
}

// ---------------------------------------------------------------------------
// Streaming de ecra
// ---------------------------------------------------------------------------
function startStream() {
  if (state.stream.timer) return;
  const tick = async () => {
    if (Date.now() > state.stream.until || !state.deviceId) { stopStream(); return; }
    if (state.stream.busy) return;
    state.stream.busy = true;
    const startedAt = Date.now();
    try {
      const shot = await captureScreen({ scale: state.stream.scale, quality: state.stream.quality });
      const captureMs = Date.now() - startedAt;
      const frameResult = await apiFrame(shot.buffer, {
        width: shot.width,
        height: shot.height,
        screenWidth: state.screen.width,
        screenHeight: state.screen.height,
        captureMs,
        quality: state.stream.quality,
        scale: state.stream.scale,
      });
      if (!frameResult.ok) throw new Error(frameResult.error || `frame HTTP ${frameResult.status}`);
    } catch (error) {
      log(`frame falhou: ${error.message}`);
    } finally {
      state.stream.busy = false;
    }
    const interval = 1000 / state.stream.fps;
    const wait = Math.max(55, interval - (Date.now() - startedAt));
    state.stream.timer = setTimeout(tick, wait);
  };
  state.stream.timer = setTimeout(tick, 60);
}

function stopStream() {
  state.stream.active = false;
  if (state.stream.timer) { clearTimeout(state.stream.timer); state.stream.timer = null; }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function apiFrame(buffer, meta, { timeout = 25000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${HUB}/api/agent/frame`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(buffer.length),
        'X-Device-Id': String(state.deviceId || ''),
        'X-Device-Token': String(state.deviceToken || ''),
        'X-Frame-Width': String(meta.width || 0),
        'X-Frame-Height': String(meta.height || 0),
        'X-Screen-Width': String(meta.screenWidth || 0),
        'X-Screen-Height': String(meta.screenHeight || 0),
        'X-Capture-Ms': String(meta.captureMs || 0),
        'X-Quality': String(meta.quality || 0),
        'X-Scale': String(meta.scale || 0),
      },
      body: buffer,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { ok: res.ok, status: res.status, json, error: res.ok ? null : ((json && json.error) || text.slice(0, 120)) };
  } catch (error) {
    return { ok: false, status: 0, error: error.message, json: null };
  } finally {
    clearTimeout(timer);
  }
}

async function api(pathname, body, { timeout = 25000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${HUB}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: res.ok, status: res.status, json };
  } catch (error) {
    return { ok: false, status: 0, error: error.message, json: null };
  } finally {
    clearTimeout(timer);
  }
}

async function apiGet(pathname, { timeout = 25000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${HUB}${pathname}`, { signal: controller.signal, headers: { 'x-device-token': String(state.deviceToken || '') } });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: res.ok, status: res.status, json };
  } catch (error) {
    return { ok: false, status: 0, error: error.message, json: null };
  } finally {
    clearTimeout(timer);
  }
}

function log(msg) {
  const stamp = new Date().toISOString().slice(11, 19);
  process.stdout.write(`[${stamp}] ${msg}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Avisa o hub de uma tentativa falhada para o telemovel poder explicar o erro. */
async function helloBeacon(status, detail) {
  const body = {
    name: NAME,
    platform: PLATFORM,
    osRelease: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    agentVersion: AGENT_VERSION,
    hub: HUB,
    status: status || 0,
    detail: String(detail || '').slice(0, 240),
    tokenPrefix: PAIR_TOKEN ? PAIR_TOKEN.slice(0, 3) : '',
  };
  const targets = HUB_CANDIDATES.length ? HUB_CANDIDATES : [HUB];
  for (const target of targets) {
    try {
      await fetch(`${target}/api/agent/hello`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      return;
    } catch {
      /* tentar o proximo */
    }
  }
}

function describeFailure(res) {
  if (res.status === 0) return `nao consegui chegar ao hub (${res.error || 'sem rede'})`;
  if (res.status === 401 && res.json) return 'o codigo de emparelhamento esta errado';
  // Resposta sem JSON = pagina web, login, proxy ou servidor antigo: nao e a app.
  if (!res.json) return `este endereco respondeu, mas nao e a app TelePC (estado ${res.status})`;
  if (res.status === 404) return 'este endereco nao e um hub TelePC (404)';
  if (res.status >= 500) return `o hub respondeu com erro ${res.status}`;
  return res.json.error || `estado ${res.status}`;
}

// ---------------------------------------------------------------------------
// Registo + ciclos principais
// ---------------------------------------------------------------------------
function loadSaved() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
function saveConfig(extra) {
  try {
    const saved = { ...loadSaved(), ...extra };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(saved, null, 2));
  } catch { /* sem permissao — continua na mesma */ }
}

async function cpuSample() {
  const snap = os.cpus().map((c) => c.times);
  if (!state.cpu.prev) { state.cpu.prev = snap; return 0; }
  let idle = 0; let total = 0;
  snap.forEach((c, i) => {
    const p = state.cpu.prev[i];
    if (!p) return;
    idle += c.idle - p.idle;
    total += (c.user + c.nice + c.sys + c.irq + c.idle) - (p.user + p.nice + p.sys + p.irq + p.idle);
  });
  state.cpu.prev = snap;
  return total > 0 ? Math.round((1 - idle / total) * 100) : 0;
}

function promptLine(question) {
  return new Promise((resolve) => {
    let readline;
    try {
      readline = require('readline');
    } catch {
      resolve('');
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

function normalizeHub(value) {
  let v = String(value || '').trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  return v;
}

function promptNewCode() {
  return new Promise((resolve) => {
    let readline;
    try {
      readline = require('readline');
    } catch {
      resolve('');
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n  Escreve o codigo ATUAL da app do telemovel (ou Enter para tentar outra vez): ', (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

function hintsFor(status, hasJson) {
  if (!hasJson && status !== 0) {
    console.log('     • O endereco mudou (o servidor foi reiniciado) ou pede login no navegador.');
    console.log('     • Abre a app no telemovel > Ligar o teu PC > copia o "Endereco do teu hub".');
    return;
  }
  if (status === 0) {
    console.log('     • O endereco do hub pode ter mudado (o servidor reiniciou).');
    console.log('     • Abre a app no telemovel e descarrega o instalador outra vez.');
    console.log('     • Confirma que o PC tem internet.');
  } else if (status === 401) {
    console.log('     • O codigo muda quando geras um novo na app.');
    console.log('     • Copia o codigo ATUAL em «Ligar o teu PC» e corre o instalador de novo.');
  } else if (status === 404) {
    console.log('     • O endereco nao comeca por http:// ou https://?');
    console.log('     • O endereco tem de ser exatamente o que a app mostra.');
  } else if (status >= 500) {
    console.log('     • O hub teve um problema momentaneo: vou tentar de novo.');
  }
}

/** Liga ao hub, com tentativas eternas e mensagens que se percebem. */
async function connectWithRetry() {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const targets = HUB_CANDIDATES.length ? HUB_CANDIDATES : [HUB].filter(Boolean);
    let roundUnreachable = true;
    for (const candidate of targets) {
      HUB = candidate;
      process.stdout.write(`\n  A ligar a ${HUB} ...\n`);
      const saved = loadSaved();
      const screen = await readScreenSize();
      const payload = {
        token: PAIR_TOKEN,
        deviceId: saved.deviceId,
        name: NAME,
        platform: PLATFORM,
        osRelease: os.release(),
        arch: os.arch(),
        agentVersion: AGENT_VERSION,
        screenWidth: screen.width || undefined,
        screenHeight: screen.height || undefined,
        cpuCount: os.cpus().length,
        totalMemoryMb: Math.round(os.totalmem() / 1048576),
      };
      const res = await api('/api/agent/register', payload, { timeout: 20000 });

      if (res.ok && res.json && res.json.ok) {
        state.deviceId = res.json.deviceId;
        state.deviceToken = res.json.deviceToken;
        saveConfig({ deviceId: state.deviceId, deviceToken: state.deviceToken, hub: HUB });
        return res.json;
      }

      const reason = describeFailure(res);
      if (res.json && (res.status === 401 || res.status >= 500)) roundUnreachable = false;
      log(`nao ligou: ${reason}`);
      await helloBeacon(res.status || 0, reason);
      hintsFor(res.status, Boolean(res.json));

      if (res.status === 401 && res.json) {
        if (process.stdin && process.stdin.isTTY) {
          const typed = await promptNewCode();
          if (typed) {
            PAIR_TOKEN = typed.trim().toUpperCase();
            log('codigo atualizado — a tentar outra vez agora');
            attempt = 0;
            continue;
          }
        } else {
          log('sem terminal interativo: gera um codigo novo e volta a correr o instalador');
          await sleep(15000);
        }
      }
    }

    // Todos os enderecos falharam por rede/pagina errada: pedir o atual.
    if (roundUnreachable && process.stdin && process.stdin.isTTY) {
      console.log('');
      console.log('  Nenhum destes enderecos respondeu como app TelePC:');
      for (const c of targets) console.log('    - ' + c);
      console.log('  O endereco muda quando o servidor e reiniciado. Abre a app no');
      console.log('  telemovel > Ligar o teu PC > copia o "Endereco do teu hub".');
      const typed = normalizeHub(await promptLine('\n  Endereco atual da app (Enter para tentar de novo): '));
      if (typed) {
        HUB_CANDIDATES.length = 0;
        HUB_CANDIDATES.push(typed);
        HUB = typed;
        log('endereco atualizado para ' + typed);
        attempt = 0;
        continue;
      }
    }

    const wait = Math.min(5 * attempt, 30);
    log(`nova tentativa automatica em ${wait}s (Ctrl+C para sair)`);
    await sleep(wait * 1000);
  }
}

async function pollLoop() {
  let failures = 0;
  const tick = async () => {
    try {
      const res = await apiGet(`/api/agent/poll?deviceId=${encodeURIComponent(state.deviceId)}&deviceToken=${encodeURIComponent(state.deviceToken)}&wait=8000`, { timeout: 20000 });
      if (res.status === 401) {
        state.expiredStreak = (state.expiredStreak || 0) + 1;
        // Emparelha e, no pedido seguinte, é logo rejeitado: sinal claro de que
        // o hub corre em "serverless" (cada pedido vai para uma cópia diferente).
        if (state.expiredStreak >= 3) {
          console.log('');
          console.log('  ============================================================');
          console.log('   O servidor aceita o emparelhamento mas rejeita logo a sessao.');
          console.log('   Causa provavel: o hub esta alojado num servico "serverless"');
          console.log('   (ex.: Vercel/Netlify), onde cada pedido vai para uma copia');
          console.log('   diferente do servidor e a sessao nao e partilhada.');
          console.log('');
          console.log('   Solucao: aloja o TelePC num servidor SEMPRE-LIGADO:');
          console.log('     - Render.com  (Web Service, gratis)');
          console.log('     - Railway.app  ou  Fly.io');
          console.log('   Depois descarrega o instalador desse novo endereco.');
          console.log('  ============================================================');
          console.log('');
          state.expiredStreak = 0;
          await sleep(20000);
          return;
        }
        log('Sessao expirada — a voltar a emparelhar com a app...');
        await connectWithRetry();
      } else if (!res.ok) {
        throw new Error(res.error || `estado ${res.status}`);
      } else {
        failures = 0;
        state.expiredStreak = 0;
        const commands = (res.json && res.json.commands) || [];
        if (commands.length) log(`recebidos ${commands.length} comando(s)`);
        await runCommands(commands);
      }
    } catch (error) {
      failures++;
      if (failures % 5 === 1) log(`ligacao ao hub falhou: ${error.message}`);
      await new Promise((r) => setTimeout(r, Math.min(1000 * failures, 8000)));
    }
    setTimeout(tick, 20);
  };
  tick();
}

async function runCommands(commands) {
  const results = [];
  for (const cmd of commands) {
    const startedAt = Date.now();
    let result;
    try {
      const data = await execute(cmd);
      result = { id: cmd.id, ok: true, data, ms: Date.now() - startedAt };
      if (cmd.type !== 'move' && cmd.type !== 'dragMove' && cmd.type !== 'screenshot') {
        log(`${cmd.type} ok (${result.ms}ms)`);
      }
    } catch (error) {
      result = { id: cmd.id, ok: false, error: error.message, ms: Date.now() - startedAt };
      log(`${cmd.type} falhou: ${error.message}`);
    }
    results.push(result);
    // Envia logo os resultados criticos para a UI nao esperar pelo lote.
    if (results.length >= 8) { await flush(results.splice(0, results.length)); }
  }
  if (results.length) await flush(results);
}

async function flush(results) {
  await api('/api/agent/result', { deviceId: state.deviceId, deviceToken: state.deviceToken, results });
}

async function beatLoop() {
  const tick = async () => {
    try {
      const load = await cpuSample();
      state.activeWindow = await activeWindowTitle();
      const screen = state.screen.width ? state.screen : await readScreenSize();
      await api('/api/agent/result', {
        deviceId: state.deviceId,
        deviceToken: state.deviceToken,
        results: [],
        presence: {
          name: NAME,
          platform: PLATFORM,
          screenWidth: screen.width || undefined,
          screenHeight: screen.height || undefined,
          stats: {
            cpuLoad: load,
            freeMemoryMb: Math.round(os.freemem() / 1048576),
            uptimeSeconds: Math.round(os.uptime()),
            activeWindow: state.activeWindow,
          },
        },
      }, { timeout: 10000 });
    } catch { /* o poll trata da reconexao */ }
  };
  await tick();
  setInterval(tick, 5000);
}

async function main() {
  console.log('=========================================================');
  console.log(`  TelePC Agent ${AGENT_VERSION}  ·  ${PLATFORM} ${os.arch()}`);
  console.log('=========================================================');

  if (typeof fetch !== 'function') {
    console.error('Precisas de Node.js 18 ou superior (fetch nativo).');
    process.exit(1);
  }
  if (!HUB) {
    console.error('Falta o hub. Exemplo:');
    console.error('  node pc-agent.js --hub http://192.168.1.20:3000 --token ABC-123');
    process.exit(1);
  }
  if (!PAIR_TOKEN) {
    console.error('Falta o codigo de emparelhamento (--token), visivel na app do telemovel.');
    process.exit(1);
  }

  log(`hub: ${HUB_CANDIDATES.join(' ou ') || '(nenhum)'}`);
  log('a emparelhar com a app do telemovel...');
  const info = await connectWithRetry();
  console.log('');
  console.log('  ============================================================');
  console.log('   LIGADO  ✔  este PC ja obedece ao telemovel');
  console.log(`   nome: ${NAME}`);
  console.log('   deixa esta janela ABERTA enquanto usas a app');
  console.log('   para parar: Ctrl+C');
  console.log('  ============================================================');
  console.log('');

  if (PLATFORM === 'win32') {
    try {
      await win.start();
      log('motor PowerShell pronto (rato/teclado/janelas/shell)');
    } catch (error) {
      log(`aviso: PowerShell indisponivel (${error.message})`);
    }
  } else if (PLATFORM === 'linux') {
    const tools = await getLinuxTools();
    log(`ferramentas: xdotool=${tools.xdotool ? 'sim' : 'nao'} wmctrl=${tools.wmctrl ? 'sim' : 'nao'} captura=${tools.shot || 'nenhuma'}`);
    if (isWayland) log('sessao Wayland detectada — algumas accoes precisam de wtype/grim');
  } else {
    hasCliclick = await which('cliclick');
    log(` rato: ${hasCliclick ? 'cliclick (rapido)' : 'Quartz/JXA nativo (instala cliclick para mais velocidade)'}`);
  }

  await readScreenSize();
  if (state.screen.width) log(`ecra: ${state.screen.width}x${state.screen.height}`);

  pollLoop();
  beatLoop();

  log('a escutar comandos do telemovel. Ctrl+C para sair.');

  const shutdown = () => {
    log('a terminar...');
    stopStream();
    try { fs.unlinkSync(win.scriptPath); } catch {}
    if (win.child) { try { win.child.kill(); } catch {} }
    setTimeout(() => process.exit(0), 200);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.log('');
  console.error('  Nao consegui arrancar o agente.');
  console.error('  Detalhe:', (error && error.message) || error);
  console.log('');
  console.log('  O que fazer:');
  console.log('   1. Abre a app TelePC no telemovel.');
  console.log('   2. Toca em «Ligar o teu PC» e descarrega o instalador outra vez.');
  console.log('   3. Corre o instalador novo (traz o endereco e o codigo certos).');
  console.log('');
  process.exit(1);
});
