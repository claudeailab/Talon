import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  Cpu,
  Database,
  FolderOpen,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  Server,
  Users,
} from "lucide-react";
import { api } from "../lib/api";
import { bytes, cx, duration, levelLabel, pct, rate } from "../lib/format";
import { Link } from "../lib/router";
import type { Dashboard, Point } from "../lib/types";
import { AreaChart, Ring } from "../components/charts";
import { Badge, Card, CardHeader, PageLoader, Progress, StatusDot, usageTone } from "../components/ui";
import { DiskIcon, DiskStatusBadge, HealthBadge } from "../components/disk";
import { VolumeStatusBadge } from "./Volumes";
import { StatusBadge } from "../components/storage";
import { HistoryModal, type HistoryMetric } from "../components/history";

export default function DashboardPage() {
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/dashboard"), refetchInterval: 10000 });
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api.get<{ history: Point[] }>("/stats"), refetchInterval: 2000 });
  const [histView, setHist] = useState<HistoryMetric | null>(null);
  if (!data) return <PageLoader />;
  const hist = stats.data?.history ?? data.history;
  const last = hist[hist.length - 1];
  const totalSize = data.volumes.reduce((a, v) => a + v.size, 0);
  const totalUsed = data.volumes.reduce((a, v) => a + v.used, 0);

  return (
    <div className="space-y-5">
      {histView && <HistoryModal metric={histView} onClose={() => setHist(null)} />}
      <h1 className="sr-only">Dashboard</h1>
      {/* live metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          onClick={() => setHist("cpu")}
          icon={<Cpu className="size-4" />}
          label="CPU"
          value={last ? `${last.cpu.toFixed(0)}%` : "—"}
          sub={last ? `Load ${last.load.map((l) => l.toFixed(2)).join(" · ")}${last.temp != null ? ` · ${last.temp.toFixed(0)}°C` : ""}` : `${data.info.cores} cores`}
          ring={last?.cpu ?? 0}
          chart={<AreaChart series={[{ values: hist.map((h) => h.cpu), color: "#6366f1" }]} max={100} height={52} />}
        />
        <MetricCard
          onClick={() => setHist("mem")}
          icon={<MemoryStick className="size-4" />}
          label="Memory"
          value={last ? `${pct(last.mem_used, last.mem_total).toFixed(0)}%` : "—"}
          sub={last ? `${bytes(last.mem_used)} of ${bytes(last.mem_total)}` : ""}
          ring={last ? pct(last.mem_used, last.mem_total) : 0}
          chart={<AreaChart series={[{ values: hist.map((h) => pct(h.mem_used, h.mem_total)), color: "#a855f7" }]} max={100} height={52} />}
        />
        <Card className={TAPPABLE} onClick={() => setHist("net")} {...tap("Network history")}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
              <Network className="size-4" /> Network
            </div>
          </div>
          <div className="mt-3 flex gap-6">
            <div>
              <div className="flex items-center gap-1 text-xs text-zinc-500">
                <ArrowDownRight className="size-3.5 text-sky-500" /> In
              </div>
              <div className="tabular text-lg font-semibold whitespace-nowrap">{rate(last?.rx)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-xs text-zinc-500">
                <ArrowUpRight className="size-3.5 text-emerald-500" /> Out
              </div>
              <div className="tabular text-lg font-semibold whitespace-nowrap">{rate(last?.tx)}</div>
            </div>
          </div>
          <div className="mt-3">
            <AreaChart
              height={52}
              series={[
                { values: hist.map((h) => h.rx), color: "#0ea5e9" },
                { values: hist.map((h) => h.tx), color: "#10b981" },
              ]}
            />
          </div>
        </Card>
        <Card className={TAPPABLE} onClick={() => setHist("disk")} {...tap("Disk activity history")}>
          <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
            <Gauge className="size-4" /> Disk activity
          </div>
          <div className="mt-3 flex gap-6">
            <div>
              <div className="text-xs text-zinc-500">Read</div>
              <div className="tabular text-lg font-semibold whitespace-nowrap">{rate(last?.read)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Write</div>
              <div className="tabular text-lg font-semibold whitespace-nowrap">{rate(last?.write)}</div>
            </div>
          </div>
          <div className="mt-3">
            <AreaChart
              height={52}
              series={[
                { values: hist.map((h) => h.read), color: "#f59e0b" },
                { values: hist.map((h) => h.write), color: "#ec4899" },
              ]}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* storage */}
        <Card className="xl:col-span-2">
          <CardHeader
            icon={<Database className="size-4.5" />}
            title="Storage"
            subtitle={totalSize ? `${bytes(totalUsed)} used of ${bytes(totalSize)}` : "No volumes yet"}
            actions={
              <div className="flex items-center gap-4">
                {data.volumes.length > 0 && (
                  <button type="button" onClick={() => setHist("storage")} className="text-[13px] font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
                    History
                  </button>
                )}
                <Link to="/volumes" className="text-[13px] font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
                  Manage
                </Link>
              </div>
            }
          />
          <div className="px-5 pb-5">
            {data.volumes.length === 0 ? (
              <Link
                to="/volumes"
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-200 py-10 text-sm font-medium text-zinc-500 hover:border-brand-300 hover:text-brand-600 dark:border-white/10"
              >
                <Database className="size-4" /> Create your first volume
              </Link>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {data.volumes.map((v) => {
                  const p = pct(v.used, v.size);
                  return (
                    <Tile key={"v" + v.name} to="/volumes">
                      <TileHead name={v.name} badge={levelLabel[v.level] ?? v.level} status={<VolumeStatusBadge v={v} />} />
                      <TileLine left={`${p.toFixed(0)}% used`} right={`${bytes(v.free)} free`} />
                      <Progress value={p} tone={usageTone(p)} className="mt-1.5" />
                      {v.sync?.sync_progress != null && <div className="mt-2 [overflow-wrap:anywhere] text-xs text-zinc-500">{v.status_detail}</div>}
                    </Tile>
                  );
                })}
                {data.arrays.map((a) => {
                  const active = a.members.filter((m) => m.state !== "spare");
                  const sync = a.sync && a.sync.sync_action !== "idle" && a.sync.sync_progress != null ? a.sync : null;
                  return (
                    <Tile key={"a" + a.name} to="/raid">
                      <TileHead name={a.name} badge="RAID array" status={<StatusBadge status={a.status} />} />
                      <TileLine
                        left={a.fault_tolerance ? `Survives ${a.fault_tolerance} disk failure${a.fault_tolerance > 1 ? "s" : ""}` : "No disk failure protection"}
                        right={bytes(a.size)}
                      />
                      {sync ? (
                        <Progress value={sync.sync_progress ?? 0} tone="blue" className="mt-1.5" />
                      ) : (
                        <Chips items={active.map((m) => ({ key: m.disk, label: m.disk, bad: m.state === "faulty", mono: true }))} />
                      )}
                    </Tile>
                  );
                })}
                {data.onedrive && (
                  <Tile to="/onedrive">
                    <TileHead
                      name="OneDrive"
                      badge={`${data.onedrive.tasks} task${data.onedrive.tasks === 1 ? "" : "s"}`}
                      status={
                        !data.onedrive.connected ? (
                          <Badge tone="amber" dot>Not connected</Badge>
                        ) : data.onedrive.running ? (
                          <Badge tone="blue" dot>Syncing</Badge>
                        ) : data.onedrive.errors ? (
                          <Badge tone="red" dot>{data.onedrive.errors} failed</Badge>
                        ) : (
                          <Badge tone="green" dot>Connected</Badge>
                        )
                      }
                    />
                    <TileLine
                      left={data.onedrive.email ?? "Sign in to Microsoft"}
                      right={data.onedrive.total ? `${bytes(data.onedrive.used ?? 0)} of ${bytes(data.onedrive.total)}` : ""}
                    />
                    {data.onedrive.total ? (
                      <Progress value={pct(data.onedrive.used ?? 0, data.onedrive.total)} tone="blue" className="mt-1.5" />
                    ) : null}
                  </Tile>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* system */}
        <Card>
          <CardHeader icon={<Server className="size-4.5" />} title="System" subtitle={data.info.model} />
          <dl className="space-y-2.5 px-5 pb-5 text-[13px]">
            {[
              ["OS", data.info.os],
              ["Kernel", data.info.kernel],
              ["CPU", `${data.info.cpu} · ${data.info.cores} cores`],
              ["Memory", bytes(data.info.memory)],
              ["Uptime", duration(Date.now() / 1000 - data.info.boot_time)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="[overflow-wrap:anywhere] text-right font-medium">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Address</dt>
              <dd className="space-y-0.5 text-right font-mono text-[12px]">
                {data.info.addresses
                  .filter((a) => a.family === 4)
                  .map((a) => (
                    <div key={a.iface + a.address}>
                      {a.address} <span className="text-zinc-400">({a.iface})</span>
                    </div>
                  ))}
              </dd>
            </div>
          </dl>
          <div className="grid grid-cols-2 border-t border-zinc-100 dark:border-white/5">
            <Link to="/shares" className="flex items-center gap-3 p-4 transition hover:bg-zinc-50 dark:hover:bg-white/[0.02]">
              <FolderOpen className="size-5 text-brand-500" />
              <div>
                <div className="text-lg leading-none font-semibold">{data.shares}</div>
                <div className="text-xs text-zinc-500">Shares</div>
              </div>
            </Link>
            <Link to="/users" className="flex items-center gap-3 border-l border-zinc-100 p-4 transition hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-white/[0.02]">
              <Users className="size-5 text-violet-500" />
              <div>
                <div className="text-lg leading-none font-semibold">{data.users}</div>
                <div className="text-xs text-zinc-500">Users</div>
              </div>
            </Link>
          </div>
        </Card>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            icon={<HardDrive className="size-4.5" />}
            title="Disks"
            subtitle={`${data.disks.length} detected`}
            actions={
              <Link to="/disks" className="text-[13px] font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
                Details
              </Link>
            }
          />
          <div className="grid gap-2.5 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.disks.map((d) => (
              <div key={d.name} className="flex items-center gap-3 rounded-xl p-3 ring-1 ring-zinc-200/70 dark:ring-white/5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
                  <DiskIcon kind={d.kind} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[13px] font-semibold">{d.name}</span>
                    <span className="tabular text-xs text-zinc-500">{bytes(d.size, 0)}</span>
                  </div>
                  <div className="[overflow-wrap:anywhere] text-xs text-zinc-500">{d.model}</div>
                  <div className="mt-1 flex items-center gap-2">
                    {/* without SMART (e.g. virtual disks) show what the disk is used for */}
                    {d.health === "unknown" ? <DiskStatusBadge d={d} /> : <HealthBadge health={d.health} />}
                    {d.temperature ? <span className="tabular text-xs text-zinc-500">{d.temperature}°C</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader
            icon={<Server className="size-4.5" />}
            title="Services"
            subtitle={`${data.services.filter((s) => s.active).length} of ${data.services.length} running`}
            actions={
              <Link to="/services" className="text-[13px] font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
                Manage
              </Link>
            }
          />
          <ul className="divide-y divide-zinc-100 px-5 pb-2 dark:divide-white/5">
            {data.services.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
                <span className="font-medium">{s.label}</span>
                <span className="flex items-center gap-2 text-zinc-500">
                  <StatusDot tone={!s.installed ? "zinc" : s.active ? "green" : "zinc"} />
                  {!s.installed ? "Not installed" : s.active ? "Running" : "Stopped"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Tile({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="min-w-0 rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/60 transition hover:ring-brand-300 dark:bg-white/[0.03] dark:ring-white/5 dark:hover:ring-brand-400/40"
    >
      {children}
    </Link>
  );
}

function TileHead({ name, badge, status }: { name: string; badge: string; status?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="[overflow-wrap:anywhere] font-semibold">{name}</span>
        <Badge>{badge}</Badge>
      </div>
      {status}
    </div>
  );
}

function TileLine({ left, right }: { left: string; right: string }) {
  return (
    <div className="mt-3 flex items-baseline justify-between gap-3 text-[13px]">
      <span className="tabular [overflow-wrap:anywhere] font-medium">{left}</span>
      <span className="tabular shrink-0 text-zinc-500">{right}</span>
    </div>
  );
}

function Chips({ items }: { items: { key: string; label: string; bad?: boolean; mono?: boolean }[] }) {
  return (
    <div className="mt-1.5 flex h-5 flex-wrap gap-1.5 overflow-hidden">
      {items.map((i) => (
        <span
          key={i.key}
          className={cx(
            "max-w-40 [overflow-wrap:anywhere] rounded-md px-1.5 text-[11px] leading-5 ring-1 ring-inset",
            i.mono && "font-mono",
            i.bad
              ? "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-400/20"
              : "bg-white text-zinc-600 ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10",
          )}
        >
          {i.label}
        </span>
      ))}
    </div>
  );
}

const TAPPABLE = "cursor-pointer p-5 transition hover:ring-brand-300 dark:hover:ring-brand-400/40";
const tap = (label: string) => ({
  role: "button",
  tabIndex: 0,
  "aria-label": label,
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (e.currentTarget as HTMLElement).click();
    }
  },
});

function MetricCard({
  onClick,
  icon,
  label,
  value,
  sub,
  ring,
  chart,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  ring: number;
  chart: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Card className={TAPPABLE} onClick={onClick} {...tap(`${label} history`)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
            {icon} {label}
          </div>
          <div className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</div>
          <div className="tabular mt-0.5 [overflow-wrap:anywhere] text-xs text-zinc-500">{sub}</div>
        </div>
        <Ring value={ring} size={52} stroke={6} />
      </div>
      <div className="mt-3">{chart}</div>
    </Card>
  );
}
