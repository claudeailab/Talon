import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChevronDown, RefreshCw, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { ago, cx } from "../lib/format";
import { useAction } from "../lib/hooks";
import { restartNas } from "../components/restart";
import { Badge, Button, Callout, ConfirmDialog, Input, Progress, Segmented, Switch } from "../components/ui";
import { Row, RowBlock, Section } from "../components/rows";

type Pkg = { name: string; old: string; new: string; security: boolean; restart: boolean };
type OsInfo = {
  os: string;
  checked_at: number | null;
  error: string | null;
  packages: Pkg[];
  security: number;
  restart_needed: boolean;
  progress: { state: "idle" | "running" | "success" | "error"; phase?: string; package?: string; percent?: number; done?: number; total?: number; error?: string };
  auto: { mode: "off" | "security" | "all"; restart: boolean; restart_time: string };
  checking: { state: "idle" | "running" | "success" | "error"; percent?: number; text?: string; error?: string };
  last_install: { at: number; ok: boolean; count: number; error?: string } | null;
};

/** Settings → Update, the operating system rows: package updates without a terminal. */
export default function OsUpdateTab() {
  const q = useQuery({
    queryKey: ["os-update"],
    queryFn: () => api.get<OsInfo>("/os-update"),
    refetchInterval: (query) =>
      query.state.data?.progress.state === "running" || query.state.data?.checking.state === "running" ? 1000 : 30000,
  });
  const check = useAction(() => api.post<OsInfo>("/os-update/check"), { invalidate: ["os-update"] });
  const install = useAction(() => api.post<OsInfo>("/os-update/install"), { invalidate: ["os-update"], onSuccess: () => setConfirm(false) });
  const auto = useAction((body: Partial<OsInfo["auto"]>) => api.put<OsInfo>("/os-update/auto", body), { invalidate: ["os-update"], success: "Saved" });
  const reboot = useAction(() => restartNas(), { onSuccess: () => setRestart(false) });
  const [confirm, setConfirm] = useState(false);
  const [restart, setRestart] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [time, setTime] = useState("04:00");
  useEffect(() => {
    if (q.data) setTime(q.data.auto.restart_time);
  }, [q.data?.auto.restart_time]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!q.data) return null;
  const d = q.data;
  const running = d.progress.state === "running";
  const checking = d.checking.state === "running";
  const sec = d.packages.filter((p) => p.security);
  const other = d.packages.filter((p) => !p.security);
  const needsRestart = d.packages.some((p) => p.restart);
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

  const status = checking ? (
    <Badge tone="blue" dot>Checking</Badge>
  ) : running ? (
    <Badge tone="blue" dot>Installing</Badge>
  ) : d.packages.length ? (
    <Badge tone="amber" dot>
      {d.packages.length} update{d.packages.length === 1 ? "" : "s"}
      {d.security ? ` · ${d.security} security` : ""}
    </Badge>
  ) : (
    <Badge tone="green" dot>Up to date</Badge>
  );

  return (
    <>
      <Section
        title="Operating system"
        right={
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} disabled={running || checking} onClick={() => check.mutate()}>
            Check now
          </Button>
        }
      />
      <Row
        label={
          <span className="flex flex-wrap items-center gap-2">
            {d.os} {status}
          </span>
        }
        hint={
          d.packages.length && !running && !checking
            ? needsRestart
              ? "A restart is needed afterwards"
              : d.checked_at
                ? `Checked ${ago(d.checked_at)}`
                : undefined
            : d.last_install?.ok
              ? `Last updates installed ${ago(d.last_install.at)}`
              : d.checked_at
                ? `Checked ${ago(d.checked_at)}`
                : "Not checked yet"
        }
      >
        {d.packages.length > 0 && !running && !checking && (
          <Button size="sm" variant="primary" onClick={() => setConfirm(true)}>
            Install all
          </Button>
        )}
      </Row>
      {(checking || running) && (
        <RowBlock>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 break-words text-zinc-500">
              {checking
                ? d.checking.text
                : d.progress.phase === "download"
                  ? "Downloading"
                  : `Updating ${d.progress.package || "…"} · ${Math.min((d.progress.done ?? 0) + 1, d.progress.total ?? 1)} of ${d.progress.total}`}
            </span>
            <span className="tabular font-semibold text-zinc-500">{Math.round((checking ? d.checking.percent : d.progress.percent) ?? 0)}%</span>
          </div>
          <Progress value={(checking ? d.checking.percent : d.progress.percent) ?? 0} className="mt-2 h-2" />
          {running && <p className="mt-2 text-xs text-zinc-500">Shared folders keep working. You can leave this page; the installation continues.</p>}
        </RowBlock>
      )}
      {d.error && !checking && (
        <RowBlock>
          <Callout tone="warning" title="Could not check for updates">{d.error}</Callout>
        </RowBlock>
      )}
      {d.progress.state === "error" && !running && (
        <RowBlock>
          <Callout tone="danger" title="Installing the updates failed">{d.progress.error}</Callout>
        </RowBlock>
      )}
      {d.packages.length > 0 && !running && !checking && (
        <RowBlock>
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
        </RowBlock>
      )}
      {d.restart_needed && !running && (
        <Row className="bg-amber-50/60 dark:bg-amber-500/10" label="Restart to finish" hint="Some updates, such as a new Linux kernel, are only used after a restart">
          <Button size="sm" variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={() => setRestart(true)}>
            Restart now
          </Button>
        </Row>
      )}
      <Row
        label="Install automatically"
        hint={
          d.auto.mode === "off"
            ? "Nothing installs by itself; you are told about security updates"
            : `Every night, ${d.auto.mode === "all" ? "all updates" : "security updates"} install by themselves; you get an email (with SMTP set up)`
        }
      >
        <Segmented
          value={d.auto.mode}
          onChange={(v) => auto.mutate({ mode: v })}
          options={[
            { value: "off", label: "Off" },
            { value: "security", label: "Security" },
            { value: "all", label: "All" },
          ]}
        />
      </Row>
      <Row
        inline
        className={cx(d.auto.mode === "off" && "opacity-50")}
        label="Restart when needed"
        hint="Only if an update needs it; shared folders are unavailable for a minute or two"
      >
        {d.auto.restart && (
          <>
            <div className="w-20">
              <Input value={time} onChange={(e) => setTime(e.target.value)} aria-label="Restart time" placeholder="04:00" />
            </div>
            {time !== d.auto.restart_time && (
              <Button size="sm" disabled={!timeOk} onClick={() => auto.mutate({ restart_time: time })}>
                Save
              </Button>
            )}
            {!timeOk && <span className="text-xs text-rose-600">Use hh:mm, 24-hour</span>}
          </>
        )}
        <Switch checked={d.auto.restart} disabled={d.auto.mode === "off"} onChange={(v) => auto.mutate({ restart: v })} label="Restart when needed" />
      </Row>

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
    </>
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
