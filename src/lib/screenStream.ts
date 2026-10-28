"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fire } from "@/lib/client";

export type QualityPreset = "auto" | "fluid" | "sharp" | "saver";

export interface StreamSettings {
  fps: number;
  scale: number;
  quality: number;
}

export const PRESETS: Record<Exclude<QualityPreset, "auto">, StreamSettings> = {
  fluid: { fps: 10, scale: 0.5, quality: 45 },
  sharp: { fps: 5, scale: 1, quality: 70 },
  saver: { fps: 2, scale: 0.35, quality: 40 },
};

/** Ladder the automatic controller climbs/descends. */
const AUTO_LADDER: StreamSettings[] = [
  { fps: 2, scale: 0.35, quality: 40 },
  { fps: 4, scale: 0.45, quality: 45 },
  { fps: 6, scale: 0.55, quality: 50 },
  { fps: 8, scale: 0.65, quality: 55 },
  { fps: 10, scale: 0.75, quality: 60 },
  { fps: 12, scale: 0.85, quality: 62 },
];

export interface FrameMeta {
  version: number;
  width: number;
  height: number;
  ts: number;
  cursor: { x: number; y: number } | null;
  bytes: number;
}

export interface StreamStats {
  fps: number;
  kbps: number;
  rttMs: number;
  frames: number;
  level: number;
  settings: StreamSettings;
}

interface Options {
  enabled: boolean;
  preset: QualityPreset;
  zoomBoost?: boolean;
}

/**
 * Pulls frames from the hub with long-polling and keeps the agent streaming.
 * Returns an object URL for the latest frame plus live statistics.
 */
export function useScreenStream(deviceId: string, { enabled, preset, zoomBoost = false }: Options) {
  const [src, setSrc] = useState<string | null>(null);
  const [meta, setMeta] = useState<FrameMeta | null>(null);
  const [stats, setStats] = useState<StreamStats>({
    fps: 0,
    kbps: 0,
    rttMs: 0,
    frames: 0,
    level: 2,
    settings: AUTO_LADDER[2],
  });
  const [stalled, setStalled] = useState(false);

  const versionRef = useRef(0);
  const levelRef = useRef(2);
  const settingsRef = useRef<StreamSettings>(AUTO_LADDER[2]);
  const urlRef = useRef<string | null>(null);
  const windowRef = useRef<{ t: number; bytes: number; rtt: number }[]>([]);
  const lastGoodAt = useRef(0);
  const lastLevelChange = useRef(0);

  const resolveSettings = useCallback((): StreamSettings => {
    const base = preset === "auto" ? AUTO_LADDER[levelRef.current] : PRESETS[preset];
    if (zoomBoost) return { ...base, scale: Math.max(base.scale, 1), quality: Math.max(base.quality, 65) };
    return base;
  }, [preset, zoomBoost]);

  // Keep the agent streaming with the current settings.
  useEffect(() => {
    if (!enabled) return;
    const keepAlive = () => {
      const settings = resolveSettings();
      settingsRef.current = settings;
      fire(deviceId, "stream", { on: true, ...settings });
    };
    keepAlive();
    const interval = setInterval(keepAlive, 3000);
    return () => {
      clearInterval(interval);
      fire(deviceId, "stream", { on: false });
    };
  }, [deviceId, enabled, resolveSettings, stats.level]);

  // Long-poll loop.
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const controller = new AbortController();

    const loop = async () => {
      while (!disposed) {
        const startedAt = performance.now();
        try {
          const res = await fetch(
            `/api/devices/${encodeURIComponent(deviceId)}/screen?after=${versionRef.current}&wait=12000`,
            { cache: "no-store", signal: controller.signal },
          );
          if (disposed) return;
          if (res.status === 204) {
            if (Date.now() - lastGoodAt.current > 6000) setStalled(true);
            continue;
          }
          if (!res.ok) {
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
          const blob = await res.blob();
          const rtt = performance.now() - startedAt;
          const version = Number(res.headers.get("x-frame-version") ?? versionRef.current + 1);
          const cx = Number(res.headers.get("x-cursor-x") ?? -1);
          const cy = Number(res.headers.get("x-cursor-y") ?? -1);
          versionRef.current = version;
          lastGoodAt.current = Date.now();
          setStalled(false);

          const url = URL.createObjectURL(blob);
          const previous = urlRef.current;
          urlRef.current = url;
          setSrc(url);
          if (previous) setTimeout(() => URL.revokeObjectURL(previous), 400);

          setMeta({
            version,
            width: Number(res.headers.get("x-frame-width") ?? 0),
            height: Number(res.headers.get("x-frame-height") ?? 0),
            ts: Number(res.headers.get("x-frame-ts") ?? Date.now()),
            cursor: cx >= 0 && cy >= 0 ? { x: cx, y: cy } : null,
            bytes: blob.size,
          });

          // --- statistics over a sliding 3s window
          const now = Date.now();
          windowRef.current.push({ t: now, bytes: blob.size, rtt });
          windowRef.current = windowRef.current.filter((item) => now - item.t < 3000);
          const w = windowRef.current;
          const span = w.length > 1 ? (w[w.length - 1].t - w[0].t) / 1000 : 1;
          const fps = w.length > 1 ? (w.length - 1) / Math.max(span, 0.2) : 0;
          const kbps = w.reduce((sum, item) => sum + item.bytes, 0) / Math.max(span, 0.2) / 1024;
          const avgRtt = w.reduce((sum, item) => sum + item.rtt, 0) / w.length;

          // --- adaptive controller (auto preset only)
          if (preset === "auto" && w.length >= 6) {
            const target = settingsRef.current.fps;
            const level = levelRef.current;
            const slow = fps < target * 0.55 || avgRtt > 1200;
            const fast = fps > target * 0.85 && avgRtt < 450;
            if (slow && level > 0) levelRef.current = level - 1;
            else if (fast && level < AUTO_LADDER.length - 1 && now - lastLevelChange.current > 5000) {
              levelRef.current = level + 1;
            }
            if (levelRef.current !== level) {
              lastLevelChange.current = now;
              windowRef.current = [];
            }
          }

          setStats({
            fps: Math.round(fps * 10) / 10,
            kbps: Math.round(kbps),
            rttMs: Math.round(avgRtt),
            frames: version,
            level: levelRef.current,
            settings: settingsRef.current,
          });
        } catch (error) {
          if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    };

    void loop();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [deviceId, enabled, preset]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return { src, meta, stats, stalled };
}
