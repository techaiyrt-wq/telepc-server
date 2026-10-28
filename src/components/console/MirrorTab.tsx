"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Btn, Chip, Panel, Pill, Segmented, Stat } from "@/components/ui";
import { fire, screenUrl, send, type FrameInfo } from "@/lib/client";
import { haptic } from "@/lib/ux";
import type { DevicePresence } from "@/lib/protocol";

export interface TabProps {
  deviceId: string;
  presence?: DevicePresence;
  frame?: FrameInfo;
  frameVersion: number;
  push: (text: string, tone?: "ok" | "warn" | "danger") => void;
}

type ProfileKey = "economy" | "balanced" | "smooth" | "hd";

const PROFILES: Record<
  ProfileKey,
  { label: string; short: string; emoji: string; fps: number; scale: number; quality: number; detail: string }
> = {
  economy: { label: "Poupar dados", short: "Poupar", emoji: "🍃", fps: 3, scale: 0.45, quality: 58, detail: "Rede móvel / lenta" },
  balanced: { label: "Equilibrado", short: "Normal", emoji: "✨", fps: 6, scale: 0.7, quality: 74, detail: "Melhor escolha" },
  smooth: { label: "Mais fluido", short: "Fluido", emoji: "⚡", fps: 10, scale: 0.6, quality: 68, detail: "Rato e vídeo suaves" },
  hd: { label: "Alta definição", short: "HD", emoji: "💎", fps: 5, scale: 1, quality: 86, detail: "Texto muito nítido" },
};

/* ===========================================================================
   Espelho — stream binário MJPEG, interação direta e perfis de qualidade.
   =========================================================================== */
