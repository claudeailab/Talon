import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Apple, BarChart3, Cloud, Copy, FolderSync, MemoryStick, ShieldCheck, Globe, Monitor, Network, RotateCw, Server, Settings2, Terminal } from "lucide-react";
import { api } from "../lib/api";
import { ago, bytes, date } from "../lib/format";
import { useAction } from "../lib/hooks";
import { navigate } from "../lib/router";
import type { Service } from "../lib/types";
import { Badge, Button, Card, Modal, PageHeader, PageLoader, StatusDot, Switch, useToast } from "../components/ui";

const ICONS: Record<string, React.ReactNode> = {
  smb: <Monitor className="size-5" />,
  netbios: <Globe className="size-5" />,
  nfs: <Server className="size-5" />,
  wsdd: <Network className="size-5" />,
  mdns: <Apple className="size-5" />,
  ssh: <Terminal className="size-5" />,
  onedrive: <Cloud className="size-5" />,
  webdav: <FolderSync className="size-5" />,
  antivirus: <ShieldCheck className="size-5" />,
  sdcard: <MemoryStick className="size-5" />,
};

export default function ServicesPage() {
  const { data } = useQuery({ queryKey: ["services"], queryFn: () => api.get<Service[]>("/services"), refetchInterval: 10000 });
  const act = useAction(({ id, action }: { id: string; action: string }) => api.post(`/services/${id}/${action}`), {
    success: (_r, v) => `Service ${v.action === "enable" ? "enabled" : v.action === "disable" ? "disabled" : "restarted"}`,
    invalidate: ["services", "onedrive", "antivirus"],
    onSuccess: (_r, v) => {
      if (v.id === "onedrive" && v.action === "enable") navigate("/onedrive"); // straight to setup
      if (v.id === "antivirus" && v.action === "enable") navigate("/antivirus"); // the installation's progress
    },
  });
  const toast = useToast();
  const [stats, setStats] = useState(false);
  const davUrl = `${location.origin}/dav/`;
  if (!data) return <PageLoader />;
  const groups: [string, Service[]][] = [
    ["Enabled", data.filter((x) => x.enabled)],
    ["Disabled", data.filter((x) => !x.enabled)],
  ];
  const card = (s: Service) => (
          <Card key={s.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300">{ICONS[s.id]}</div>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{s.label}</div>
                  <div className="flex items-center gap-1.5 text-xs whitespace-nowrap text-zinc-500">
                    <StatusDot tone={s.active ? "green" : "zinc"} pulse={s.active} />
                    {!s.installed ? "Not installed" : s.active ? "Running" : "Stopped"}
                  </div>
                </div>
              </div>
              <Switch
                checked={s.app ? s.enabled : s.enabled && s.active}
                disabled={!s.installed || act.isPending}
                label={`Enable ${s.label}`}
                onChange={(v) => act.mutate({ id: s.id, action: v ? "enable" : "disable" })}
              />
            </div>
            <p className="mt-3 text-[13px] text-zinc-500 dark:text-zinc-400">{s.description}</p>
            {s.id === "webdav" && s.enabled && (
              <p className="mt-1 font-mono text-[12.5px] break-all text-zinc-700 dark:text-zinc-300">{davUrl}</p>
            )}
            <div className="mt-4 flex items-center justify-between">
              {s.app ? (
                s.enabled ? <Badge tone="green">Enabled</Badge> : <Badge>Disabled</Badge>
              ) : s.enabled ? (
                <Badge tone="green">Starts at boot</Badge>
              ) : (
                <Badge>Disabled at boot</Badge>
              )}
              {s.id === "webdav" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Copy className="size-3.5" />}
                  disabled={!s.enabled}
                  onClick={() => navigator.clipboard?.writeText(davUrl).then(() => toast("success", "Address copied"), () => toast("error", "Copy failed"))}
                >
                  Copy address
                </Button>
              ) : s.id === "sdcard" ? (
                <Button size="sm" variant="ghost" icon={<BarChart3 className="size-3.5" />} onClick={() => setStats(true)}>
                  Statistics
                </Button>
              ) : s.app ? (
                <Button size="sm" variant="ghost" icon={<Settings2 className="size-3.5" />} disabled={!s.enabled} onClick={() => navigate(`/${s.id}`)}>
                  Configure
                </Button>
              ) : (
                <Button size="sm" variant="ghost" icon={<RotateCw className="size-3.5" />} disabled={!s.installed || !s.active} onClick={() => act.mutate({ id: s.id, action: "restart" })}>
                  Restart
                </Button>
              )}
            </div>
          </Card>
);
  return (
    <>
      <PageHeader title="Services" description="System services" />
      {stats && data.find((x) => x.id === "sdcard")?.writes && (
        <SdStatsModal w={data.find((x) => x.id === "sdcard")!.writes!} on={!!data.find((x) => x.id === "sdcard")?.active} onClose={() => setStats(false)} />
      )}
      {groups.map(([title, list]) =>
        list.length ? (
          <section key={title} className="mb-6">
            <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              {title} · {list.length}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{list.map(card)}</div>
          </section>
        ) : null,
      )}
    </>
  );
}

