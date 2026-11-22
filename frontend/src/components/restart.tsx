import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Loader2, Power } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/format";

const EVENT = "talon-restart";
type Health = { version: string; started: number };

async function health(): Promise<Health | null> {
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    return r.ok ? ((await r.json()) as Health) : null;
  } catch {
    return null;
  }
}

/** Restart the NAS and show the restart screen until Talon is back. */
export async function restartNas(): Promise<void> {
  const before = await health();
  await api.post("/system/power", { action: "reboot" });
  window.dispatchEvent(new CustomEvent(EVENT, { detail: before?.started ?? 0 }));
}

const STEPS = ["Shutting down", "Starting up", "Reconnecting"];

/**
 * Full-screen screen shown while the NAS restarts: it keeps asking Talon whether it
 * is back (a new start time) and reloads the page when it is.
 */
export function RestartOverlay() {
  const [since, setSince] = useState<number | null>(null);          // Talon's start time before the restart
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [back, setBack] = useState(false);
  const began = useRef(0);
  useEffect(() => {
    const on = (e: Event) => {
      setSince((e as CustomEvent<number>).detail);
      setStep(0);
      setBack(false);
      began.current = Date.now();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (since == null || back) return;
    let stop = false;
    const tick = async () => {
      setElapsed(Math.round((Date.now() - began.current) / 1000));
      const h = await health();
      if (stop) return;
      if (!h) setStep((s) => Math.max(s, 1));                       // not answering: it is restarting
      else if (h.started !== since) {
        setStep(2);
        setBack(true);
        setTimeout(() => location.reload(), 1500);
      }
    };
    const t = setInterval(tick, 2000);
    tick();
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [since, back]);
  if (since == null) return null;
  const slow = elapsed > 300 && !back;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-md">
      <div className="w-full max-w-md animate-pop rounded-3xl bg-white p-7 shadow-2xl ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
        <div className="flex items-center gap-4">
          <div className={cx("flex size-14 shrink-0 items-center justify-center rounded-2xl", back ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15" : "bg-brand-50 text-brand-600 dark:bg-brand-500/10")}>
            {back ? <CheckCircle2 className="size-7" /> : <Power className="size-7 animate-pulse" />}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{back ? "The NAS is back" : "Restarting the NAS"}</h2>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
              {back ? "Reloading the interface…" : "This usually takes 1–3 minutes. Keep this page open; it reconnects by itself."}
            </p>
          </div>
        </div>
        <ol className="mt-6 space-y-3">
          {STEPS.map((label, i) => {
            const complete = back || i < step;
            const active = !back && i === step;
            return (
              <li key={label} className="flex items-center gap-3 text-sm">
                <span
                  className={cx(
                    "flex size-6 items-center justify-center rounded-full",
                    complete && "bg-emerald-500 text-white",
                    active && "bg-brand-600 text-white",
                    !complete && !active && "bg-zinc-100 text-zinc-400 dark:bg-white/5",
                  )}
                >
                  {complete ? <Check className="size-3.5" strokeWidth={3} /> : active ? <Loader2 className="size-3.5 animate-spin" /> : <span className="text-xs">{i + 1}</span>}
                </span>
                <span className={cx(active ? "font-medium" : complete ? "text-zinc-600 dark:text-zinc-300" : "text-zinc-400")}>{label}</span>
              </li>
            );
          })}
        </ol>
        <p className="tabular mt-5 text-xs text-zinc-500">
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} elapsed
        </p>
        {slow && (
          <p className="mt-2 text-[13px] text-amber-700 dark:text-amber-400">
            It is taking longer than usual. Check that the NAS is switched on and connected to the network; this page keeps trying.
          </p>
        )}
      </div>
    </div>
  );
}