export function MirrorTab({ deviceId, presence, frame, frameVersion, push }: TabProps) {
  const [streaming, setStreaming] = useState(true);
  const [profileKey, setProfileKey] = useState<ProfileKey>("balanced");
  const [rightClick, setRightClick] = useState(false);
  const [dragMode, setDragMode] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [mjpeg, setMjpeg] = useState(true);
  const [streamKey, setStreamKey] = useState(1);
  const [actualFps, setActualFps] = useState(0);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number; tone: "left" | "right" | "double" }[]>([]);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rippleSeq = useRef(0);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const frameTimes = useRef<number[]>([]);
  const gesture = useRef<{
    id: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
    longFired: boolean;
    longTimer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  const profile = PROFILES[profileKey];
  const physicalWidth = presence?.screenWidth ?? frame?.screenWidth ?? 1920;
  const physicalHeight = presence?.screenHeight ?? frame?.screenHeight ?? 1080;
  const imageWidth = frame?.width || Math.round(physicalWidth * profile.scale);
  const imageHeight = frame?.height || Math.round(physicalHeight * profile.scale);
  const hasFrame = frameVersion > 0;

  // Mede os fps que realmente chegam ao telefone (não apenas o valor pedido).
  useEffect(() => {
    if (!frameVersion) return;
    const now = performance.now();
    frameTimes.current = [...frameTimes.current.filter((time) => now - time < 2000), now];
    const times = frameTimes.current;
    const measured = times.length >= 2 ? ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]) : 0;
    const raf = requestAnimationFrame(() => setActualFps(measured));
    const stale = setTimeout(() => setActualFps(0), 2800);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(stale);
    };
  }, [frameVersion]);

  // Mantém o agente a transmitir; os valores podem mudar sem fechar a sessão.
  useEffect(() => {
    if (!streaming) {
      fire(deviceId, "stream", { on: false });
      return;
    }
    const keepAlive = () =>
      fire(deviceId, "stream", {
        on: true,
        fps: profile.fps,
        scale: profile.scale,
        quality: profile.quality,
        transport: "binary",
      });
    keepAlive();
    const interval = setInterval(keepAlive, 4000);
    return () => clearInterval(interval);
  }, [deviceId, streaming, profile.fps, profile.scale, profile.quality]);

  const liveUrl = useMemo(
    () => `/api/devices/${encodeURIComponent(deviceId)}/screen/live?s=${streamKey}`,
    [deviceId, streamKey],
  );

  const toScreen = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(physicalWidth - 1, Math.max(0, Math.round(((clientX - rect.left) / rect.width) * physicalWidth))),
      y: Math.min(physicalHeight - 1, Math.max(0, Math.round(((clientY - rect.top) / rect.height) * physicalHeight))),
    };
  };

  const addRipple = (clientX: number, clientY: number, tone: "left" | "right" | "double") => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const id = ++rippleSeq.current;
    setRipples((prev) => [...prev, { id, x: clientX - rect.left, y: clientY - rect.top, tone }].slice(-6));
    setTimeout(() => setRipples((prev) => prev.filter((item) => item.id !== id)), 540);
  };

  const clickAt = (x: number, y: number, button: "left" | "right", double = false) => {
    haptic(button === "right" ? "warn" : double ? "ok" : "tap");
    void send(deviceId, "click", { x, y, button, double }, { wait: false });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toScreen(event.clientX, event.clientY);
    const g = {
      id: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: point.x,
      startY: point.y,
      moved: false,
      longFired: false,
      longTimer: null as ReturnType<typeof setTimeout> | null,
    };
    g.longTimer = setTimeout(() => {
      if (!gesture.current || gesture.current.moved || dragMode) return;
      gesture.current.longFired = true;
      clickAt(point.x, point.y, "right");
      addRipple(event.clientX, event.clientY, "right");
      push("Botão direito", "ok");
    }, 620);
    gesture.current = g;
    setLastPoint(point);
    haptic("soft");
    if (dragMode) fire(deviceId, "dragStart", { ...point, button: rightClick ? "right" : "left" });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - g.startClientX, event.clientY - g.startClientY);
    if (distance > 7) {
      g.moved = true;
      if (g.longTimer) {
        clearTimeout(g.longTimer);
        g.longTimer = null;
      }
    }
    if (!g.moved) return;
    const point = toScreen(event.clientX, event.clientY);
    setLastPoint(point);
    fire(deviceId, dragMode ? "dragMove" : "move", point);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.longTimer) clearTimeout(g.longTimer);
    const point = toScreen(event.clientX, event.clientY);
    setLastPoint(point);

    if (dragMode) {
      fire(deviceId, "dragEnd", { ...point, button: rightClick ? "right" : "left" });
      addRipple(event.clientX, event.clientY, "left");
      return;
    }
    if (g.longFired || g.moved) return;

    const now = Date.now();
    const previous = lastTap.current;
    const isDouble = Boolean(previous && now - previous.at < 330 && Math.hypot(previous.x - point.x, previous.y - point.y) < 80);
    const button = rightClick ? "right" : "left";
    // O primeiro toque já enviou um clique; no segundo enviamos mais um (não
    // dois), para o Windows os reconhecer como duplo clique sem totalizar 3.
    clickAt(point.x, point.y, button, false);
    addRipple(event.clientX, event.clientY, button === "right" ? "right" : isDouble ? "double" : "left");
    lastTap.current = isDouble ? null : { at: now, x: point.x, y: point.y };
    if (isDouble) {
      haptic("ok");
      push("Duplo clique", "ok");
    }
  };

  const changeProfile = (key: ProfileKey) => {
    haptic("tap");
    setProfileKey(key);
    setStreamKey((value) => value + 1);
    push(`${PROFILES[key].label}: ${PROFILES[key].fps} fps`, "ok");
  };

  const estimatedMbps = frame?.bytes && actualFps ? (frame.bytes * actualFps * 8) / 1_000_000 : 0;
  const streamHealth = actualFps >= profile.fps * 0.75 ? "ok" : actualFps >= profile.fps * 0.4 ? "warn" : "bad";

  const screenArea = (
    <div
      ref={containerRef}
      className="no-scroll relative w-full overflow-hidden rounded-2xl bg-black shadow-[0_22px_70px_-30px_rgba(0,0,0,1)]"
      style={{ aspectRatio: `${physicalWidth} / ${physicalHeight}` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(event) => event.preventDefault()}
    >
      {hasFrame && streaming && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${mjpeg}-${streamKey}`}
          src={mjpeg ? liveUrl : screenUrl(deviceId, frameVersion)}
          alt="Ecrã do computador em direto"
          className="h-full w-full object-fill select-none"
          draggable={false}
          onError={() => {
            if (mjpeg) setMjpeg(false);
          }}
        />
      )}

      {(!hasFrame || !streaming) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_30%,rgba(56,220,248,.12),rgba(4,6,11,.98)_65%)] px-6 text-center">
          {streaming ? (
            <>
              <span className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-signal-400/25 border-t-signal-400" />
              <p className="text-[13px] font-bold text-mist-200">A preparar o ecrã em alta qualidade…</p>
              <p className="text-[10.5px] text-mist-500">A primeira imagem pode demorar alguns segundos.</p>
            </>
          ) : (
            <>
              <span className="text-4xl opacity-70">⏸</span>
              <p className="text-[13px] font-bold text-mist-300">Transmissão em pausa</p>
              <Btn variant="primary" onClick={() => setStreaming(true)}>▶ Retomar</Btn>
            </>
          )}
        </div>
      )}

      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="ripple"
          style={{
            left: ripple.x,
            top: ripple.y,
            borderColor: ripple.tone === "right" ? "#ff6183" : ripple.tone === "double" ? "#a78bfa" : undefined,
            background: ripple.tone === "right" ? "rgba(255,97,131,.22)" : ripple.tone === "double" ? "rgba(167,139,250,.24)" : undefined,
          }}
        />
      ))}

      <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <span className="mono rounded-full bg-black/72 px-2 py-1 text-[9px] text-mist-200 backdrop-blur-xl">
            {imageWidth}×{imageHeight}
          </span>
          <span className={`mono flex items-center gap-1 rounded-full bg-black/72 px-2 py-1 text-[9px] backdrop-blur-xl ${streamHealth === "ok" ? "text-go-400" : streamHealth === "warn" ? "text-warn-400" : "text-danger-400"}`}>
            <span className={`dot !h-1.5 !w-1.5 ${streamHealth === "ok" ? "dot-on" : streamHealth === "warn" ? "bg-warn-400" : "dot-bad"}`} />
            {actualFps ? actualFps.toFixed(1) : "—"} fps
          </span>
          <span className="mono rounded-full bg-black/72 px-2 py-1 text-[9px] text-signal-300 backdrop-blur-xl">
            {mjpeg ? "LIVE" : "compatível"}
          </span>
        </div>
        <div className="flex gap-1.5">
          {rightClick && <span className="mono rounded-full bg-danger-500/85 px-2 py-1 text-[9px] font-bold">DIREITO</span>}
          {dragMode && <span className="mono rounded-full bg-signal-500/90 px-2 py-1 text-[9px] font-bold text-ink-950">ARRASTO</span>}
        </div>
      </div>

      {!immersive && (
        <div className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1.5">
          <button type="button" onClick={(event) => { event.stopPropagation(); setRightClick((value) => !value); }} className={`chip !border-white/10 !px-2.5 !py-1.5 !text-[9.5px] backdrop-blur-xl ${rightClick ? "!border-danger-400/50 !bg-danger-500/30 !text-danger-300" : "!bg-black/72"}`}>
            🖱️ {rightClick ? "Direito" : "Esquerdo"}
          </button>
          <button type="button" onClick={(event) => { event.stopPropagation(); setDragMode((value) => !value); }} className={`chip !border-white/10 !px-2.5 !py-1.5 !text-[9.5px] backdrop-blur-xl ${dragMode ? "chip-on" : "!bg-black/72"}`}>
            ✋ Arrastar
          </button>
          <button type="button" onClick={(event) => { event.stopPropagation(); setImmersive(true); }} className="chip !border-white/10 !bg-black/72 !px-2.5 !py-1.5 !text-[9.5px] backdrop-blur-xl">
            ⛶ Grande
          </button>
        </div>
      )}

      {immersive && (
        <button type="button" onClick={(event) => { event.stopPropagation(); setImmersive(false); }} className="absolute bottom-2 right-2 chip !border-white/10 !bg-black/75 !text-[10px] backdrop-blur-xl">
          ✕ Sair
        </button>
      )}
    </div>
  );

  if (immersive) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-center bg-black p-1" style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}>
        {screenArea}
        <div className="mt-1.5 grid grid-cols-5 gap-1.5">
          <Chip active={rightClick} onClick={() => setRightClick((value) => !value)} className="justify-center">🖱️</Chip>
          <Chip active={dragMode} onClick={() => setDragMode((value) => !value)} className="justify-center">✋</Chip>
          <Chip onClick={() => fire(deviceId, "scroll", { dy: 520 })} className="justify-center">▲</Chip>
          <Chip onClick={() => fire(deviceId, "scroll", { dy: -520 })} className="justify-center">▼</Chip>
          <Chip onClick={() => setImmersive(false)} className="justify-center">✕</Chip>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card card-glow overflow-hidden p-1.5">{screenArea}</div>

      <div className="grid grid-cols-4 gap-2">
        <Stat label="Recebido" value={`${actualFps ? actualFps.toFixed(1) : "—"} fps`} tone={streamHealth} />
        <Stat label="Imagem" value={`${imageWidth}×${imageHeight}`} />
        <Stat label="Captura" value={frame?.captureMs ? `${frame.captureMs}ms` : "—"} tone={(frame?.captureMs ?? 0) > 250 ? "warn" : "ok"} />
        <Stat label="Rede" value={estimatedMbps ? `${estimatedMbps.toFixed(1)}M` : "—"} />
      </div>

      <Panel title="Qualidade da transmissão" icon="📡" hint="Escolhe um perfil — a app trata do resto." action={<Pill tone={streamHealth}>{PROFILES[profileKey].short}</Pill>}>
        <div className="grid grid-cols-2 gap-2">
          {(Object.entries(PROFILES) as [ProfileKey, (typeof PROFILES)[ProfileKey]][]).map(([key, item]) => (
            <button
              key={key}
              type="button"
              onClick={() => changeProfile(key)}
              className={`card-flat flex items-center gap-2.5 p-3 text-left transition active:scale-[0.97] ${profileKey === key ? "border-signal-400/55 bg-signal-400/10" : ""}`}
            >
              <span className="text-xl">{item.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[12px] font-bold ${profileKey === key ? "text-signal-300" : "text-mist-200"}`}>{item.label}</span>
                <span className="mono block truncate text-[9.5px] text-mist-600">{item.fps} fps · {Math.round(item.scale * 100)}% · Q{item.quality}</span>
                <span className="block truncate text-[9.5px] text-mist-500">{item.detail}</span>
              </span>
              {profileKey === key && <span className="text-go-400">✓</span>}
            </button>
          ))}
        </div>
        {streamHealth !== "ok" && actualFps > 0 && (
          <button type="button" onClick={() => changeProfile("economy")} className="mt-2.5 w-full rounded-xl border border-warn-400/30 bg-warn-400/8 px-3 py-2 text-[10.5px] font-bold text-warn-400 active:scale-[0.99]">
            A ligação está lenta — tocar para estabilizar
          </button>
        )}
      </Panel>

      <Panel title="Comandos rápidos" icon="⚡" hint="Os mais usados sem sair do ecrã.">
        <div className="grid grid-cols-4 gap-2">
          <Btn onClick={() => fire(deviceId, "scroll", { dy: 520 })}>▲</Btn>
          <Btn onClick={() => fire(deviceId, "scroll", { dy: -520 })}>▼</Btn>
          <Btn onClick={() => void send(deviceId, "hotkey", { combo: "alt+tab" }, { wait: false })}>Alt+Tab</Btn>
          <Btn variant="danger" onClick={() => void send(deviceId, "hotkey", { combo: "alt+f4" }, { wait: false })}>Fechar</Btn>
          <Btn onClick={() => void send(deviceId, "hotkey", { combo: "meta+d" }, { wait: false })}>🖥️ Desktop</Btn>
          <Btn onClick={() => void send(deviceId, "hotkey", { combo: "ctrl+c" }, { wait: false })}>Copiar</Btn>
          <Btn onClick={() => void send(deviceId, "hotkey", { combo: "ctrl+v" }, { wait: false })}>Colar</Btn>
          <Btn onClick={() => setStreaming((value) => !value)}>{streaming ? "⏸ Pausa" : "▶ Retomar"}</Btn>
        </div>
      </Panel>

      <div className="card-flat flex items-start gap-2.5 p-3">
        <span className="text-base">👆</span>
        <p className="text-[10.5px] leading-relaxed text-mist-500">
          <strong className="text-mist-300">Toque</strong> = clique · <strong className="text-mist-300">2 toques</strong> = duplo clique · <strong className="text-mist-300">manter</strong> = botão direito · deslizar = mover cursor. Liga “Arrastar” para mover janelas ou ficheiros.
        </p>
      </div>
    </div>
  );
}

