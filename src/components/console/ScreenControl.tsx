"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { TabProps } from "@/components/console/MirrorTab";
import { Btn, Chip, Panel, Pill, Segmented, Sheet } from "@/components/ui";
import { fire, send } from "@/lib/client";
import { PRESETS, useScreenStream, type QualityPreset } from "@/lib/screenStream";
import { haptic, useFlag } from "@/lib/ux";

type PointerMode = "touch" | "trackpad";

interface Gesture {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startedAt: number;
  moved: boolean;
  longPressTimer: number | null;
  longPressed: boolean;
}

interface Pinch {
  startDist: number;
  startZoom: number;
  startPan: { x: number; y: number };
  startMid: { x: number; y: number };
  scrolled: boolean;
}

const QUICK_KEYS: { label: string; combo?: string; key?: string; emoji?: string }[] = [
  { label: "Esc", key: "escape" },
  { label: "Tab", key: "tab" },
  { label: "⌫", key: "backspace" },
  { label: "↵", key: "enter" },
  { label: "↑", key: "up" },
  { label: "↓", key: "down" },
  { label: "←", key: "left" },
  { label: "→", key: "right" },
  { label: "Alt+Tab", combo: "alt+tab" },
  { label: "⊞", combo: "meta" },
  { label: "Copiar", combo: "ctrl+c" },
  { label: "Colar", combo: "ctrl+v" },
  { label: "Desfazer", combo: "ctrl+z" },
  { label: "Fechar", combo: "alt+f4" },
  { label: "Secretária", combo: "meta+d" },
  { label: "Bloquear", combo: "meta+l" },
];

