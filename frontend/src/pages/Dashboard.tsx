import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Database,
  FolderOpen,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  Server,
  Thermometer,
  Users,
} from "lucide-react";
import { api } from "../lib/api";
import { bytes, cx, duration, levelLabel, pct, rate } from "../lib/format";
import { Link } from "../lib/router";
import type { Dashboard, Point } from "../lib/types";
import { AreaChart, Ring } from "../components/charts";
import { Badge, Card, CardHeader, PageLoader, Progress, StatusDot, usageTone } from "../components/ui";
import { DiskIcon, HealthBadge } from "../components/disk";
import { VolumeStatusBadge } from "./Volumes";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/dashboard"), refetchInterval: 10000 });
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api.get<{ history: Point[] }>("/stats"), refetchInterval: 2000 });
  if (!data) return <PageLoader />;
  const hist = stats.data?.history ?? data.history;
  const last = hist[hist.length - 1];
  const totalSize = data.volumes.reduce((a, v) => a + v.size, 0);
  const totalUsed = data.volumes.reduce((a, v) => a + v.used, 0);
  const critical = data.alerts.filter((a) => a.level === "critical").length;

  return (
    <div className="space-y-6">
      {/* hero */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{greeting()}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{data.info.hostname}</h1>
        </div>
        <div
          className={cx(
            "inline-flex items-center gap-2 self-start rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 ring-inset sm:self-auto",
            data.alerts.length === 0
              ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20"
              : critical
                ? "bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-400/20"
                : "bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20",
          )}
        >
          {data.alerts.length === 0 ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
          {data.alerts.length === 0 ? "All systems healthy" : `${data.alerts.length} issue${data.alerts.length > 1 ? "s" : ""} need attention`}
        </div>
      </div>

      {/* alerts */}
      {data.alerts.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.alerts.map((a, i) => (
            <Link
              key={i}
              to={a.link}
              className={cx(
                "flex items-start gap-3 rounded-2xl p-4 ring-1 transition ring-inset hover:shadow-sm",
                a.level === "critical"
                  ? "bg-rose-50 ring-rose-200 dark:bg-rose-500/10 dark:ring-rose-400/20"
                  : "bg-amber-50 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-400/20",
              )}
            >
              <AlertTriangle className={cx("mt-0.5 size-5 shrink-0", a.level === "critical" ? "text-rose-500" : "text-amber-500")} />
              <div>
                <div className="text-sm font-semibold">{a.title}</div>
                <div className="text-[13px] text-zinc-600 dark:text-zinc-400">{a.detail}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* live metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Cpu className="size-4" />}
          label="CPU"
          value={last ? `${last.cpu.toFixed(0)}%` : "—"}
          sub={last ? `Load ${last.load.map((l) => l.toFixed(2)).join(" · ")}` : `${data.info.cores} cores`}
          ring={last?.cpu ?? 0}
          chart={<AreaChart series={[{ values: hist.map((h) => h.cpu), color: "#6366f1" }]} max={100} height={52} />}
        />
        <MetricCard
          icon={<MemoryStick className="size-4" />}
          label="Memory"
          value={last ? `${pct(last.mem_used, last.mem_total).toFixed(0)}%` : "—"}
          sub={last ? `${bytes(last.mem_used)} of ${bytes(last.mem_total)}` : ""}
          ring={last ? pct(last.mem_used, last.mem_total) : 0}
          chart={<AreaChart series={[{ values: hist.map((h) => pct(h.mem_used, h.mem_total)), color: "#a855f7" }]} max={100} height={52} />}
        />
        <Card className="p-5">
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
              <div className="tabular text-lg font-semibold">{rate(last?.rx)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-xs text-zinc-500">
                <ArrowUpRight className="size-3.5 text-emerald-500" /> Out
              </div>
              <div className="tabular text-lg font-semibold">{rate(last?.tx)}</div>
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
        <Card className="p-5">
          <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
            <Gauge className="size-4" /> Disk activity
          </div>
          <div className="mt-3 flex gap-6">
            <div>
              <div className="text-xs text-zinc-500">Read</div>
              <div className="tabular text-lg font-semibold">{rate(last?.read)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Write</div>
              <div className="tabular text-lg font-semibold">{rate(last?.write)}</div>
            </div>
            {last?.temp != null && (
              <div className="ml-auto text-right">
                <div className="flex items-center justify-end gap-1 text-xs text-zinc-500">
                  <Thermometer className="size-3.5" /> CPU
                </div>
                <div className="tabular text-lg font-semibold">{last.temp.toFixed(0)}°C</div>
              </div>
            )}
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
              <Link to="/storage" className="text-[13px] font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
                Manage
              </Link>
            }
          />
          <div className="px-5 pb-5">
            {data.volumes.length === 0 ? (
              <Link
                to="/storage"
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-200 py-10 text-sm font-medium text-zinc-500 hover:border-brand-300 hover:text-brand-600 dark:border-white/10"
              >
                <Database className="size-4" /> Create your first volume
              </Link>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {data.volumes.map((v) => {
                  const p = pct(v.used, v.size);
                  return (
                    <Link
                      key={v.name}
                      to="/storage"
                      className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/60 transition hover:ring-brand-300 dark:bg-white/[0.03] dark:ring-white/5 dark:hover:ring-brand-400/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-semibold">{v.name}</span>
                          <Badge>{levelLabel[v.level] ?? v.level}</Badge>
                        </div>
                        <VolumeStatusBadge v={v} />
                      </div>
                      <div className="mt-3 flex items-baseline justify-between text-[13px]">
                        <span className="tabular font-medium">{p.toFixed(0)}% used</span>
                        <span className="tabular text-zinc-500">{bytes(v.free)} free</span>
                      </div>
                      <Progress value={p} tone={usageTone(p)} className="mt-1.5" />
                      {v.array?.sync_progress != null && (
                        <div className="mt-2 text-xs text-zinc-500">{v.status_detail}</div>
                      )}
                    </Link>
                  );
                })}
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
                <dd className="truncate text-right font-medium">{v}</dd>
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

      <div className="grid gap-4 xl:grid-cols-3">
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
                  <div className="truncate text-xs text-zinc-500">{d.model}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <HealthBadge health={d.health} />
                    {d.temperature != null && <span className="tabular text-xs text-zinc-500">{d.temperature}°C</span>}
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
            actions={
              <Link to="/services" className="text-[13px] font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
                Manage
              </Link>
            }
          />
          <ul className="divide-y divide-zinc-100 px-5 pb-3 dark:divide-white/5">
            {data.services.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2.5 text-[13px]">
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

function MetricCard({
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
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
            {icon} {label}
          </div>
          <div className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</div>
          <div className="tabular mt-0.5 truncate text-xs text-zinc-500">{sub}</div>
        </div>
        <Ring value={ring} size={52} stroke={6} />
      </div>
      <div className="mt-3">{chart}</div>
    </Card>
  );
}
