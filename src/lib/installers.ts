/**
 * Instaladores de duplo clique.
 *
 * Princípios:
 *  - O agente vai EMBUTIDO (base64) no instalador: não há segundo download que
 *    possa falhar ou devolver uma página HTML.
 *  - Antes de arrancar, o instalador TESTA cada endereço do hub (/api/health)
 *    e usa o primeiro que responder como hub TelePC. Se nenhum servir, pede ao
 *    utilizador o endereço que a app mostra.
 *  - Se não houver Node.js, descarrega uma versão portátil (sem admin).
 */

const NODE_VERSION = "v22.14.0";

export type InstallerOs = "windows" | "macos" | "linux";

export function installerFilename(os: InstallerOs): string {
  if (os === "windows") return "Instalar-TelePC-Windows.bat";
  if (os === "macos") return "Instalar-TelePC-Mac.command";
  return "instalar-telepc.sh";
}

/** Injeta hub(s) e código no código-fonte do agente. */
export function configureAgent(source: string, hubs: string[], token: string): string {
  return source
    .replace(/const INJECTED_HUB = ".*?";/, `const INJECTED_HUB = ${JSON.stringify(hubs.join(","))};`)
    .replace(/const INJECTED_TOKEN = ".*?";/, `const INJECTED_TOKEN = ${JSON.stringify(token)};`);
}

function wrap76(b64: string): string[] {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines;
}

/* ------------------------------------------------------------------ windows */