/* ===========================================================================
   Trackpad — superfície de gestos com mini-mapa do ecrã do PC.
   =========================================================================== */
export function TrackpadTab({ deviceId, presence, push }: TabProps) {
  const screenW = presence?.screenWidth ?? 1920;
  const screenH = presence?.screenHeight ?? 1080;
  const centre = { x: Math.round(screenW / 2), y: Math.round(screenH / 2) };
  const cursor = useRef(centre);
  const [shown, setShown] = useState(centre);
  const [sensitivity, setSensitivity] = useState(1.6);
  const [dragLock, setDragLock] = useState(false);
  const [touching, setTouching] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>());
  const dragging = useRef(false);
  const lastUpdate = useRef(0);

  const moveCursor = useCallback(
    (dx: number, dy: number) => {
      const next = {
        x: Math.min(Math.max(cursor.current.x + dx * sensitivity, 0), screenW),
        y: Math.min(Math.max(cursor.current.y + dy * sensitivity, 0), screenH),
      };
      cursor.current = next;
      const now = Date.now();
      if (now - lastUpdate.current > 40) {
        lastUpdate.current = now;
        setShown(next);
      }
      if (dragging.current) fire(deviceId, "dragMove", { x: next.x, y: next.y });
      else fire(deviceId, "move", { x: next.x, y: next.y });
    },
    [deviceId, screenH, screenW, sensitivity],
  );

  const onDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY, sx: event.clientX, sy: event.clientY, t: Date.now() });
    setTouching(pointers.current.size);
    haptic("soft");
    if (pointers.current.size === 1 && dragLock && !dragging.current) {
      dragging.current = true;
      fire(deviceId, "dragStart", { x: cursor.current.x, y: cursor.current.y });
    }
  };

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = pointers.current.get(event.pointerId);
    if (!pointer) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (pointers.current.size === 1) moveCursor(dx, dy);
    else if (pointers.current.size >= 2) fire(deviceId, "scroll", { dy: Math.round(-dy * 3.2), dx: Math.round(dx * 3.2) });
  };

  const onUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = pointers.current.get(event.pointerId);
    pointers.current.delete(event.pointerId);
    setTouching(pointers.current.size);
    if (!pointer) return;

    if (dragging.current && pointers.current.size === 0) {
      dragging.current = false;
      fire(deviceId, "dragEnd", { x: cursor.current.x, y: cursor.current.y });
      return;
    }

    const moved = Math.hypot(event.clientX - pointer.sx, event.clientY - pointer.sy);
    const quick = Date.now() - pointer.t < 350;
    if (moved > 12 || !quick) return;

    if (pointers.current.size >= 1) {
      haptic("warn");
      void send(deviceId, "click", { ...cursor.current, button: "right" });
      push("Clique direito", "ok");
      pointers.current.clear();
      setTouching(0);
      return;
    }
    haptic("tap");
    void send(deviceId, "click", { ...cursor.current, button: "left" });
  };

  const click = (button: "left" | "right" | "middle", double = false) => {
    haptic(button === "right" ? "warn" : "tap");
    void send(deviceId, "click", { ...cursor.current, button, double });
  };

  const mapX = (shown.x / screenW) * 100;
  const mapY = (shown.y / screenH) * 100;

  return (
    <div className="flex flex-col gap-3">
      {/* mini-mapa do ecrã do PC */}
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Onde está o cursor no PC</span>
          <span className="mono text-[10px] text-signal-300">
            {Math.round(shown.x)}, {Math.round(shown.y)}
          </span>
        </div>
        <div
          className="relative w-full overflow-hidden rounded-lg border border-line bg-ink-950"
          style={{ aspectRatio: `${screenW} / ${screenH}`, maxHeight: 110 }}
        >
          <div className="absolute inset-0 scan opacity-60" />
          <div
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal-400 shadow-[0_0_14px_rgba(56,220,248,0.95)] transition-all duration-100"
            style={{ left: `${mapX}%`, top: `${mapY}%` }}
          />
        </div>
      </div>

      {/* superfície de gestos */}
      <div className="card card-glow p-3">
        <div
          className={`no-scroll relative flex h-[42vh] min-h-[250px] w-full items-center justify-center overflow-hidden rounded-2xl border transition ${
            touching > 0
              ? "border-signal-400/60 bg-[radial-gradient(120%_100%_at_50%_0%,rgba(56,220,248,0.18),rgba(4,6,11,0.95))]"
              : "border-line bg-[radial-gradient(120%_100%_at_50%_0%,rgba(56,220,248,0.08),rgba(4,6,11,0.9))]"
          }`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <div className="pointer-events-none select-none text-center">
            <div className={`text-4xl transition ${touching > 0 ? "scale-110 opacity-100" : "opacity-50"}`}>
              {touching >= 2 ? "✌️" : touching === 1 ? "☝️" : "🖱️"}
            </div>
            <p className="mt-2.5 text-[11.5px] font-bold text-mist-300">
              {touching >= 2 ? "Scroll a dois dedos" : touching === 1 ? "A mover o cursor…" : "Desliza aqui"}
            </p>
            {touching === 0 && (
              <p className="mt-1 text-[10.5px] leading-relaxed text-mist-600">
                1 dedo move · toque clica
                <br />2 dedos fazem scroll · toque a 2 dedos = menu
              </p>
            )}
          </div>
          {dragLock && (
            <span className="pointer-events-none absolute left-2 top-2 mono rounded-full bg-signal-500/85 px-2 py-1 text-[9.5px] font-bold text-ink-950">
              ARRASTO ATIVO
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Btn variant="primary" onClick={() => click("left")}>
          Clique
        </Btn>
        <Btn onClick={() => click("left", true)}>Duplo</Btn>
        <Btn variant="danger" onClick={() => click("right")}>
          Direito
        </Btn>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Btn onClick={() => void send(deviceId, "scroll", { dy: 420 })}>▲</Btn>
        <Btn onClick={() => void send(deviceId, "scroll", { dy: -420 })}>▼</Btn>
        <Btn onClick={() => void send(deviceId, "scroll", { dx: -420 })}>◀</Btn>
        <Btn onClick={() => void send(deviceId, "scroll", { dx: 420 })}>▶</Btn>
      </div>

      <Panel title="Ajustes do rato" icon="🎚️">
        <div className="label mb-1.5">Velocidade do cursor</div>
        <Segmented
          value={String(sensitivity)}
          onChange={(value) => setSensitivity(Number(value))}
          options={[
            { value: "0.8", label: "Lento" },
            { value: "1.6", label: "Normal" },
            { value: "2.4", label: "Rápido" },
            { value: "3.5", label: "Turbo" },
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip active={dragLock} onClick={() => setDragLock((value) => !value)}>
            🔒 {dragLock ? "Arrasto ligado" : "Ativar arrasto"}
          </Chip>
          <Chip
            onClick={() => {
              cursor.current = { x: Math.round(screenW / 2), y: Math.round(screenH / 2) };
              setShown(cursor.current);
              fire(deviceId, "move", cursor.current);
              push("Cursor ao centro", "ok");
            }}
          >
            ⌖ Centrar cursor
          </Chip>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Posição" value={`${Math.round(shown.x)}, ${Math.round(shown.y)}`} />
          <Stat label="Ecrã do PC" value={`${screenW}×${screenH}`} />
        </div>
      </Panel>
    </div>
  );
}

