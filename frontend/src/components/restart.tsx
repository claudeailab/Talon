import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { clock, Dot, Halo, useEasedProgress } from "./halo";

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

const STEPS = ["Shut down", "Start up", "Reconnect"];
const DOING = ["Shutting down", "Starting up", "Reconnecting"];
/* where each step starts on the ring (%), and how fast the ring eases within it (s) */
const START = [0, 15, 92, 100];
const PACE = [6, 45, 2];

/**
 * The halo shown while the NAS restarts: it keeps asking Talon whether it is back (a new
 * start time) and reloads the page when it is.
 */
export function RestartOverlay() {
  const [since, setSince] = useState<number | null>(null);          // Talon's start time before the restart
  const [step, setStep] = useState(0);
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
  const { pct, within, now } = useEasedProgress(step, START, PACE, back, since != null && !back);
  if (since == null) return null;
  const elapsed = Math.max(0, (now - began.current) / 1000);
  const slow = elapsed > 300 && !back;
  return (
    <Halo
      tone={back ? "done" : "run"}
      pct={pct}
      label={`${Math.round(pct)}%`}
      title={back ? "The NAS is back" : `${DOING[step]}`}
      subtitle={
        back ? (
          "Reloading the page…"
        ) : slow ? (
          <span className="text-amber-300">
            Taking longer than usual ({clock(elapsed)}). Check that the NAS is switched on and connected to the network; this page keeps trying.
          </span>
        ) : (
          <>
            Restarting the NAS · usually 1–3 minutes · <span className="tabular-nums">{clock(elapsed)}</span>
          </>
        )
      }
      steps={STEPS}
      step={step}
      within={within}
      footer={
        !back && (
          <>
            Shared folders are back when the NAS is
            <Dot />
            This page reconnects by itself
          </>
        )
      }
    />
  );
}
