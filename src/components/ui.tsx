"use client";

import { useEffect, type ReactNode } from "react";

import type { Toast } from "@/lib/client";
import { haptic, useCopy, useFlag } from "@/lib/ux";

/* -------------------------------------------------------------- containers */

export function Panel({
  title,
  hint,
  action,
  icon,
  children,
  className = "",
  glow = false,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <section className={`card ${glow ? "card-glow" : ""} p-4 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {icon && <span className="mt-0.5 text-lg leading-none">{icon}</span>}
            <div className="min-w-0">
              {title && <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>}
              {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-mist-500">{hint}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------- buttons */

type BtnProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "go" | "danger" | "ghost";
  disabled?: boolean;
  active?: boolean;
  className?: string;
  title?: string;
  type?: "button" | "submit";
};

export function Btn({
  children,
  onClick,
  variant = "default",
  disabled,
  active,
  className = "",
  title,
  type = "button",
}: BtnProps) {
  const variantClass =
    variant === "primary"
      ? "btn-primary"
      : variant === "go"
        ? "btn-go"
        : variant === "danger"
          ? "btn-danger"
          : variant === "ghost"
            ? "btn-ghost"
            : "";
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={() => {
        haptic(variant === "danger" ? "warn" : "tap");
        onClick?.();
      }}
      className={`btn ${variantClass} ${active ? "chip-on" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

export function Chip({
  children,
  onClick,
  active,
  className = "",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        haptic("soft");
        onClick?.();
      }}
      className={`chip ${active ? "chip-on" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

/** Big, obvious action tile — used for apps, hotkeys and quick commands. */
export function Tile({
  emoji,
  label,
  sub,
  onClick,
  tone = "default",
}: {
  emoji: string;
  label: string;
  sub?: string;
  onClick?: () => void;
  tone?: "default" | "danger" | "go";
}) {
  const border =
    tone === "danger" ? "border-danger-400/35" : tone === "go" ? "border-go-400/35" : "border-line-soft";
  return (
    <button
      type="button"
      onClick={() => {
        haptic(tone === "danger" ? "warn" : "tap");
        onClick?.();
      }}
      className={`card-flat ${border} flex flex-col items-center justify-center gap-1 px-2 py-3 text-center transition active:scale-95`}
    >
      <span className="text-xl leading-none">{emoji}</span>
      <span className="w-full truncate text-[11px] font-bold">{label}</span>
      {sub && <span className="mono w-full truncate text-[9.5px] text-mist-600">{sub}</span>}
    </button>
  );
}

/* --------------------------------------------------------------- data bits */

export function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "ok" | "warn" | "bad";
}) {
  const color =
    tone === "ok" ? "text-go-400" : tone === "warn" ? "text-warn-400" : tone === "bad" ? "text-danger-400" : "text-mist-100";
  return (
    <div className="card-flat px-3 py-2.5">
      <div className="label">{label}</div>
      <div className={`mono mt-1 truncate text-[15px] font-bold ${color}`}>{value}</div>
    </div>
  );
}

export function Pill({
  children,
  tone = "default",
  className = "",
}: {
  children: ReactNode;
  tone?: "default" | "ok" | "warn" | "bad" | "info";
  className?: string;
}) {
  const tones = {
    default: "border-line bg-ink-850 text-mist-300",
    ok: "border-go-400/40 bg-go-500/12 text-go-400",
    warn: "border-warn-400/40 bg-warn-400/12 text-warn-400",
    bad: "border-danger-400/40 bg-danger-500/14 text-danger-400",
    info: "border-signal-400/40 bg-signal-400/12 text-signal-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-bold ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="card-flat flex gap-1 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            haptic("soft");
            onChange(option.value);
          }}
          className={`flex-1 rounded-[11px] px-2 py-2 text-[11.5px] font-bold transition ${
            value === option.value
              ? "bg-signal-400/22 text-signal-300 shadow-[0_6px_18px_-12px_rgba(56,220,248,0.9)]"
              : "text-mist-500 active:scale-95"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- feedback */

export function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
      style={{ top: "calc(var(--safe-top) + 10px)" }}
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismiss(toast.id)}
          className={`pop pointer-events-auto flex max-w-full items-center gap-2 truncate rounded-full border px-4 py-2.5 text-[12px] font-bold shadow-2xl backdrop-blur-xl ${
            toast.tone === "danger"
              ? "border-danger-400/45 bg-danger-500/25 text-danger-400"
              : toast.tone === "warn"
                ? "border-warn-400/45 bg-warn-400/18 text-warn-400"
                : "border-go-400/45 bg-go-500/18 text-go-400"
          }`}
        >
          <span>{toast.tone === "danger" ? "✕" : toast.tone === "warn" ? "!" : "✓"}</span>
          <span className="truncate">{toast.text}</span>
        </button>
      ))}
    </div>
  );
}

