import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChevronDown, Package, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { ago, cx } from "../lib/format";
import { useAction } from "../lib/hooks";
import { Badge, Button, Callout, Card, CardHeader, ConfirmDialog, Input, PageLoader, Progress, Switch } from "../components/ui";

type Pkg = { name: string; old: string; new: string; security: boolean; restart: boolean };
type OsInfo = {
  os: string;
  checked_at: number | null;
  error: string | null;
  packages: Pkg[];
  security: number;
  restart_needed: boolean;
  progress: { state: "idle" | "running" | "success" | "error"; phase?: string; package?: string; percent?: number; done?: number; total?: number; error?: string };
  auto: { security: boolean; restart: boolean; restart_time: string };
  last_install: { at: number; ok: boolean; count: number; error?: string } | null;
};

/** Settings → Update → Operating system: package updates without a terminal. */
export default function OsUpdateTab() {
  const q = useQuery({
    queryKey: ["os-update"],
    queryFn: () => api.get<OsInfo>("/os-update"),
    refetchInterval: (query) => (query.state.data?.progress.state === "running" ? 1000 : 30000),
  });
  const check = useAction(() => api.post<OsInfo>("/os-update/check"), {
    invalidate: ["os-update"],
    success: (r) => (r.error ? "" : r.packages.length ? `${r.packages.length} update${r.packages.length === 1 ? "" : "s"} available` : "The operating system is up to date"),
  });
  const install = useAction(() => api.post<OsInfo>("/os-update/install"), { invalidate: ["os-update"], onSuccess: () => setConfirm(false) });
  const auto = useAction((body: Partial<OsInfo["auto"]>) => api.put<OsInfo>("/os-update/auto", body), { invalidate: ["os-update"], success: "Saved" });
  const reboot = useAction(() => api.post("/system/power", { action: "reboot" }), {
    success: "Restarting the NAS. This page reconnects when it is back.",
    onSuccess: () => setRestart(false),
  });
  const [confirm, setConfirm] = useState(false);
  const [restart, setRestart] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [time, setTime] = useState("04:00");
  useEffect(() => {
    if (q.data) setTime(q.data.auto.restart_time);
  }, [q.data?.auto.restart_time]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!q.data) return <PageLoader />;
  const d = q.data;
  const running = d.progress.state === "running";
  const sec = d.packages.filter((p) => p.security);
  const other = d.packages.filter((p) => !p.security);
  const needsRestart = d.packages.some((p) => p.restart);
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

  return (
    <div className="space-y-5">
      {d.restart_needed && !running && (
        <Card className="flex flex-wrap items-center justify-between gap-3 bg-amber-50/70 p-4 dark:bg-amber-500/10">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Restart to finish</div>
            <div className="text-[13px] text-zinc-600 dark:text-zinc-400">Some updates, such as a new Linux kernel, are only used after a restart.</div>
          </div>
          <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => setRestart(true)}>
            Restart now
          </Button>
        </Card>
      )}

      <Card>
        <CardHeader
          icon={<Package className="size-4.5" />}
          title="Operating System"
          subtitle={`${d.os}${d.checked_at ? ` · checked ${ago(d.checked_at)}` : ""}`}
          actions={
            <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={check.isPending} disabled={running} onClick={() => check.mutate()}>
              Check now
            </Button>
          }
        />
        <div className="space-y-4 px-5 pb-5">
          {d.error && <Callout tone="warning" title="Could not check for updates">{d.error}</Callout>}
          {d.progress.state === "error" && !running && <Callout tone="danger" title="Installing the updates failed">{d.progress.error}</Callout>}

          {running ? (
            <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-white/[0.03]">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Installing updates</div>
                  <div className="text-[13px] break-words text-zinc-500">
                    {d.progress.phase === "download"
                      ? "Downloading"
                      : `Updating ${d.progress.package || "…"} · ${Math.min((d.progress.done ?? 0) + 1, d.progress.total ?? 1)} of ${d.progress.total}`}
                  </div>
                </div>
                <span className="tabular text-sm font-semibold text-zinc-500">{Math.round(d.progress.percent ?? 0)}%</span>
              </div>
              <Progress value={d.progress.percent ?? 0} className="mt-3 h-2" />
              <p className="mt-2 text-xs text-zinc-500">Shared folders keep working. You can leave this page; the installation continues.</p>
            </div>
          ) : d.packages.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-50/70 p-4 dark:bg-emerald-500/10">
              <ShieldCheck className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="min-w-0">
                <div className="text-sm font-semibold">Up to date</div>
                <div className="text-[13px] text-zinc-600 dark:text-zinc-400">
                  {d.last_install?.ok ? `Last updates installed ${ago(d.last_install.at)}` : "No updates are waiting"}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold">
                    {d.packages.length} update{d.packages.length === 1 ? "" : "s"} available
                  </div>
                  {needsRestart && <div className="text-[13px] text-zinc-500">A restart is needed afterwards</div>}
                </div>
                <div className="flex items-center gap-2">
                  {d.security > 0 && <Badge tone="amber">{d.security} security</Badge>}
                  <Button variant="primary" onClick={() => setConfirm(true)}>
                    Install all updates
                  </Button>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-white/10">
                {sec.length > 0 && <PkgGroup title="Security" pkgs={sec} />}
                {other.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowOther(!showOther)}
                      className="flex w-full items-center justify-between border-t border-zinc-100 bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-500 uppercase first:border-0 dark:border-white/5 dark:bg-white/[0.03]"
                    >
                      Other · {other.length}
                      <ChevronDown className={cx("size-4 transition", showOther && "rotate-180")} />
                    </button>
                    {showOther && <PkgGroup pkgs={other} />}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader icon={<ShieldCheck className="size-4.5" />} title="Automatic Updates" subtitle="Security updates without you having to look" />
        <div className="divide-y divide-zinc-100 px-5 pb-2 dark:divide-white/5">
          <div className="flex items-start justify-between gap-4 pb-4">
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium">Install security updates automatically</div>
              <div className="text-[13px] text-zinc-500">Every night. You get an email when something was installed (set up SMTP first).</div>
            </div>
            <Switch checked={d.auto.security} onChange={(v) => auto.mutate({ security: v })} label="Install security updates automatically" />
          </div>
          <div className={cx("flex flex-wrap items-start justify-between gap-4 py-4", !d.auto.security && "opacity-50")}>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium">Restart automatically when needed</div>
              <div className="text-[13px] text-zinc-500">Only if an update needs it, at the time below. Shared folders are unavailable for a minute or two.</div>
              {d.auto.restart && (
                <div className="mt-2 flex items-center gap-2">
                  <Input value={time} onChange={(e) => setTime(e.target.value)} className="w-24" aria-label="Restart time" placeholder="04:00" />
                  {time !== d.auto.restart_time && (
                    <Button size="sm" disabled={!timeOk} onClick={() => auto.mutate({ restart_time: time })}>
                      Save
                    </Button>
                  )}
                  {!timeOk && <span className="text-xs text-rose-600">Use hh:mm, 24-hour</span>}
                </div>
              )}
            </div>
            <Switch checked={d.auto.restart} disabled={!d.auto.security} onChange={(v) => auto.mutate({ restart: v })} label="Restart automatically when needed" />
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => install.mutate()}
        loading={install.isPending}
        title={`Install ${d.packages.length} update${d.packages.length === 1 ? "" : "s"}?`}
        confirmText="Install"
        message={`Shared folders keep working while they install. Changed configuration files are kept.${needsRestart ? " A restart is needed afterwards." : ""}`}
      />
      <ConfirmDialog
        open={restart}
        onClose={() => setRestart(false)}
        onConfirm={() => reboot.mutate()}
        loading={reboot.isPending}
        title="Restart the NAS?"
        confirmText="Restart"
        message="Shared folders and this web interface are unavailable for a minute or two."
      />
    </div>
  );
}

function PkgGroup({ title, pkgs }: { title?: string; pkgs: Pkg[] }) {
  return (
    <>
      {title && <div className="bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-500 uppercase dark:bg-white/[0.03]">{title} · {pkgs.length}</div>}
      <ul className="divide-y divide-zinc-100 dark:divide-white/5">
        {pkgs.map((p) => (
          <li key={p.name} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold break-words">{p.name}</div>
              <div className="font-mono text-[11.5px] break-all text-zinc-500">{p.old ? `${p.old} → ${p.new}` : `new: ${p.new}`}</div>
              {p.restart && <div className="text-[11.5px] text-amber-600 dark:text-amber-400">Needs a restart</div>}
            </div>
            {p.security && <Badge tone="red">Security</Badge>}
          </li>
        ))}
      </ul>
    </>
  );
}