/** SD-card protection → Statistics: what is written to the system disk and what it would save, or what it saved. */
function SdStatsModal({ w, on, onClose }: { w: NonNullable<Service["writes"]>; on: boolean; onClose: () => void }) {
  const n = (x: number) => Math.round(x).toLocaleString();
  const m = w.measured;
  const explain = (
    <p className="mt-4 text-[13px] text-zinc-500">
      Keeps the system logs in memory and writes them to the {w.disk} once a day and when the NAS shuts down or restarts. After a power cut, up to a day of
      system logs can be lost; your files are not affected. Turning it on or off applies after the next restart.
    </p>
  );
  let subtitle = `Your ${w.disk}`;
  let body: React.ReactNode;
  if (on && w.saved) {
    subtitle = w.active_since ? `Running since ${date(w.active_since)}` : "Running";
    body = (
      <>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold whitespace-nowrap text-emerald-700 dark:text-emerald-400">{bytes(w.saved.bytes)}</span>
          <span className="text-[13px] text-zinc-500">not written in the last {w.saved.days >= 7 ? "7 days" : `${w.saved.days} days`}</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Tile k="Writes avoided" v={n(w.saved.ops)} />
          <Tile k="Logs in memory" v={`${w.used_mb ?? "?"} of ${w.size_mb} MB`} />
          <Tile k={`Written to the ${w.disk}`} v={w.synced_at ? ago(w.synced_at) : "not yet"} />
        </div>
        <p className="mt-4 text-[13px] text-zinc-500">Saved is based on what the logs wrote per day before it was turned on ({bytes(w.saved.per_day_bytes)}).</p>
      </>
    );
  } else if (on) {
    subtitle = w.active_since ? `Running since ${date(w.active_since)}` : "Running";
    body = (
      <>
        <div className="grid grid-cols-2 gap-2">
          <Tile k="Logs in memory" v={`${w.used_mb ?? "?"} of ${w.size_mb} MB`} />
          <Tile k={`Written to the ${w.disk}`} v={w.synced_at ? ago(w.synced_at) : "not yet"} />
        </div>
        <p className="mt-4 text-[13px] text-zinc-500">How much it saves is measured before it is turned on; it was turned on before Talon had measured that.</p>
      </>
    );
  } else if (!m || m.disk_bytes == null) {
    body = <p className="text-[13px] text-zinc-600 dark:text-zinc-400">Still measuring what is written to the {w.disk}; the result appears after a few hours.</p>;
  } else {
    const share = m.disk_bytes ? Math.round((m.log_bytes! / m.disk_bytes) * 100) : 0;
    subtitle = `Your ${w.disk}, ${m.hours >= 168 ? "the last 7 days" : `the last ${Math.round(m.hours)} hours`}`;
    body = (
      <>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold whitespace-nowrap">{bytes(m.disk_bytes)}</span>
          <span className="text-[13px] text-zinc-500">written a day · {n(m.disk_ops!)} writes</span>
        </div>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
          <div className="bg-amber-500" style={{ width: `${share}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-zinc-600 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-500" /> System logs {bytes(m.log_bytes)} ({share}%)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-zinc-300 dark:bg-white/20" /> Everything else {bytes(m.disk_bytes - m.log_bytes!)}
          </span>
        </div>
        {m.log_bytes! > 0 && (
          <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            Turning it on would save about {bytes(m.log_bytes)} and {n(m.log_ops!)} writes a day.
          </div>
        )}
      </>
    );
  }
  return (
    <Modal open onClose={onClose} title="SD-card protection" description={subtitle}>
      {w.restart_needed && <p className="mb-3 text-[13px] font-medium text-amber-700 dark:text-amber-400">Applies after the next restart of the NAS.</p>}
      {w.recommended && <p className="mb-3 text-[13px] font-medium text-zinc-700 dark:text-zinc-300">{w.recommended}.</p>}
      {body}
      {explain}
    </Modal>
  );
}

function Tile({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-white/[0.04]">
      <div className="text-xs text-zinc-500">{k}</div>
      <div className="text-[13.5px] font-semibold break-words">{v}</div>
    </div>
  );
}