export function Empty({ emoji, title, hint, action }: { emoji: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card-flat flex flex-col items-center gap-2 px-6 py-9 text-center">
      <div className="text-3xl opacity-80">{emoji}</div>
      <div className="text-[13px] font-bold text-mist-300">{title}</div>
      {hint && <p className="max-w-xs text-[11.5px] leading-relaxed text-mist-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-mist-500">
      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-signal-400/35 border-t-signal-400" />
      {label}
    </div>
  );
}

/* ------------------------------------------------------------------ sheets */

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/65 backdrop-blur-sm" onClick={onClose}>
      <div
        className="sheet-in glass max-h-[86dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border-t border-line px-4 pt-3"
        style={{ paddingBottom: "calc(var(--safe-bottom) + 20px)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-ink-600" />
        {title && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
            <button type="button" onClick={onClose} className="chip !px-3">
              Fechar
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[58] flex items-end justify-center bg-black/72 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="card card-glow rise w-full max-w-md p-5"
        style={{ marginBottom: "var(--safe-bottom)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <h3 className="text-base font-bold">{title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-mist-300">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <Btn className="flex-1" onClick={onCancel}>
            Cancelar
          </Btn>
          <Btn className="flex-1" variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- learning */

/** Dismissible "how to use this screen" banner, remembered per device. */
export function HelpBanner({
  id,
  title,
  lines,
}: {
  id: string;
  title: string;
  lines: { emoji: string; text: string }[];
}) {
  const [hidden, setHidden] = useFlag(`help:${id}`);
  if (hidden) return null;
  return (
    <div className="card card-glow rise relative overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-base">💡</span>
          <h3 className="text-[13.5px] font-bold">{title}</h3>
        </div>
        <button
          type="button"
          onClick={() => {
            haptic("soft");
            setHidden(true);
          }}
          className="chip !px-2.5 !py-1 text-[10px]"
        >
          Percebi
        </button>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line.text} className="flex items-start gap-2.5 text-[12px] leading-snug text-mist-300">
            <span className="mt-[1px] text-sm leading-none">{line.emoji}</span>
            <span>{line.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Copyable command block with a big, unmistakable copy button. */
export function CodeBlock({ code, label, id }: { code: string; label?: string; id?: string }) {
  const { copied, copy } = useCopy();
  const key = id ?? code.slice(0, 20);
  return (
    <div className="card-flat relative overflow-hidden">
      {label && (
        <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
          <span className="label">{label}</span>
          <span className="mono text-[9.5px] text-mist-600">toca para copiar</span>
        </div>
      )}
      <button type="button" onClick={() => void copy(code, key)} className="block w-full text-left active:bg-signal-400/5">
        <pre className="mono overflow-x-auto whitespace-pre-wrap break-all px-3 py-3 pr-20 text-[11.5px] leading-relaxed text-signal-300">
          {code}
        </pre>
      </button>
      <button
        type="button"
        onClick={() => void copy(code, key)}
        className={`absolute right-2 ${label ? "top-11" : "top-2"} rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition active:scale-95 ${
          copied === key ? "border-go-400/50 bg-go-500/20 text-go-400" : "border-line bg-ink-800 text-mist-300"
        }`}
      >
        {copied === key ? "✓ copiado" : "copiar"}
      </button>
    </div>
  );
}

/** Numbered step with a connector line — the backbone of the setup wizard. */
export function Step({
  index,
  title,
  state,
  children,
  last = false,
}: {
  index: number;
  title: ReactNode;
  state: "todo" | "active" | "done";
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`step-num ${state === "active" ? "step-num-active breathe" : state === "done" ? "step-num-done" : ""}`}>
          {state === "done" ? "✓" : index}
        </div>
        {!last && <div className={`step-line ${state === "done" ? "step-line-done" : ""}`} />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "pb-0" : "pb-5"}`}>
        <h3
          className={`text-[14px] font-bold leading-tight ${
            state === "todo" ? "text-mist-500" : state === "done" ? "text-go-400" : "text-mist-100"
          }`}
        >
          {title}
        </h3>
        {children && <div className="mt-2.5">{children}</div>}
      </div>
    </div>
  );
}