export function ScreenControl({ deviceId, presence, push }: TabProps) {
  /* ----------------------------------------------------------- settings */
  const [preset, setPreset] = useState<QualityPreset>("auto");
  const [mode, setMode] = useState<PointerMode>("touch");
  const [landscape, setLandscape] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [rightNext, setRightNext] = useState(false);
  const [dragHold, setDragHold] = useState(false);
  const [showStats, setShowStats] = useFlag("screen:stats");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [paused, setPaused] = useState(false);

  /* ------------------------------------------------------------ geometry */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    zoomRef.current = zoom;
    panRef.current = pan;
  }, [zoom, pan]);
  const [pinching, setPinching] = useState(false);

  const { src, meta, stats, stalled } = useScreenStream(deviceId, {
    enabled: !paused,
    preset,
    zoomBoost: zoom > 1.4,
  });

  const screenW = meta?.width || presence?.screenWidth || 1920;
  const screenH = meta?.height || presence?.screenHeight || 1080;

  /* -------------------------------------------------- local cursor model */
  const cursor = useRef({ x: screenW / 2, y: screenH / 2 });
  const [cursorShown, setCursorShown] = useState({ x: screenW / 2, y: screenH / 2 });
  const remoteCursor = meta?.cursor ?? null;

  // In touch mode follow the PC's real cursor (unless we just moved it ourselves).
  // We only hand control to the remote cursor after our own moves settle
  // (`localHold` is cleared ~300ms after the last local move).
  const [localHold, setLocalHold] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const followRemote = mode === "touch" && Boolean(remoteCursor) && !localHold;
  const displayedCursor = followRemote && remoteCursor ? remoteCursor : cursorShown;
  useEffect(() => {
    if (followRemote && remoteCursor) cursor.current = remoteCursor;
  }, [followRemote, remoteCursor]);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<Pinch | null>(null);
  const dragging = useRef(false);
  const lastTapAt = useRef(0);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number; right: boolean }[]>([]);
  const rippleSeq = useRef(0);

  /** Map a client point to PC screen coordinates (handles zoom + rotation). */
  const toScreen = useCallback(
    (clientX: number, clientY: number) => {
      const rect = imgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return { x: 0, y: 0 };
      let u: number;
      let v: number;
      if (landscape) {
        u = (clientY - rect.top) / rect.height;
        v = (rect.right - clientX) / rect.width;
      } else {
        u = (clientX - rect.left) / rect.width;
        v = (clientY - rect.top) / rect.height;
      }
      return {
        x: Math.round(Math.min(Math.max(u, 0), 1) * screenW),
        y: Math.round(Math.min(Math.max(v, 0), 1) * screenH),
      };
    },
    [landscape, screenW, screenH],
  );

  /** Inverse: PC coordinates → position inside the (unrotated) image box, in %. */
  const toPercent = (x: number, y: number) => ({ left: (x / screenW) * 100, top: (y / screenH) * 100 });

  const addRipple = (clientX: number, clientY: number, right: boolean) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const id = ++rippleSeq.current;
    setRipples((prev) => [...prev, { id, x: clientX - rect.left, y: clientY - rect.top, right }].slice(-5));
    setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 520);
  };

  const setCursor = (x: number, y: number) => {
    const next = { x: Math.min(Math.max(x, 0), screenW), y: Math.min(Math.max(y, 0), screenH) };
    cursor.current = next;
    setCursorShown(next);
    setLocalHold(true);
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => setLocalHold(false), 350);
    return next;
  };

  const clickAt = async (x: number, y: number, button: "left" | "right", double = false) => {
    haptic(button === "right" ? "warn" : "tap");
    const res = await send(deviceId, "click", { x, y, button, double });
    if (!res.ok || (res.result && !res.result.ok)) push(res.result?.error ?? res.error ?? "O clique não chegou ao PC", "danger");
  };

  /* --------------------------------------------------------- pointer fsm */
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      // second finger: cancel single-finger gesture, start pinch/scroll
      const g = gesture.current;
      if (g?.longPressTimer) window.clearTimeout(g.longPressTimer);
      gesture.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startZoom: zoomRef.current,
        startPan: { ...panRef.current },
        startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        scrolled: false,
      };
      setPinching(true);
      return;
    }
    if (pointers.current.size > 2) return;

    const g: Gesture = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startedAt: Date.now(),
      moved: false,
      longPressTimer: null,
      longPressed: false,
    };
    gesture.current = g;
    haptic("soft");

    if (mode === "touch") {
      const p = toScreen(event.clientX, event.clientY);
      setCursor(p.x, p.y);
      fire(deviceId, "move", p);
    }

    // long press → right click (or start drag when drag-hold is on)
    g.longPressTimer = window.setTimeout(() => {
      if (gesture.current !== g || g.moved) return;
      g.longPressed = true;
      haptic("heavy");
      if (dragHold) {
        dragging.current = true;
        fire(deviceId, "dragStart", { ...cursor.current, button: "left" });
        push("A arrastar — larga para soltar", "ok");
      } else {
        addRipple(g.lastX, g.lastY, true);
        void clickAt(cursor.current.x, cursor.current.y, "right");
      }
    }, 480);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const tracked = pointers.current.get(event.pointerId);
    if (!tracked) return;
    const prev = { ...tracked };
    tracked.x = event.clientX;
    tracked.y = event.clientY;

    // ---- two fingers: pinch-zoom / pan / scroll
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ratio = dist / Math.max(pinch.current.startDist, 1);
      const pinching = Math.abs(ratio - 1) > 0.06 || zoomRef.current > 1;

      if (pinching) {
        const nextZoom = Math.min(Math.max(pinch.current.startZoom * ratio, 1), 4);
        const rect = stageRef.current?.getBoundingClientRect();
        if (rect) {
          const ox = pinch.current.startMid.x - rect.left;
          const oy = pinch.current.startMid.y - rect.top;
          const k = nextZoom / pinch.current.startZoom;
          const nextPan = {
            x: ox - k * (ox - pinch.current.startPan.x) + (mid.x - pinch.current.startMid.x),
            y: oy - k * (oy - pinch.current.startPan.y) + (mid.y - pinch.current.startMid.y),
          };
          const clamped = clampPan(nextPan, nextZoom, rect);
          setZoom(nextZoom);
          setPan(clamped);
          if (nextZoom <= 1.01) setPan({ x: 0, y: 0 });
        }
      } else {
        // two-finger drag at zoom 1 = scroll wheel on the PC
        const dy = landscape ? -(mid.x - pinch.current.startMid.x) : mid.y - pinch.current.startMid.y;
        const dx = landscape ? mid.y - pinch.current.startMid.y : mid.x - pinch.current.startMid.x;
        const stepY = Math.trunc(dy / 14);
        const stepX = Math.trunc(dx / 14);
        if (stepY !== 0 || stepX !== 0) {
          fire(deviceId, "scroll", { dy: -stepY * 60, dx: stepX * 60 });
          pinch.current.startMid = mid;
          pinch.current.scrolled = true;
        }
      }
      return;
    }

    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - g.startX, event.clientY - g.startY);
    if (!g.moved && distance > 7) {
      g.moved = true;
      if (g.longPressTimer) window.clearTimeout(g.longPressTimer);
    }
    g.lastX = event.clientX;
    g.lastY = event.clientY;
    if (!g.moved) return;

    if (mode === "touch") {
      const p = toScreen(event.clientX, event.clientY);
      setCursor(p.x, p.y);
      fire(deviceId, dragging.current ? "dragMove" : "move", p);
    } else {
      // trackpad: relative movement scaled by zoom so precision rises when zoomed
      const rect = imgRef.current?.getBoundingClientRect();
      const pxPerUnit = rect ? screenW / rect.width : 2;
      const gain = 1.35 * pxPerUnit;
      const dxc = event.clientX - prev.x;
      const dyc = event.clientY - prev.y;
      const dx = landscape ? dyc : dxc;
      const dy = landscape ? -dxc : dyc;
      const next = setCursor(cursor.current.x + dx * gain, cursor.current.y + dy * gain);
      fire(deviceId, dragging.current ? "dragMove" : "move", next);
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);

    if (pinch.current) {
      if (pointers.current.size === 0) {
        pinch.current = null;
        setPinching(false);
      }
      return;
    }

    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    if (g.longPressTimer) window.clearTimeout(g.longPressTimer);

    if (dragging.current) {
      dragging.current = false;
      fire(deviceId, "dragEnd", { ...cursor.current, button: "left" });
      haptic("ok");
      return;
    }
    if (g.longPressed) return;

    const button: "left" | "right" = rightNext ? "right" : "left";
    if (rightNext) setRightNext(false);

    if (g.moved) {
      if (mode === "touch") {
        // a swipe in touch mode = drag from start to end (select text, move windows)
        const from = toScreen(g.startX, g.startY);
        const to = toScreen(event.clientX, event.clientY);
        fire(deviceId, "dragStart", { ...from, button });
        fire(deviceId, "dragEnd", { ...to, button });
        haptic("ok");
      }
      return;
    }

    // tap
    const now = Date.now();
    const double = now - lastTapAt.current < 320;
    lastTapAt.current = double ? 0 : now;
    addRipple(event.clientX, event.clientY, button === "right");
    void clickAt(cursor.current.x, cursor.current.y, button, double);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (g?.longPressTimer) window.clearTimeout(g.longPressTimer);
    gesture.current = null;
    if (pointers.current.size === 0) {
      pinch.current = null;
      setPinching(false);
    }
    if (dragging.current) {
      dragging.current = false;
      fire(deviceId, "dragEnd", { ...cursor.current, button: "left" });
    }
  };

  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  /* --------------------------------------------------------- live typing */
  const inputRef = useRef<HTMLInputElement | null>(null);
  const typeBuffer = useRef("");
  const flushTimer = useRef<number | null>(null);

  const flushTyping = useCallback(() => {
    const text = typeBuffer.current;
    typeBuffer.current = "";
    if (text) void send(deviceId, "type", { text });
  }, [deviceId]);

  const queueTyping = (text: string) => {
    typeBuffer.current += text;
    if (flushTimer.current) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(flushTyping, 70);
  };

  const onLiveInput = (event: React.FormEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    if (value.length > 0) queueTyping(value);
    event.currentTarget.value = "";
  };

  const onLiveKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const map: Record<string, string> = { Backspace: "backspace", Enter: "enter", Tab: "tab", Escape: "escape", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    const key = map[event.key];
    if (key) {
      event.preventDefault();
      flushTyping();
      haptic("soft");
      fire(deviceId, "key", { name: key });
    }
  };

  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

  /* ------------------------------------------------------------ render */
  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  const cursorPct = toPercent(displayedCursor.x, displayedCursor.y);
  const effective = preset === "auto" ? stats.settings : PRESETS[preset];
  const modeLabel = mode === "touch" ? "Toque direto" : "Trackpad";

  const stage = (
    <div
      ref={stageRef}
      className={`no-scroll relative h-full w-full overflow-hidden bg-black ${immersive ? "" : "rounded-xl"}`}
      style={!immersive ? { aspectRatio: landscape ? `${screenH} / ${screenW}` : `${screenW} / ${screenH}` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* rotated + zoomed frame */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ transform: landscape ? "rotate(90deg)" : undefined }}
      >
        <div
          className="relative"
          style={{
            width: landscape ? "100vh" : "100%",
            maxWidth: landscape ? "none" : "100%",
            aspectRatio: `${screenW} / ${screenH}`,
            transform,
            transformOrigin: "0 0",
            transition: pinching ? "none" : "transform 80ms linear",
          }}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img ref={imgRef} src={src} alt="Ecrã do computador em direto" className="block h-full w-full select-none" draggable={false} />
          ) : (
            <div className="h-full w-full" />
          )}

          {/* cursor overlay */}
          <svg
            className="pointer-events-none absolute"
            style={{
              left: `${cursorPct.left}%`,
              top: `${cursorPct.top}%`,
              width: 22 / zoom,
              height: 30 / zoom,
              transform: landscape ? "rotate(-90deg)" : undefined,
              transformOrigin: "0 0",
              filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))",
            }}
            viewBox="0 0 22 30"
          >
            <path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 17 L20 17 Z" fill={mode === "trackpad" ? "#38dcf8" : "#ffffff"} stroke="#000" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* waiting / paused */}
      {!src && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-900/95 px-6 text-center">
          {paused ? (
            <>
              <span className="text-3xl opacity-70">⏸</span>
              <p className="text-[13px] font-bold text-mist-300">Transmissão em pausa</p>
              <Btn variant="primary" onClick={() => setPaused(false)}>▶ Retomar</Btn>
            </>
          ) : (
            <>
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-signal-400/30 border-t-signal-400" />
              <p className="text-[13px] font-bold text-mist-300">A receber o ecrã do PC…</p>
              <p className="text-[11px] leading-relaxed text-mist-500">
                {presence?.online ? "Normalmente demora 1-2 segundos." : "O PC parece desligado — confirma que a janela do agente está aberta."}
              </p>
            </>
          )}
        </div>
      )}
      {src && stalled && !paused && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-10">
          <Pill tone="warn">⏳ sem frames novos — a aguardar o PC</Pill>
        </div>
      )}

      {ripples.map((r) => (
        <span
          key={r.id}
          className="ripple"
          style={{ left: r.x, top: r.y, borderColor: r.right ? "rgba(255,97,131,0.95)" : undefined, background: r.right ? "rgba(255,97,131,0.22)" : undefined }}
        />
      ))}

      {/* overlays: top-left status */}
      <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1.5">
        <span className="mono flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[9.5px] text-go-400 backdrop-blur">
          <span className={`dot !h-1.5 !w-1.5 ${src && !stalled ? "dot-on pulse" : "dot-off"}`} /> {stats.fps.toFixed(0)} fps
        </span>
        {showStats && (
          <span className="mono rounded-full bg-black/65 px-2 py-1 text-[9.5px] text-mist-300 backdrop-blur">
            {Math.round(screenW * effective.scale)}×{Math.round(screenH * effective.scale)} · {stats.kbps} kB/s · {stats.rttMs} ms
          </span>
        )}
        {zoom > 1.01 && (
          <span className="mono rounded-full bg-signal-500/85 px-2 py-1 text-[9.5px] font-bold text-ink-950">🔍 {zoom.toFixed(1)}×</span>
        )}
      </div>

      {/* overlays: top-right mode badges */}
      <div className="pointer-events-none absolute right-2 top-2 flex gap-1.5">
        {rightNext && <span className="mono rounded-full bg-danger-500/85 px-2 py-1 text-[9.5px] font-bold text-white">PRÓXIMO: DIREITO</span>}
        {dragHold && <span className="mono rounded-full bg-signal-500/85 px-2 py-1 text-[9.5px] font-bold text-ink-950">SEGURAR = ARRASTAR</span>}
      </div>

      {/* bottom-left coordinates */}
      <span className="pointer-events-none absolute bottom-2 left-2 mono rounded-full bg-black/65 px-2 py-1 text-[9.5px] text-mist-300 backdrop-blur">
        {modeLabel} · {Math.round(displayedCursor.x)}, {Math.round(displayedCursor.y)}
      </span>

      {zoom > 1.01 && (
        <button type="button" onClick={resetZoom} className="absolute bottom-2 right-2 rounded-full border border-line bg-black/70 px-3 py-1.5 text-[10.5px] font-bold text-mist-100 backdrop-blur active:scale-95">
          ✕ zoom
        </button>
      )}
    </div>
  );

  /* ----------------------------------------------------------- toolbar */
  const toolbar = (
    <div className="flex items-center gap-1.5">
      <ToolButton active={mode === "trackpad"} onClick={() => setMode((m) => (m === "touch" ? "trackpad" : "touch"))} emoji={mode === "touch" ? "👆" : "🖱️"} label={mode === "touch" ? "Toque" : "Trackpad"} />
      <ToolButton active={rightNext} tone="danger" onClick={() => setRightNext((v) => !v)} emoji="🖱️" label="Direito" />
      <ToolButton active={dragHold} onClick={() => setDragHold((v) => !v)} emoji="✋" label="Arrastar" />
      <ToolButton active={typing} onClick={() => setTyping((v) => !v)} emoji="⌨️" label="Teclado" />
      <ToolButton active={keysOpen} onClick={() => setKeysOpen(true)} emoji="⚡" label="Teclas" />
      <ToolButton active={landscape} onClick={() => { setLandscape((v) => !v); resetZoom(); }} emoji="🔄" label="Rodar" />
      <ToolButton active={immersive} onClick={() => setImmersive((v) => !v)} emoji={immersive ? "🡼" : "⛶"} label={immersive ? "Sair" : "Grande"} />
      <ToolButton onClick={() => setSettingsOpen(true)} emoji="🎚️" label="Imagem" />
    </div>
  );

  const liveInput = (
    <input
      ref={inputRef}
      type="text"
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      enterKeyHint="enter"
      onInput={onLiveInput}
      onKeyDown={onLiveKeyDown}
      onBlur={() => setTyping(false)}
      className="absolute h-px w-px opacity-0"
      style={{ left: -9999 }}
      aria-label="Escrever no PC"
    />
  );

  const quickKeysSheet = (
    <Sheet open={keysOpen} title="Teclas rápidas" onClose={() => setKeysOpen(false)}>
      <div className="grid grid-cols-4 gap-2 pb-2">
        {QUICK_KEYS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              haptic("tap");
              if (item.key) fire(deviceId, "key", { name: item.key });
              else if (item.combo) fire(deviceId, "hotkey", { combo: item.combo });
            }}
            className="key !h-12 text-[12px]"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 pb-2">
        <Btn onClick={() => void send(deviceId, "scroll", { dy: 600 })}>▲ Scroll</Btn>
        <Btn onClick={() => void send(deviceId, "scroll", { dy: -600 })}>▼ Scroll</Btn>
      </div>
    </Sheet>
  );

  const settingsSheet = (
    <Sheet open={settingsOpen} title="Qualidade da imagem" onClose={() => setSettingsOpen(false)}>
      <div className="flex flex-col gap-3 pb-2">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: "auto", emoji: "🤖", title: "Automático", text: "Ajusta sozinho à tua rede" },
              { id: "fluid", emoji: "🏎️", title: "Fluido", text: "10 fps, mais leve" },
              { id: "sharp", emoji: "🔬", title: "Nítido", text: "Resolução total, 5 fps" },
              { id: "saver", emoji: "🪫", title: "Poupança", text: "Para 4G fraco" },
            ] as { id: QualityPreset; emoji: string; title: string; text: string }[]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                haptic("tap");
                setPreset(item.id);
              }}
              className={`card-flat flex flex-col items-start gap-0.5 p-3 text-left active:scale-[0.97] ${preset === item.id ? "border-signal-400/60 bg-signal-400/10" : ""}`}
            >
              <span className="text-xl">{item.emoji}</span>
              <span className="text-[13px] font-bold">{item.title}</span>
              <span className="text-[10.5px] text-mist-500">{item.text}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="fps real" value={`${stats.fps.toFixed(1)}`} />
          <MiniStat label="dados" value={`${stats.kbps} kB/s`} />
          <MiniStat label="latência" value={`${stats.rttMs} ms`} />
        </div>
        <div className="card-flat p-3">
          <div className="label mb-1">A pedir ao PC</div>
          <p className="mono text-[12px] text-signal-300">
            {effective.fps} fps · {Math.round(screenW * effective.scale)}×{Math.round(screenH * effective.scale)} · qualidade {effective.quality}
            {zoom > 1.4 ? " · resolução total (zoom)" : ""}
          </p>
          {preset === "auto" && <p className="mt-1 text-[10.5px] text-mist-500">Nível automático {stats.level + 1}/6 — sobe quando a rede aguenta, desce quando atrasa.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip active={showStats} onClick={() => setShowStats(!showStats)}>📊 Mostrar estatísticas</Chip>
          <Chip active={paused} onClick={() => setPaused((v) => !v)}>{paused ? "▶ Retomar" : "⏸ Pausar"}</Chip>
          <Chip
            onClick={async () => {
              const res = await send(deviceId, "screenshot", { scale: 1, quality: 90 });
              push(res.ok ? "Captura em alta qualidade recebida" : res.error ?? "Falhou", res.ok ? "ok" : "danger");
            }}
          >
            📸 Captura máxima
          </Chip>
        </div>
      </div>
    </Sheet>
  );

  if (immersive) {
    return (
      <div className="fixed inset-0 z-[45] flex flex-col bg-black">
        <div className="flex-1 overflow-hidden">{stage}</div>
        <div className="glass border-t border-line px-2 pt-2" style={{ paddingBottom: "calc(var(--safe-bottom) + 8px)" }}>
          <div className="scroll-x">{toolbar}</div>
        </div>
        {liveInput}
        {quickKeysSheet}
        {settingsSheet}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card card-glow overflow-hidden p-1.5">{stage}</div>

      <div className="scroll-x -mx-1 px-1">{toolbar}</div>
      {liveInput}

      {typing && (
        <div className="card-flat flex items-center gap-2 px-3 py-2.5">
          <span className="text-base">⌨️</span>
          <p className="flex-1 text-[11.5px] text-mist-300">
            O teclado do telemóvel está a escrever <strong>diretamente no PC</strong>. Apagar, Enter e setas também funcionam.
          </p>
          <button type="button" onClick={() => setTyping(false)} className="chip !px-2.5 !py-1 text-[10px]">
            Fechar
          </button>
        </div>
      )}

      <Panel title="Como controlar" icon="🎮" hint="Gestos que funcionam em cima da imagem.">
        <div className="grid grid-cols-2 gap-2 text-[11.5px]">
          <GestureHint emoji="👆" title="Toque" text={mode === "touch" ? "clica nesse ponto" : "clica onde está o cursor"} />
          <GestureHint emoji="👆👆" title="Toque duplo" text="duplo clique" />
          <GestureHint emoji="⏱️" title="Segurar" text={dragHold ? "arrastar" : "botão direito"} />
          <GestureHint emoji="☝️➡️" title="Deslizar" text={mode === "touch" ? "arrastar / selecionar" : "mover o cursor"} />
          <GestureHint emoji="✌️↕️" title="2 dedos" text="scroll" />
          <GestureHint emoji="🤏" title="Pinça" text="zoom (resolução total)" />
        </div>
        <div className="mt-3">
          <div className="label mb-1.5">Modo do ponteiro</div>
          <Segmented
            value={mode}
            onChange={(value) => setMode(value)}
            options={[
              { value: "touch", label: "👆 Toque direto" },
              { value: "trackpad", label: "🖱️ Trackpad de precisão" },
            ]}
          />
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-mist-500">
            {mode === "touch"
              ? "Tocas na imagem e o PC clica exatamente aí. Ideal para botões grandes."
              : "Deslizas o dedo e o cursor move-se como num portátil; o toque clica onde o cursor está. Ideal para alvos pequenos."}
          </p>
        </div>
      </Panel>
      {quickKeysSheet}
      {settingsSheet}
    </div>
  );
}

