import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { cx } from "../lib/format";

/* ------------------------------------------------------------------ Button */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
const variants: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-sm shadow-brand-600/25 hover:bg-brand-500 active:bg-brand-700 disabled:bg-brand-600/50",
  secondary:
    "bg-white text-zinc-800 ring-1 ring-inset ring-zinc-200 shadow-xs hover:bg-zinc-50 dark:bg-white/5 dark:text-zinc-100 dark:ring-white/10 dark:hover:bg-white/10",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100",
  danger: "bg-rose-600 text-white shadow-sm shadow-rose-600/25 hover:bg-rose-500 disabled:bg-rose-600/50",
  soft: "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-60",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-9.5 px-4 text-sm",
        size === "lg" && "h-11 px-5 text-[15px]",
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-9 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Card */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("card", className)}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="truncate text-[13px] text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Badge */
type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "violet";
const tones: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20",
  red: "bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-400/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-400/20",
  violet: "bg-brand-50 text-brand-700 ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20",
};

export function Badge({ tone = "neutral", dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse }: { tone: "green" | "amber" | "red" | "zinc" | "blue"; pulse?: boolean }) {
  const c = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-rose-500",
    zinc: "bg-zinc-400",
    blue: "bg-sky-500",
  }[tone];
  return (
    <span className="relative inline-flex size-2.5">
      {pulse && <span className={cx("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", c)} />}
      <span className={cx("relative inline-flex size-2.5 rounded-full", c)} />
    </span>
  );
}

/* ------------------------------------------------------------------ Progress */
export function Progress({
  value,
  tone = "brand",
  className,
  striped,
}: {
  value: number;
  tone?: "brand" | "green" | "amber" | "red" | "blue";
  className?: string;
  striped?: boolean;
}) {
  const c = {
    brand: "bg-gradient-to-r from-brand-500 to-violet-500",
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-rose-500",
    blue: "bg-sky-500",
  }[tone];
  return (
    <div className={cx("h-2 overflow-hidden rounded-full bg-zinc-200/70 dark:bg-white/[0.08]", className)}>
      <div
        className={cx("h-full rounded-full transition-[width] duration-700 ease-out", c, striped && "animate-pulse")}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function usageTone(p: number): "brand" | "amber" | "red" {
  return p >= 90 ? "red" : p >= 75 ? "amber" : "brand";
}

/* ------------------------------------------------------------------ Form */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs text-rose-600 dark:text-rose-400">{error}</span>
      ) : (
        hint && <span className="mt-1.5 block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
      )}
    </label>
  );
}

