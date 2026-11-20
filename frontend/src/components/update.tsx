import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import type { UpdateStatus } from "../lib/types";
import { Button } from "./ui";

const STEPS: { id: string; label: string }[] = [
  { id: "download", label: "Download & verify" },
  { id: "backup", label: "Back up current version" },
  { id: "install", label: "Install update" },
  { id: "restart", label: "Restart Talon" },
];

/**
 * Full-screen, non-dismissable progress overlay shown while an update runs.
 * It keeps working while the server restarts (requests fail for a few seconds),
 * survives page reloads (the server reports the running update), and reloads the
 * page into the new version when done.
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
    const t = setTimeout(() => location.reload(), 2500);
    return () => clearTimeout(t);
  }, [done]);

  if (!watching || !st) return null;
  const failed = st.state === "failed";
  const stepIdx = offline || st.step === "restart" ? 3 : Math.max(0, STEPS.findIndex((s) => s.id === st.step));

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-md">
      <div className="w-full max-w-lg animate-pop rounded-3xl bg-white p-7 shadow-2xl ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
        <div className="flex items-center gap-4">
          <div
            className={cx(
              "flex size-14 shrink-0 items-center justify-center rounded-2xl",
              failed ? "bg-rose-100 text-rose-600 dark:bg-rose-500/15" : done ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15" : "bg-brand-50 dark:bg-brand-500/10",
            )}
          >
            {failed ? (
              <AlertTriangle className="size-7" />
            ) : done ? (
              <CheckCircle2 className="size-7" />
            ) : (
              <img src="/favicon.svg" alt="" className="size-10 animate-pulse" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {failed ? "Update failed" : done ? `Updated to Talon ${st.target}` : `Updating Talon to ${st.target}`}
            </h2>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
              {failed
                ? "Talon was restored to the previous version. Your data and shares were not affected."
                : done
                  ? "Reloading the interface…"
                  : "Shared folders stay available. Please keep this page open."}
            </p>
          </div>
        </div>

        {!failed && (
          <ol className="mt-6 space-y-3">
            {STEPS.map((s, i) => {
              const complete = done || i < stepIdx;
              const active = !done && i === stepIdx;
              return (
                <li key={s.id} className="flex items-center gap-3 text-sm">
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
                  <span className={cx(active ? "font-medium" : complete ? "text-zinc-600 dark:text-zinc-300" : "text-zinc-400")}>
                    {s.label}
                    {active && i === 3 && offline && <span className="ml-2 text-xs text-zinc-500">waiting for the service…</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {failed && st.error && (
          <div className="mt-5 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-800 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-400/20">
            {st.error}
          </div>
        )}

        {(st.log?.length ?? 0) > 0 && (
          <div className="mt-5">
            <button onClick={() => setShowLog((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
              <ChevronDown className={cx("size-3.5 transition", showLog && "rotate-180")} /> Details
            </button>
            {showLog && (
              <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                {st.log!.slice(-80).join("\n")}
              </pre>
            )}
          </div>
        )}

        {failed && (
          <div className="mt-6 flex justify-end">
            <Button
              variant="primary"
              icon={<RotateCcw className="size-4" />}
              onClick={() => {
                setWatching(false);
                qc.invalidateQueries();
              }}
            >
              Close
            </Button>
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
      className="hidden items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-600 to-violet-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-brand-600/30 transition hover:brightness-110 sm:flex"
    >
      <Sparkles className="size-3.5" /> Update {version} available
    </button>
  );
}
