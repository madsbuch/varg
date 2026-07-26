import type { ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useBackHandler } from "../lib/back";
import { IconClose } from "./icons";

// Every mounted Sheet used to register its own window keydown listener, so
// one Escape closed a nested picker AND the editor underneath it. Only the
// top of the stack may respond.
const sheetStack: object[] = [];

export function Sheet({
  title,
  onClose,
  dismissOnBackdrop = true,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Off for sheets holding an uncommitted draft, e.g. the split editor. */
  dismissOnBackdrop?: boolean;
  children: ReactNode;
}) {
  const token = useRef({});

  // Callers pass `onClose` as an inline arrow, so it is a new function on
  // every render. Both stacks below are strictly ordered by registration
  // time, so re-registering on a re-render would hoist a parent sheet above
  // the picker it opened — one Back would then close the editor instead of
  // the picker. Read through a ref and register exactly once per mount.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const self = token.current;
    sheetStack.push(self);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (sheetStack[sheetStack.length - 1] !== self) return;
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = sheetStack.lastIndexOf(self);
      if (i >= 0) sheetStack.splice(i, 1);
    };
  }, []);

  // Android Back closes the sheet rather than the app. The back stack is
  // last-in-first-out too, so nesting works without extra bookkeeping.
  const onBack = useCallback(() => {
    close.current();
    return true;
  }, []);
  useBackHandler(true, onBack);

  return (
    <div
      className="sheet-backdrop"
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div className="sheet" onClick={(e) => { e.stopPropagation(); }}>
        <div className="sheet-handle" />
        <div className="row" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="check" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? "on" : ""}
          onClick={() => { onChange(o.value); }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="empty">
      {icon}
      <div style={{ fontWeight: 700, color: "var(--text)" }}>{title}</div>
      {hint && <div style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/**
 * In-app confirmation dialog. Android WebViews often swallow
 * window.confirm(), so destructive actions must use this instead.
 */
export function ConfirmSheet({
  title,
  message,
  confirmLabel = "Confirm",
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        {message}
      </p>
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className={`btn ${danger ? "danger" : "primary"}`}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

export function Stat({ n, l }: { n: ReactNode; l: string }) {
  return (
    <div className="stat">
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}