const inputCls =
  "block w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm text-zinc-900 shadow-xs ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 transition focus:ring-2 focus:ring-brand-500 focus:outline-none disabled:opacity-60 dark:bg-white/[0.04] dark:text-white dark:ring-white/10 dark:placeholder:text-zinc-500 dark:focus:ring-brand-400";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputCls, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, "appearance-auto pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50",
        checked ? "bg-brand-600" : "bg-zinc-300 dark:bg-white/15",
      )}
    >
      <span
        className={cx(
          "inline-block size-5 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200",
          checked ? "translate-x-5.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {description && <div className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">{description}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={typeof title === "string" ? title : undefined} />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; tone?: string }[];
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-xl bg-zinc-100 p-1 dark:bg-white/5">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-lg font-medium transition-all",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-[13px]",
            value === o.value
              ? cx("bg-white shadow-sm dark:bg-zinc-700/80", o.tone ?? "text-zinc-900 dark:text-white")
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-zinc-200)] [scrollbar-width:none] dark:shadow-[inset_0_-1px_0_rgb(255_255_255/0.1)] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cx(
            "flex items-center gap-2 border-b-2 px-2.5 py-2.5 text-sm font-medium whitespace-nowrap transition sm:px-3",
            value === t.value
              ? "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Modal */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  icon,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  icon?: ReactNode;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    setTimeout(() => ref.current?.querySelector<HTMLElement>("input,select,textarea")?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={id}>
      <div className="absolute inset-0 animate-in bg-zinc-950/40 backdrop-blur-[2px] dark:bg-black/60" onClick={onClose} />
      <div
        ref={ref}
        className={cx(
          "relative flex max-h-[92vh] w-full animate-pop flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-1 ring-zinc-900/5 sm:rounded-2xl dark:bg-zinc-900 dark:ring-white/10",
          { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" }[size],
        )}
      >
        <div className="flex items-start gap-3 border-b border-zinc-100 px-6 pt-5 pb-4 dark:border-white/5">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 id={id} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-2">
            <X className="size-4.5" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/60 px-6 py-3.5 dark:border-white/5 dark:bg-white/[0.02]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ Confirm */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  danger,
  typeToConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmText?: string;
  danger?: boolean;
  typeToConfirm?: string;
  loading?: boolean;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => setTyped(""), [open]);
  const ok = !typeToConfirm || typed === typeToConfirm;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      icon={
        danger ? (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
            <AlertTriangle className="size-5" />
          </div>
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} disabled={!ok} loading={loading} onClick={onConfirm}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-zinc-600 dark:text-zinc-300">
        <div>{message}</div>
        {typeToConfirm && (
          <Field
            label={
              <>
                Type <span className="font-mono font-semibold text-zinc-900 dark:text-white">{typeToConfirm}</span> to confirm
              </>
            }
          >
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              onKeyDown={(e) => e.key === "Enter" && ok && onConfirm()}
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Callout */
export function Callout({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const s = {
    info: ["bg-sky-50 text-sky-900 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-400/20", Info],
    warning: ["bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/20", AlertTriangle],
    danger: ["bg-rose-50 text-rose-900 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-400/20", XCircle],
    success: ["bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-400/20", CheckCircle2],
  } as const;
  const [cls, Icon] = s[tone];
  return (
    <div className={cx("flex gap-3 rounded-xl p-3.5 text-[13px] ring-1 ring-inset", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="opacity-90">{children}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Empty / Spinner */
export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-violet-100 text-brand-600 ring-1 ring-brand-100 dark:from-brand-500/10 dark:to-violet-500/10 dark:text-brand-300 dark:ring-white/5">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-balance">{title}</h3>
      {/* one line on anything wider than a phone */}
      {text && <p className="mt-1 text-sm text-balance text-zinc-500 sm:whitespace-nowrap dark:text-zinc-400">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-zinc-400", className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}

/* ------------------------------------------------------------------ Page header */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex min-h-10 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Menu */
export function Menu({
  trigger,
  children,
  align = "right",
  placement = "bottom",
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  placement?: "bottom" | "top";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight?: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu is rendered in a portal with fixed positioning, so scrolling or
  // clipping containers (tables, cards) can never cut it off or grow scrollbars.
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const place = () => {
      const t = ref.current?.getBoundingClientRect();
      const m = menuRef.current;
      if (!t || !m) return;
      const gap = 6, edge = 8, vw = window.innerWidth, vh = window.innerHeight;
      const w = m.offsetWidth, h = m.scrollHeight;
      let left = align === "right" ? t.right - w : t.left;
      left = Math.max(edge, Math.min(left, vw - w - edge));
      const below = vh - t.bottom - gap - edge, above = t.top - gap - edge;
      const up = placement === "top" ? !(h > above && below > above) : h > below && above > below;
      const room = up ? above : below;
      const top = up ? t.top - gap - Math.min(h, room) : t.bottom + gap;
      setPos({ top, left, maxHeight: h > room ? room : undefined });
    };
    place();
    const close = (e: Event) => !menuRef.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, align, placement]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!ref.current?.contains(n) && !menuRef.current?.contains(n)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);

  return (
    <div className={cx("relative", className)} ref={ref}>
      <div data-menu-trigger onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            onClick={() => setOpen(false)}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, maxHeight: pos?.maxHeight, visibility: pos ? "visible" : "hidden" }}
            className={cx(
              "fixed z-50 min-w-52 animate-pop rounded-xl bg-white p-1.5 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-800 dark:ring-white/10",
              pos?.maxHeight !== undefined && "overflow-y-auto",
            )}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  disabled,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition disabled:opacity-40",
        danger
          ? "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/5",
      )}
    >
      {icon && <span className="[&>svg]:size-4">{icon}</span>}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Toasts */
type Toast = { id: number; tone: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<(tone: Toast["tone"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto flex animate-slide items-start gap-3 rounded-xl bg-white p-3.5 text-sm shadow-lg ring-1 ring-zinc-900/10 dark:bg-zinc-800 dark:ring-white/10"
            >
              {t.tone === "success" && <CheckCircle2 className="mt-0.5 size-4.5 shrink-0 text-emerald-500" />}
              {t.tone === "error" && <XCircle className="mt-0.5 size-4.5 shrink-0 text-rose-500" />}
              {t.tone === "info" && <Info className="mt-0.5 size-4.5 shrink-0 text-sky-500" />}
              <span className="min-w-0 flex-1 break-words">{t.text}</span>
              <button className="text-zinc-400 hover:text-zinc-600" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
