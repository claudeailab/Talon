import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { cx } from "../lib/format";

/* The "halo": a full-screen dark scene with the Talon logo in a ring that fills up, used
   while Talon updates or the NAS restarts. The page decides the words; this draws them. */

export type HaloTone = "run" | "done" | "failed";

/** mm:ss */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Progress for steps whose length is not known: each step owns a slice of the ring
 * (starts: where each step begins, the last entry is 100) and within it the ring eases
 * towards the slice's end ("pace": seconds to cover about two thirds of it), never
 * quite reaching it and never going back. Returns the ring's percent and how far the
 * current step is (0–1).
 */
export function useEasedProgress(step: number, starts: number[], pace: number[], finished: boolean, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  const at = useRef({ step: -1, t: Date.now() });
  const shown = useRef(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  if (at.current.step !== step) at.current = { step, t: now };
  const within = Math.min(0.95, 1 - Math.exp(-(now - at.current.t) / 1000 / (pace[step] || 10)));
  const target = finished ? 100 : starts[step] + (starts[step + 1] - starts[step]) * within;
  shown.current = Math.max(shown.current, target);
  return { pct: shown.current, within: finished ? 1 : within, now };
}

export function Halo({
  tone,
  pct,
  label,
  title,
  subtitle,
  steps,
  step = 0,
  within = 0,
  footer,
  children,
}: {
  tone: HaloTone;
  /** how full the ring is; null: an unknown wait (a turning arc) */
  pct: number | null;
  /** the small spaced line above the title, e.g. "64%" */
  label?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** the steps as dashes under the subtitle */
  steps?: string[];
  step?: number;
  within?: number;
  /** the line of facts at the bottom of the screen */
  footer?: ReactNode;
  /** buttons, an error, details: under the steps */
  children?: ReactNode;
}) {
  const R = 108;
  const C = 2 * Math.PI * R;
  const colors = tone === "failed" ? ["#fb7185", "#f43f5e"] : tone === "done" ? ["#34d399", "#10b981"] : ["#818cf8", "#c084fc"];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
      className="fixed inset-0 z-[70] animate-[fade-in_300ms_ease-out] overflow-y-auto bg-[radial-gradient(1200px_700px_at_50%_35%,#312e81_0%,#1e1b4b_38%,#09090b_100%)] text-center text-white"
    >
      <div className="flex min-h-full flex-col items-center px-6 pt-10 pb-6">
        <div className="flex w-full flex-1 flex-col items-center justify-center">
          {/* soft glow behind the ring, tinted by the state */}
          <div
            aria-hidden
            className={cx(
              "pointer-events-none absolute top-[38%] left-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl",
              tone === "failed"
                ? "bg-[radial-gradient(circle,rgba(244,63,94,.28),transparent_60%)]"
                : tone === "done"
                  ? "bg-[radial-gradient(circle,rgba(16,185,129,.28),transparent_60%)]"
                  : "bg-[radial-gradient(circle,rgba(139,92,246,.35),transparent_60%)]",
            )}
          />

          <div className="relative size-[200px] shrink-0 sm:size-[240px]">
            <svg viewBox="0 0 240 240" className={cx("absolute inset-0 size-full -rotate-90", pct == null && "motion-safe:animate-[spin_2.4s_linear_infinite]")}>
              <defs>
                <linearGradient id="halo-tone" x1="0" x2="1">
                  <stop offset="0" stopColor={colors[0]} />
                  <stop offset="1" stopColor={colors[1]} />
                </linearGradient>
              </defs>
              <circle cx="120" cy="120" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="6" />
              <circle
                cx="120"
                cy="120"
                r={R}
                fill="none"
                stroke="url(#halo-tone)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - (pct ?? 22) / 100)}
                className="transition-[stroke-dashoffset] duration-300 ease-out"
              />
            </svg>
            <img
              src="/favicon.svg"
              alt=""
              className={cx("absolute top-1/2 left-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-[26px] shadow-2xl shadow-black/50 sm:size-28", tone === "run" && "motion-safe:animate-pulse")}
            />
            {tone !== "run" && (
              <span
                className={cx(
                  "absolute right-[18%] bottom-[18%] flex size-10 items-center justify-center rounded-full text-white ring-4 ring-[#1e1b4b]",
                  tone === "done" ? "bg-emerald-500" : "bg-rose-500",
                )}
              >
                {tone === "done" ? <Check className="size-5" strokeWidth={3} /> : <AlertTriangle className="size-5" />}
              </span>
            )}
          </div>

          {label != null && <div className="relative mt-8 text-[13px] font-medium tracking-[.3em] text-indigo-200 tabular-nums">{label}</div>}
          <h2 className={cx("relative text-3xl font-semibold tracking-tight sm:text-[34px]", label != null ? "mt-3" : "mt-8")}>{title}</h2>
          {subtitle && <p className="relative mt-2 max-w-xl text-[15px] text-indigo-300">{subtitle}</p>}

          {steps && (
            <div className="relative mt-7 flex gap-2.5" aria-hidden>
              {steps.map((s, i) => (
                <div key={s} className="w-14 sm:w-[70px]">
                  <div className="h-1 overflow-hidden rounded-full bg-white/15">
                    <div
                      className={cx("h-full rounded-full transition-[width] duration-300", tone === "done" ? "bg-emerald-400" : tone === "failed" ? "bg-rose-400" : "bg-violet-400")}
                      style={{ width: `${tone === "done" || i < step ? 100 : i === step ? Math.min(95, within * 100) : 0}%` }}
                    />
                  </div>
                  <div className={cx("mt-2 text-[11px]", i === step && tone === "run" ? "text-indigo-100" : "text-indigo-300/60")}>{s}</div>
                </div>
              ))}
            </div>
          )}

          {children}
        </div>
        {footer && <div className="relative mt-10 text-[13px] text-indigo-400">{footer}</div>}
      </div>
    </div>
  );
}

/** The dot between the facts in a halo's footer. */
export function Dot() {
  return <span className="mx-2.5 text-zinc-500">·</span>;
}
