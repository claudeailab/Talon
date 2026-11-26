import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import type { UpdateStatus } from "../lib/types";
import { Button } from "./ui";

const STEPS: { id: string; label: string; doing: string }[] = [
  { id: "download", label: "Download", doing: "Downloading the update" },
  { id: "backup", label: "Back up", doing: "Backing up the current version" },
  { id: "install", label: "Install", doing: "Installing the update" },
  { id: "restart", label: "Restart", doing: "Restarting Talon" },
];
/* Where each step starts on the ring (%), and how fast the ring creeps forward within it
   (seconds to cover about two thirds of the step). The server only says which step runs,
   so within a step the ring eases towards its end and never quite reaches it. */
const START = [0, 20, 32, 88, 100];
const PACE = [6, 4, 35, 8];

/** mm:ss */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Full-screen, non-dismissable "halo" shown while an update runs: the Talon logo in a ring
 * that fills up, one sentence about what is happening and the four steps as dashes.
 * It keeps working while the server restarts (requests fail for a few seconds), survives
 * page reloads (the server reports the running update), and reloads the page into the new
 * version when done.
 */
export function UpdateOverlay() {
  const qc = useQueryClient();
  const [watching, setWatching] = useState(false);
  const [offline, setOffline] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const last = useRef<UpdateStatus | null>(null);
  const stepAt = useRef<{ idx: number; at: number }>({ idx: -1, at: Date.now() });
  const shown = useRef(0);

  const status = useQuery({
    queryKey: ["update-status"],
    queryFn: () => api.get<UpdateStatus>("/update/status"),
    refetchInterval: watching ? 1500 : 20000,
    retry: false,
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<{ version: string; updating: boolean }>("/health"),
    enabled: watching,
    refetchInterval: 1500,
    retry: false,
  });

  if (status.data) last.current = status.data;
  const st = last.current;

  useEffect(() => {
    if (st?.state === "running") setWatching(true);
  }, [st?.state]);
  useEffect(() => {
    setOffline(watching && (status.isError || health.isError));
  }, [watching, status.isError, health.isError, status.dataUpdatedAt, health.dataUpdatedAt]);
  // the ring and the clock move every quarter second
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [watching]);

  // finished: reload into the new UI
  const done = watching && st?.state === "success" && health.data?.version === st.target;
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => location.reload(), 3000);
    return () => clearTimeout(t);
  }, [done]);

  if (!watching || !st) return null;
  const failed = st.state === "failed";
  const idx = offline || st.step === "restart" || st.step === "done" ? 3 : Math.max(0, STEPS.findIndex((s) => s.id === st.step));
  if (stepAt.current.idx !== idx) stepAt.current = { idx, at: now };
  const within = 1 - Math.exp(-(now - stepAt.current.at) / 1000 / PACE[idx]);
  const target = done ? 100 : START[idx] + (START[idx + 1] - START[idx]) * Math.min(0.95, within);
  shown.current = Math.max(shown.current, target); // never goes back
  const pct = shown.current;
  const elapsed = st.started ? Math.max(0, now / 1000 - st.started) : null;

  const R = 108;
  const C = 2 * Math.PI * R;
  const tone = failed ? ["#fb7185", "#f43f5e"] : done ? ["#34d399", "#10b981"] : ["#818cf8", "#c084fc"];
  const title = failed ? "The update didn't finish" : done ? `Talon ${st.target} is installed` : STEPS[idx].doing;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] animate-[fade-in_300ms_ease-out] overflow-y-auto bg-[radial-gradient(1200px_700px_at_50%_35%,#312e81_0%,#1e1b4b_38%,#09090b_100%)] text-center text-white"
    >
      <div className="flex min-h-full flex-col items-center px-6 pt-10 pb-6">
      <div className="flex w-full flex-1 flex-col items-center justify-center">
      {/* soft glow behind the ring, tinted by the state */}
      <div
        aria-hidden
        className={cx(
          "pointer-events-none absolute top-[38%] left-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl",
          failed ? "bg-[radial-gradient(circle,rgba(244,63,94,.28),transparent_60%)]" : done ? "bg-[radial-gradient(circle,rgba(16,185,129,.28),transparent_60%)]" : "bg-[radial-gradient(circle,rgba(139,92,246,.35),transparent_60%)]",
        )}
      />

      <div className="relative size-[200px] shrink-0 sm:size-[240px]">
        <svg viewBox="0 0 240 240" className="absolute inset-0 size-full -rotate-90">
          <defs>
            <linearGradient id="halo-tone" x1="0" x2="1">
              <stop offset="0" stopColor={tone[0]} />
              <stop offset="1" stopColor={tone[1]} />
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
            strokeDashoffset={C * (1 - pct / 100)}
            className="transition-[stroke-dashoffset] duration-300 ease-out"
          />
        </svg>
        <img
          src="/favicon.svg"
          alt=""
          className={cx("absolute top-1/2 left-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-[26px] shadow-2xl shadow-black/50 sm:size-28", !failed && !done && "motion-safe:animate-pulse")}
        />
        {(done || failed) && (
          <span
            className={cx(
              "absolute right-[18%] bottom-[18%] flex size-10 items-center justify-center rounded-full text-white ring-4 ring-[#1e1b4b]",
              done ? "bg-emerald-500" : "bg-rose-500",
            )}
          >
            {done ? <Check className="size-5" strokeWidth={3} /> : <AlertTriangle className="size-5" />}
          </span>
        )}
      </div>

      <div className="relative mt-8 text-[13px] font-medium tracking-[.3em] text-indigo-200 tabular-nums">{failed ? "ROLLED BACK" : `${Math.round(pct)}%`}</div>
      <h2 className="relative mt-3 text-3xl font-semibold tracking-tight sm:text-[34px]">{title}</h2>
      <p className="relative mt-2 text-[15px] text-indigo-300">
        {failed ? (
          <>{st.from ? `Talon ${st.from} was restored.` : "The previous version was restored."} Your data and shared folders were not affected.</>
        ) : done ? (
          <>Reloading the page…</>
        ) : (
          <>
            Talon {st.from ? `${st.from} → ` : ""}
            <b className="font-semibold text-white">{st.target}</b>
            {elapsed != null && <span className="tabular-nums"> · {clock(elapsed)}</span>}
            {idx === 3 && offline && <> · waiting for the service</>}
          </>
        )}
      </p>

      {!failed && (
        <div className="relative mt-7 flex gap-2.5" aria-hidden>
          {STEPS.map((s, i) => (
            <div key={s.id} className="w-14 sm:w-[70px]">
              <div className="h-1 overflow-hidden rounded-full bg-white/15">
                <div
                  className={cx("h-full rounded-full transition-[width] duration-300", done ? "bg-emerald-400" : "bg-violet-400")}
                  style={{ width: `${done || i < idx ? 100 : i === idx ? Math.min(95, within * 100) : 0}%` }}
                />
              </div>
              <div className={cx("mt-2 text-[11px]", i === idx && !done ? "text-indigo-100" : "text-indigo-300/60")}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {failed && st.error && (
        <div className="relative mt-6 w-full max-w-md rounded-2xl bg-rose-500/10 px-4 py-3 text-left text-[13px] text-rose-200 ring-1 ring-rose-400/25">{st.error}</div>
      )}

      {done && (
        <div className="relative mt-7">
          <Button variant="primary" onClick={() => location.reload()}>
            Reload now
          </Button>
        </div>
      )}
      {failed && (
        <div className="relative mt-6">
          <Button
            variant="primary"
            onClick={() => {
              setWatching(false);
              qc.invalidateQueries();
            }}
          >
            Close
          </Button>
        </div>
      )}

      {(st.log?.length ?? 0) > 0 && (
        <div className="relative mt-6 w-full max-w-xl">
          <button onClick={() => setShowLog((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-300/80 hover:text-white">
            <ChevronDown className={cx("size-3.5 transition", showLog && "rotate-180")} /> Details
          </button>
          {showLog && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-black/40 p-3 text-left font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-300 ring-1 ring-white/10 [overflow-wrap:anywhere]">
              {st.log!.slice(-80).join("\n")}
            </pre>
          )}
        </div>
      )}

      </div>
      {!failed && !done && (
        <div className="relative mt-10 text-[13px] text-indigo-400">
          Shared folders stay available<span className="mx-2.5 text-zinc-500">·</span>Rolls back by itself if anything fails
          <span className="mx-2.5 text-zinc-500">·</span>You can close this page
        </div>
      )}
      </div>
    </div>
  );
}

/** Shown instead of the login page when the server is temporarily unreachable. */
export function Reconnecting({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    const t = setInterval(onBack, 2000);
    return () => clearInterval(t);
  }, [onBack]);
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 text-center">
      <img src="/favicon.svg" alt="" className="size-14 animate-pulse" />
      <div>
        <div className="font-semibold">Reconnecting to Talon…</div>
        <div className="text-sm text-zinc-500">The NAS is restarting or temporarily unreachable.</div>
      </div>
    </div>
  );
}

export function UpdatePill({ onClick, version }: { onClick: () => void; version: string }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-brand-600 to-violet-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-brand-600/30 transition hover:brightness-110"
    >
      <Sparkles className="size-3.5" /> Update {version} available
    </button>
  );
}
