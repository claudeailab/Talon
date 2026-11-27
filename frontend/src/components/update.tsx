import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { useFollow } from "../lib/hooks";
import type { UpdateStatus } from "../lib/types";
import { Button } from "./ui";
import { clock, Dot, Halo, useEasedProgress } from "./halo";

const STEPS: { id: string; label: string; doing: string }[] = [
  { id: "download", label: "Download", doing: "Downloading the update" },
  { id: "backup", label: "Back up", doing: "Backing up the current version" },
  { id: "install", label: "Install", doing: "Installing the update" },
  { id: "restart", label: "Restart", doing: "Restarting Talon" },
];
/* where each step starts on the ring (%), and how fast the ring eases within it (s) */
const START = [0, 20, 32, 88, 100];
const PACE = [6, 4, 35, 8];

/**
 * The halo shown while an update runs: the Talon logo in a ring that fills up, one
 * sentence about what is happening and the four steps as dashes. It keeps working while
 * the server restarts (requests fail for a few seconds), survives page reloads (the server
 * reports the running update), and reloads the page into the new version when done.
 */
export function UpdateOverlay() {
  const qc = useQueryClient();
  const [watching, setWatching] = useState(false);
  const [offline, setOffline] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const last = useRef<UpdateStatus | null>(null);

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

  // finished: reload into the new UI
  const done = watching && st?.state === "success" && health.data?.version === st.target;
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => location.reload(), 3000);
    return () => clearTimeout(t);
  }, [done]);

  const failed = st?.state === "failed";
  const idx = !st ? 0 : offline || st.step === "restart" || st.step === "done" ? 3 : Math.max(0, STEPS.findIndex((s) => s.id === st.step));
  const { pct, within, now } = useEasedProgress(idx, START, PACE, done, watching && !done && !failed);

  if (!watching || !st) return null;
  const elapsed = st.started ? Math.max(0, now / 1000 - st.started) : null;
  return (
    <Halo
      tone={failed ? "failed" : done ? "done" : "run"}
      pct={pct}
      label={failed ? "ROLLED BACK" : `${Math.round(pct)}%`}
      title={failed ? "The update didn't finish" : done ? `Talon ${st.target} is installed` : STEPS[idx].doing}
      subtitle={
        failed ? (
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
        )
      }
      steps={failed ? undefined : STEPS.map((s) => s.label)}
      step={idx}
      within={within}
      footer={
        !failed &&
        !done && (
          <>
            Shared folders stay available
            <Dot />
            Rolls back by itself if anything fails
            <Dot />
            You can close this page
          </>
        )
      }
    >
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
          {showLog && <UpdateLog text={st.log!.slice(-80).join("\n")} />}
        </div>
      )}
    </Halo>
  );
}

/** The update's log, scrolled to the newest line. */
function UpdateLog({ text }: { text: string }) {
  const follow = useFollow<HTMLPreElement>(text);
  return (
            <pre {...follow} className="mt-2 max-h-48 overflow-auto rounded-xl bg-black/40 p-3 text-left font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-300 ring-1 ring-white/10 [overflow-wrap:anywhere]">
              {text}
            </pre>
  );
}

/** Shown instead of the login page when the server is temporarily unreachable. */
export function Reconnecting({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    const t = setInterval(onBack, 2000);
    return () => clearInterval(t);
  }, [onBack]);
  return <Halo tone="run" pct={null} title="Reconnecting to Talon" subtitle="The NAS is restarting or temporarily unreachable. This page reconnects by itself." />;
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
