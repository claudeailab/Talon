import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Activity, Check, CheckCircle2, Eraser, HardDrive, Loader2, MoreHorizontal, Thermometer } from "lucide-react";
import { api } from "../lib/api";
import { bytes, cx } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Disk, Job } from "../lib/types";
import { DiskIcon, DiskStatusBadge, HealthBadge, kindLabel } from "../components/disk";
import { Badge, Button, Callout, Card, Empty, IconButton, Menu, MenuItem, Modal, PageHeader, PageLoader, Progress, Spinner } from "../components/ui";

interface Smart {
  available: boolean;
  passed: boolean | null;
  temperature: number | null;
  temp_limit?: number;
  power_on_hours: number | null;
  power_cycles: number | null;
  bad_sectors: number | null;
  percentage_used: number | null;
  firmware: string | null;
  rpm: number | null;
  attributes: { id: number; name: string; value: number; worst: number; thresh: number; raw: string; failing: boolean }[];
  self_tests: { type: string; status: string; hours: number }[];
  messages: string[];
}

const hot = (d: { temperature: number | null; temp_limit?: number }) => d.temperature != null && d.temp_limit != null && d.temperature >= d.temp_limit;

/** Phones: the disk temperature as a chip, amber at the "Disk too hot" alert threshold. */
function TempBadge({ d }: { d: { temperature: number | null; temp_limit?: number } }) {
  if (d.temperature == null) return null;
  return (
    <Badge tone={hot(d) ? "amber" : undefined}>
      <Thermometer className="size-3" />
      {d.temperature}°C
    </Badge>
  );
}

