"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/** Short haptic pulses — makes remote control feel physical on iPhone. */
export function haptic(kind: "tap" | "soft" | "ok" | "warn" | "heavy" = "tap") {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  const patterns: Record<string, number | number[]> = {
    tap: 8,
    soft: 4,
    ok: [10, 40, 14],
    warn: [18, 60, 18],
    heavy: 26,
  };
  try {
    navigator.vibrate(patterns[kind]);
  } catch {
    /* iOS Safari may ignore this — harmless */
  }
}

/* -------------------------------------------------------------------------
   Persisted boolean flags (dismissed hints, finished steps).
   Backed by an external store so React stays happy during hydration.
   ------------------------------------------------------------------------- */

const flagListeners = new Set<() => void>();
const flagCache = new Map<string, boolean>();

function readFlag(key: string): boolean {
  const cached = flagCache.get(key);
  if (cached !== undefined) return cached;
  let value = false;
  try {
    value = window.localStorage.getItem(key) === "1";
  } catch {
    value = false;
  }
  flagCache.set(key, value);
  return value;
}

/** Writes a flag from anywhere (e.g. the "?" button re-opening a hint). */
export function setFlag(key: string, value: boolean) {
  flagCache.set(key, value);
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* private mode — memory only */
  }
  for (const listener of flagListeners) listener();
}

function subscribeFlags(listener: () => void) {
  flagListeners.add(listener);
  return () => {
    flagListeners.delete(listener);
  };
}

export function useFlag(key: string) {
  const value = useSyncExternalStore(
    subscribeFlags,
    () => readFlag(key),
    () => false,
  );
  const update = useCallback((next: boolean) => setFlag(key, next), [key]);
  return [value, update] as const;
}

/* ------------------------------------------------------------------- copy */

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = useCallback(async (text: string, key = "default") => {
    try {
      await navigator.clipboard.writeText(text);
      haptic("ok");
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
      return true;
    } catch {
      haptic("warn");
      return false;
    }
  }, []);

  return { copied, copy };
}

/* ------------------------------------------------------- browser snapshots */

function subscribeNever() {
  return () => undefined;
}

/** The address the phone is actually using — the one the PC must reach. */
export function useOrigin() {
  return useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => "",
  );
}

function subscribeDisplayMode(listener: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** True when the PWA is running from the iPhone home screen. */
export function useStandalone() {
  return useSyncExternalStore(
    subscribeDisplayMode,
    () => {
      const nav = navigator as Navigator & { standalone?: boolean };
      return Boolean(nav.standalone) || window.matchMedia("(display-mode: standalone)").matches;
    },
    () => false,
  );
}