/* ------------------------------------------------------------- helpers */

function clampPan(pan: { x: number; y: number }, zoom: number, rect: DOMRect) {
  const maxX = 0;
  const minX = rect.width - rect.width * zoom;
  const maxY = 0;
  const minY = rect.height - rect.height * zoom;
  return { x: Math.min(maxX, Math.max(minX, pan.x)), y: Math.min(maxY, Math.max(minY, pan.y)) };
}

function ToolButton({
  emoji,
  label,
  onClick,
  active,
  tone = "default",
}: {
  emoji: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  tone?: "default" | "danger";
}) {
  const activeClass = tone === "danger" ? "border-danger-400/60 bg-danger-500/18 text-danger-400" : "border-signal-400/60 bg-signal-400/16 text-signal-300";
  return (
    <button
      type="button"
      onClick={() => {
        haptic("soft");
        onClick();
      }}
      className={`flex min-w-[64px] shrink-0 flex-col items-center gap-0.5 rounded-xl border px-2 py-2 text-[10px] font-bold transition active:scale-95 ${
        active ? activeClass : "border-line bg-ink-850 text-mist-300"
      }`}
    >
      <span className="text-base leading-none">{emoji}</span>
      {label}
    </button>
  );
}

function GestureHint({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <div className="card-flat flex items-center gap-2 px-2.5 py-2">
      <span className="w-9 text-center text-sm leading-none">{emoji}</span>
      <div className="min-w-0">
        <p className="truncate font-bold">{title}</p>
        <p className="truncate text-[10.5px] text-mist-500">{text}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-flat px-3 py-2">
      <div className="label">{label}</div>
      <div className="mono mt-0.5 text-[13px] font-bold text-signal-300">{value}</div>
    </div>
  );
}