function windowsScript(hubs: string[], token: string, agentB64Lines: string[]): string {
  const cands = hubs.join(",");
  const primary = hubs[0] ?? "";
  const lines = [
    "@echo off",
    "setlocal EnableExtensions EnableDelayedExpansion",
    "chcp 65001 >nul",
    "title TelePC - ligar este PC ao telemovel",
    'cd /d "%~dp0"',
    'set "CANDS=' + cands + '"',
    'set "TOKEN=' + token + '"',
    'set "HUB="',
    "echo.",
    "echo  ============================================================",
    "echo   TelePC - instalador para Windows",
    "echo   Este programa liga o teu PC a app do telemovel.",
    "echo  ============================================================",
    "echo.",
    // ---------------------------------------------------------- node
    "echo [1/4] A verificar o Node.js...",
    'set "NODE_EXE="',
    'where node >nul 2>nul && set "NODE_EXE=node"',
    'if not defined NODE_EXE if exist "%LOCALAPPDATA%\\TelePC" (',
    '  for /d %%D in ("%LOCALAPPDATA%\\TelePC\\node-*-win-*") do if exist "%%D\\node.exe" set "NODE_EXE=%%D\\node.exe"',
    ")",
    "if defined NODE_EXE (",
    "  echo       Node.js pronto.",
    "  goto extract",
    ")",
    "echo       Node.js nao encontrado: vou usar uma versao portatil (nao precisa de admin).",
    'set "ARCH=x64"',
    'if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"',
    'set "DEST=%LOCALAPPDATA%\\TelePC"',
    'if not exist "%DEST%" mkdir "%DEST%" >nul 2>nul',
    'set "TELEPC_ARCH=%ARCH%"',
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference='Stop'; $zip=Join-Path $env:TEMP 'telepc-node.zip'; Write-Host '      a transferir (uma vez, ~30 MB)...'; Invoke-WebRequest -UseBasicParsing ('https://nodejs.org/dist/" +
      NODE_VERSION +
      "/node-" +
      NODE_VERSION +
      "-win-' + $env:TELEPC_ARCH + '.zip') -OutFile $zip; Write-Host '      a extrair...'; Expand-Archive -Force $zip $env:DEST\"",
    "if errorlevel 1 goto nodefail",
    'for /d %%D in ("%DEST%\\node-*-win-*") do if exist "%%D\\node.exe" set "NODE_EXE=%%D\\node.exe"',
    "if not defined NODE_EXE goto nodefail",
    "echo       Node.js portatil pronto.",
    "goto extract",
    ":nodefail",
    "echo.",
    "echo   Nao consegui preparar o Node.js automaticamente.",
    "echo   1. Vai a https://nodejs.org e instala a versao LTS (next, next, finish).",
    "echo   2. Fecha esta janela e faz duplo clique neste instalador outra vez.",
    "goto end",
    // ------------------------------------------------------- extract
    ":extract",
    "echo.",
    "echo [2/4] A preparar o agente TelePC (vem dentro deste ficheiro)...",
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$l=[IO.File]::ReadAllLines('%~f0'); $i=[Array]::IndexOf($l,'::AGENT_B64_BEGIN'); $j=[Array]::IndexOf($l,'::AGENT_B64_END'); $b=($l[($i+1)..($j-1)]) -join ''; [IO.File]::WriteAllBytes('%~dp0pc-agent.js',[Convert]::FromBase64String($b))\"",
    'if not exist "%~dp0pc-agent.js" (',
    "  echo       ERRO: nao consegui extrair o agente deste ficheiro.",
    "  echo       Descarrega o instalador outra vez a partir da app.",
    "  goto end",
    ")",
    "echo       Agente pronto.",
    // ----------------------------------------------------- connectivity
    "echo.",
    "echo [3/4] A testar o endereco da app a partir deste PC...",
    "for /f \"usebackq delims=\" %%H in (`powershell -NoProfile -ExecutionPolicy Bypass -Command \"$ProgressPreference='SilentlyContinue'; foreach($u in $env:CANDS.Split(',')){ if(-not $u){continue}; try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 ($u+'/api/health'); $c=[string]$r.Content; if($c.Trim().StartsWith('{') -and $c -like '*true*'){ Write-Output $u; break } } catch {} }\"`) do if not defined HUB set \"HUB=%%H\"",
    "if defined HUB (",
    "  echo       Encontrei a app em: !HUB!",
    "  goto run",
    ")",
    "echo.",
    "echo   Nenhum destes enderecos respondeu como app TelePC:",
    "echo     %CANDS%",
    "echo.",
    "echo   Isto acontece quando o endereco da app mudou (o servidor foi reiniciado)",
    "echo   ou quando o endereco pede login no navegador.",
    "echo.",
    "echo   Abre a app no telemovel, vai a 'Ligar o teu PC' e copia o endereco",
    "echo   que aparece em 'Endereco do teu hub'. Depois escreve-o aqui.",
    "echo.",
    "set /p HUB=  Endereco da app (comeca por https://), ou Enter para tentar na mesma: ",
    'if not defined HUB set "HUB=' + primary + '"',
    // --------------------------------------------------------------- run
    ":run",
    "echo.",
    "echo [4/4] A ligar este PC a app...",
    "echo.",
    "echo   IMPORTANTE: deixa esta janela ABERTA. Se a fechares, o telemovel",
    "echo   deixa de controlar o PC.",
    "echo.",
    '"%NODE_EXE%" "%~dp0pc-agent.js" --hub "!HUB!,%CANDS%" --token "%TOKEN%"',
    ":end",
    "echo.",
    "echo  A janela terminou. Se apareceu um erro, tira uma foto a esta janela.",
    "pause",
    "exit /b",
    "",
    "::AGENT_B64_BEGIN",
    ...agentB64Lines,
    "::AGENT_B64_END",
    "",
  ];
  return lines.join("\r\n");
}

/* ---------------------------------------------------------------- unix */

function unixScript(os: "macos" | "linux", hubs: string[], token: string, agentB64Lines: string[]): string {
  const cands = hubs.join(",");
  const primary = hubs[0] ?? "";
  const title = os === "macos" ? "macOS" : "Linux";
  const archLine =
    os === "macos"
      ? 'case "$(uname -m)" in arm64) NODE_ARCH=arm64;; *) NODE_ARCH=x64;; esac; NODE_DIST="darwin-$NODE_ARCH"'
      : 'case "$(uname -m)" in aarch64|arm64) NODE_ARCH=arm64;; *) NODE_ARCH=x64;; esac; NODE_DIST="linux-$NODE_ARCH"';
  const nodeRoot = os === "macos" ? '"$HOME/Library/Application Support/TelePC"' : '"$HOME/.local/share/telepc"';

  const lines = [
    os === "macos" ? "#!/bin/bash" : "#!/usr/bin/env bash",
    "set -u",
    'cd "$(dirname "$0")" || exit 1',
    `CANDS="${cands}"`,
    `TOKEN="${token}"`,
    `PRIMARY="${primary}"`,
    "HUB=\"\"",
    "echo",
    "echo  ============================================================",
    `echo   TelePC - instalador para ${title}`,
    "echo   Este programa liga o teu PC a app do telemovel.",
    "echo  ============================================================",
    "echo",
    // ---------------------------------------------------------- node
    'echo "[1/4] A verificar o Node.js..."',
    "NODE_CMD=$(command -v node || true)",
    `if [ -z "$NODE_CMD" ]; then for d in ${nodeRoot}/node-*/bin/node; do [ -x "$d" ] && NODE_CMD="$d"; done; fi`,
    'if [ -n "$NODE_CMD" ]; then',
    '  echo "      Node.js pronto."',
    "else",
    '  echo "      Node.js nao encontrado: vou usar uma versao portatil."',
    `  ${archLine}`,
    `  mkdir -p ${nodeRoot}`,
    `  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-$NODE_DIST.tar.gz" -o /tmp/telepc-node.tgz`,
    `  tar -xzf /tmp/telepc-node.tgz -C ${nodeRoot}`,
    `  NODE_CMD=${nodeRoot}/node-${NODE_VERSION}-$NODE_DIST/bin/node`,
    '  if [ ! -x "$NODE_CMD" ]; then',
    '    echo "      ERRO: nao consegui preparar o Node.js. Instala em https://nodejs.org e volta a correr este ficheiro."',
    "    exit 1",
    "  fi",
    '  echo "      Node.js portatil pronto."',
    "fi",
    "",
    // ------------------------------------------------------- extract
    'echo "[2/4] A preparar o agente TelePC (vem dentro deste ficheiro)..."',
    "\"$NODE_CMD\" -e 'const fs=require(\"fs\");const s=fs.readFileSync(process.argv[1],\"utf8\");const a=s.indexOf(\"\\n#__AGENT_B64_BEGIN__\\n\");const b=s.indexOf(\"\\n#__AGENT_B64_END__\");if(a<0||b<0){process.exit(2)};fs.writeFileSync(\"pc-agent.js\",Buffer.from(s.slice(a+21,b).replace(/\\s+/g,\"\"),\"base64\"))' \"$0\"",
    'if [ ! -s pc-agent.js ]; then echo "      ERRO: nao consegui extrair o agente. Descarrega o instalador outra vez."; exit 1; fi',
    'echo "      Agente pronto."',
    "",
    // ----------------------------------------------------- connectivity
    'echo "[3/4] A testar o endereco da app a partir deste PC..."',
    'IFS="," read -r -a LIST <<< "$CANDS"',
    'for u in "${LIST[@]}"; do',
    '  [ -z "$u" ] && continue',
    '  body=$(curl -fsSL --max-time 10 "$u/api/health" 2>/dev/null || true)',
    '  case "$body" in \\{*true*) HUB="$u"; break;; esac',
    "done",
    'if [ -n "$HUB" ]; then',
    '  echo "      Encontrei a app em: $HUB"',
    "else",
    "  echo",
    '  echo "  Nenhum destes enderecos respondeu como app TelePC:"',
    '  echo "    $CANDS"',
    "  echo",
    '  echo "  Isto acontece quando o endereco da app mudou (servidor reiniciado)"',
    '  echo "  ou quando o endereco pede login no navegador."',
    '  echo "  Abre a app no telemovel > Ligar o teu PC > copia o Endereco do teu hub."',
    "  echo",
    '  read -r -p "  Endereco da app (https://...), ou Enter para tentar na mesma: " HUB',
    '  [ -z "$HUB" ] && HUB="$PRIMARY"',
    "fi",
    "",
    // --------------------------------------------------------------- run
    'echo "[4/4] A ligar este PC a app..."',
    os === "macos"
      ? 'echo "  Na primeira vez o macOS pode pedir Acessibilidade e Gravacao do ecra."'
      : 'echo "  Dica: em Linux instala xdotool, wmctrl e scrot para controlo total."',
    'echo "  Deixa esta janela ABERTA."',
    '"$NODE_CMD" pc-agent.js --hub "$HUB,$CANDS" --token "$TOKEN"',
    "exit 0",
    "",
    "#__AGENT_B64_BEGIN__",
    ...agentB64Lines,
    "#__AGENT_B64_END__",
    "",
  ];
  return lines.join("\n");
}

export function buildInstaller(os: InstallerOs, hubs: string[], token: string, agentSource: string): string {
  const cleanHubs = [...new Set(hubs.map((hub) => hub.trim().replace(/\/+$/, "")).filter(Boolean))];
  const cleanToken = token.trim().toUpperCase();
  const configured = configureAgent(agentSource, cleanHubs, cleanToken);
  const b64Lines = wrap76(Buffer.from(configured, "utf8").toString("base64"));
  if (os === "windows") return windowsScript(cleanHubs, cleanToken, b64Lines);
  return unixScript(os, cleanHubs, cleanToken, b64Lines);
}