export default function DisksPage() {
  const { data } = useQuery({ queryKey: ["disks"], queryFn: () => api.get<Disk[]>("/disks"), refetchInterval: 15000 });
  const [smart, setSmart] = useState<Disk | null>(null);
  const [wipe, setWipe] = useState<Disk | null>(null);
  if (!data) return <PageLoader />;

  return (
    <>
      <PageHeader title="Disks" description="Physical disks and their health" />
      <Card className="overflow-hidden">
        {data.length === 0 ? (
          <Empty icon={<HardDrive className="size-6" />} title="No disks detected" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-500 dark:border-white/5">
                  <th className="px-4 py-3 sm:px-5">Disk</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Capacity</th>
                  <th className="hidden px-3 py-3 md:table-cell">Type</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Health</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Temp</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Usage</th>
                  <th className="w-12 px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                {data.map((d) => (
                  <tr key={d.name} className="transition hover:bg-zinc-50/70 dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-3.5 sm:px-5">
                      <div className="flex items-center gap-3">
                        <div className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 sm:flex dark:bg-white/5 dark:text-zinc-400">
                          <DiskIcon kind={d.kind} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-mono text-[13px] font-semibold">
                            {d.name}
                            <span className="ml-1.5 font-sans font-medium text-zinc-500 sm:hidden">{bytes(d.size)}</span>
                          </div>
                          <div className="text-xs break-words text-zinc-500 sm:max-w-[16rem]">{d.model}</div>
                          {d.serial && <div className="hidden font-mono text-[11px] text-zinc-400 sm:block">{d.serial}</div>}
                          {/* phones: health and usage under the name, so the model has the full width */}
                          <div className="mt-1 flex flex-wrap gap-1.5 sm:hidden">
                            <HealthBadge health={d.health} />
                            <TempBadge d={d} />
                            <DiskStatusBadge d={d} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="tabular hidden px-3 py-3.5 font-medium sm:table-cell">{bytes(d.size)}</td>
                    <td className="hidden px-3 py-3.5 md:table-cell">
                      <Badge>{kindLabel[d.kind]}</Badge>
                    </td>
                    <td className="hidden px-3 py-3.5 sm:table-cell">
                      <HealthBadge health={d.health} />
                    </td>
                    <td className="tabular hidden px-3 py-3.5 sm:table-cell">
                      {d.temperature != null ? (
                        <span className={hot(d) ? "font-medium text-amber-600 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-400"}>{d.temperature}°C</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="hidden px-3 py-3.5 sm:table-cell">
                      <div className="flex flex-col items-start gap-0.5">
                        <DiskStatusBadge d={d} />
                        <span className="hidden max-w-[16rem] text-xs break-words text-zinc-500 sm:block">{d.status_detail}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <Menu
                        trigger={
                          <IconButton label="Disk actions">
                            <MoreHorizontal className="size-5" />
                          </IconButton>
                        }
                      >
                        <MenuItem icon={<Activity />} onClick={() => setSmart(d)}>
                          S.M.A.R.T. details
                        </MenuItem>
                        <MenuItem icon={<Eraser />} danger disabled={!d.selectable} onClick={() => setWipe(d)}>
                          Wipe disk
                        </MenuItem>
                      </Menu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {smart && <SmartDialog disk={smart} onClose={() => setSmart(null)} />}
      {wipe && <WipeDialog disk={wipe} disks={data} onClose={() => setWipe(null)} />}
    </>
  );
}

function SmartDialog({ disk, onClose }: { disk: Disk; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["smart", disk.name], queryFn: () => api.get<Smart>(`/disks/${disk.name}/smart`) });
  const test = useAction((kind: string) => api.post(`/disks/${disk.name}/smart-test`, { kind }), {
    success: (_r, k) => `${k === "short" ? "Short" : "Extended"} self-test started. Results appear here when finished.`,
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`${disk.name} — ${disk.model}`}
      description={`${bytes(disk.size)} ${kindLabel[disk.kind]}${disk.serial ? ` · S/N ${disk.serial}` : ""}`}
      footer={
        <>
          <Button onClick={() => test.mutate("short")} loading={test.isPending && test.variables === "short"}>
            Run short test
          </Button>
          <Button onClick={() => test.mutate("long")} loading={test.isPending && test.variables === "long"}>
            Run extended test
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {isLoading || !data ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !data.available && data.passed == null ? (
        <p className="text-sm text-zinc-500">
          S.M.A.R.T. data is not available for this disk (common with SD cards and some USB adapters).
          {data.messages.length > 0 && <span className="mt-2 block font-mono text-xs">{data.messages.join(" ")}</span>}
        </p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Overall", data.passed == null ? "Unknown" : data.passed ? "Passed" : "FAILED"],
              ["Temperature", data.temperature != null ? `${data.temperature}°C` : "—"],
              ["Powered on", data.power_on_hours != null ? `${data.power_on_hours.toLocaleString()} h` : "—"],
              data.percentage_used != null
                ? ["Wear", `${data.percentage_used}%`]
                : ["Bad sectors", data.bad_sectors != null ? String(data.bad_sectors) : "—"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-zinc-50 p-3.5 dark:bg-white/[0.03]">
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  {k === "Temperature" && <Thermometer className="size-3.5" />}
                  {k}
                </div>
                <div className={`tabular mt-1 text-lg font-semibold ${v === "FAILED" ? "text-rose-600" : v === "Passed" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                  {v}
                </div>
              </div>
            ))}
          </div>
          {data.attributes.length > 0 && (
            <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-200 dark:ring-white/10">
              <table className="w-full text-[13px]">
                <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-white/[0.03]">
                  <tr>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">Attribute</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-3 py-2 text-right">Worst</th>
                    <th className="px-3 py-2 text-right">Threshold</th>
                    <th className="px-3 py-2 text-right">Raw</th>
                  </tr>
                </thead>
                <tbody className="tabular divide-y divide-zinc-100 dark:divide-white/5">
                  {data.attributes.map((a) => (
                    <tr key={a.id} className={a.failing ? "bg-rose-50 dark:bg-rose-500/10" : ""}>
                      <td className="px-3 py-1.5 text-zinc-500">{a.id}</td>
                      <td className="px-3 py-1.5 font-medium">{a.name.replace(/_/g, " ")}</td>
                      <td className="px-3 py-1.5 text-right">{a.value}</td>
                      <td className="px-3 py-1.5 text-right">{a.worst}</td>
                      <td className="px-3 py-1.5 text-right">{a.thresh}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{a.raw}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.self_tests.length > 0 && (
            <div>
              <div className="mb-2 text-[13px] font-semibold">Self-test log</div>
              <ul className="space-y-1 text-[13px]">
                {data.self_tests.map((t, i) => (
                  <li key={i} className="flex justify-between gap-4 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-white/[0.03]">
                    <span>{t.type}</span>
                    <span className="text-zinc-500">
                      {t.status} · {t.hours} h
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Wiping one disk of an old RAID stops that whole array first. */
const WIPE_STEPS = ["Stopping anything that uses the disk", "Removing RAID and filesystem signatures", "Reading the empty disk again"];

/** Wipe a disk in one window: confirm, the steps as they run, then done (no terminal). */
function WipeDialog({ disk, disks, onClose }: { disk: Disk; disks: Disk[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [sure, setSure] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const start = useAction(() => api.post<Job>(`/disks/${disk.name}/wipe`), { onSuccess: (j) => setJobId(j.id) });
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<Job>(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && ["success", "error"].includes(q.state.data.status) ? false : 500),
  });
  const j = job.data;
  const finished = j && (j.status === "success" || j.status === "error");
  useEffect(() => {
    if (finished) qc.invalidateQueries({ queryKey: ["disks"] });
  }, [finished, qc]);
  const lines = j?.log ?? [];
  const step = Math.max(0, ...lines.map((l) => Number(/^STEP (\d)$/.exec(l)?.[1] ?? 0)));
  const what = `${disk.model} · ${bytes(disk.size)} · ${kindLabel[disk.kind] ?? disk.kind}`;

  if (j?.status === "success")
    return (
      <Modal open onClose={onClose} title="" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <div className="flex flex-col items-center py-2 text-center">
          <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15">
            <CheckCircle2 className="size-7" />
          </div>
          <div className="text-lg font-semibold">{disk.name} is empty</div>
          <p className="mt-1 text-[13px] text-zinc-500">It can now be used for a volume, a RAID array or backups.</p>
        </div>
      </Modal>
    );
  if (jobId)
    return (
      <Modal
        open
        onClose={finished ? onClose : () => {}}
        title={j?.status === "error" ? `Could not wipe ${disk.name}` : `Wiping ${disk.name}`}
        description={what}
        footer={
          <Button disabled={!finished} onClick={onClose}>
            Close
          </Button>
        }
      >
        {j?.status === "error" && <Callout tone="danger">{j.error}</Callout>}
        <ol className="mt-1 space-y-2.5">
          {WIPE_STEPS.map((label, i) => {
            const n = i + 1;
            const failed = j?.status === "error" && n === Math.max(1, step);
            const done = !failed && n < step;
            const active = !failed && n === Math.max(1, step) && j?.status !== "error";
            return (
              <li key={label} className="flex items-center gap-3 text-[13.5px]">
                <span
                  className={cx(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    done && "bg-emerald-500 text-white",
                    active && "bg-brand-600 text-white",
                    failed && "bg-rose-500 text-white",
                    !done && !active && !failed && "bg-zinc-100 text-zinc-400 dark:bg-white/5",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} /> : active ? <Loader2 className="size-3.5 animate-spin" /> : failed ? "!" : n}
                </span>
                <span className={cx(active ? "font-semibold" : done ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400")}>{label}</span>
              </li>
            );
          })}
        </ol>
        {j?.status !== "error" && <Progress value={(Math.max(0, step - 1) / WIPE_STEPS.length) * 100 + 100 / WIPE_STEPS.length / 2} className="mt-4 h-2" />}
        <div className="mt-3 text-xs text-zinc-500">
          {j?.status !== "error" && "Takes a few seconds. "}
          <button type="button" className="underline" onClick={() => setDetails(!details)}>
            Details
          </button>
        </div>
        {details && (
          <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-zinc-100 p-3 font-mono text-[11px] whitespace-pre-wrap text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
            {lines.filter((l) => !/^STEP \d$/.test(l)).join("\n")}
          </pre>
        )}
      </Modal>
    );
  return (
    <Modal
      open
      onClose={onClose}
      title={`Wipe ${disk.name}?`}
      description="Everything on the disk is erased"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!sure} loading={start.isPending} onClick={() => start.mutate()}>
            Wipe disk
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3 rounded-2xl bg-zinc-50 p-3 dark:bg-white/[0.03]">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-zinc-200 dark:bg-white/5 dark:ring-white/10">
          <DiskIcon kind={disk.kind} />
        </div>
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold break-words">{disk.model}</div>
          <div className="text-xs text-zinc-500">
            {disk.name} · {bytes(disk.size)} · {kindLabel[disk.kind] ?? disk.kind}
          </div>
        </div>
      </div>
      {disk.status !== "available" && (
        <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2.5 text-[13px] text-rose-800 dark:bg-rose-500/10 dark:text-rose-300">
          <b>On it now:</b> {disk.status_detail.replace(/; erased when you use the disk$/, "")}. It cannot be recovered after wiping.
          {disk.status === "raid_member" && <OldRaidNote disk={disk} disks={disks} />}
        </div>
      )}
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px]">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-rose-600" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        <span>
          I understand that everything on <b>{disk.name}</b> is erased
        </span>
      </label>
    </Modal>
  );
}

function OldRaidNote({ disk, disks }: { disk: Disk; disks: Disk[] }) {
  const md = disk.md ?? [];
  const others = disks.filter((d) => d.name !== disk.name && d.md?.some((m) => md.includes(m))).map((d) => d.name);
  return (
    <>
      {" "}
      The old RAID <b>{md.join(", ")}</b> is stopped first
      {others.length ? (
        <>
          ; its other disks (<b>{others.join(", ")}</b>) can then be wiped or used too.
        </>
      ) : (
        "."
      )}
    </>
  );
}
