import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, Eraser, HardDrive, MoreHorizontal, Thermometer } from "lucide-react";
import { api } from "../lib/api";
import { bytes } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Disk, Job } from "../lib/types";
import { DiskIcon, DiskStatusBadge, HealthBadge, kindLabel } from "../components/disk";
import { JobDialog } from "../components/jobs";
import { Badge, Button, Card, ConfirmDialog, Empty, IconButton, Menu, MenuItem, Modal, PageHeader, PageLoader, Spinner } from "../components/ui";

interface Smart {
  available: boolean;
  passed: boolean | null;
  temperature: number | null;
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

export default function DisksPage() {
  const { data } = useQuery({ queryKey: ["disks"], queryFn: () => api.get<Disk[]>("/disks"), refetchInterval: 15000 });
  const [smart, setSmart] = useState<Disk | null>(null);
  const [wipe, setWipe] = useState<Disk | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const doWipe = useAction((n: string) => api.post<Job>(`/disks/${n}/wipe`), {
    onSuccess: (j) => {
      setWipe(null);
      setJob(j.id);
    },
  });
  if (!data) return <PageLoader />;

  return (
    <>
      <PageHeader title="Disks" description="All physical disks detected in this computer, with health information from S.M.A.R.T." />
      <Card className="overflow-hidden">
        {data.length === 0 ? (
          <Empty icon={<HardDrive className="size-6" />} title="No disks detected" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-500 dark:border-white/5">
                  <th className="px-5 py-3">Disk</th>
                  <th className="px-3 py-3">Capacity</th>
                  <th className="hidden px-3 py-3 md:table-cell">Type</th>
                  <th className="px-3 py-3">Health</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Temp</th>
                  <th className="px-3 py-3">Usage</th>
                  <th className="w-12 px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                {data.map((d) => (
                  <tr key={d.name} className="transition hover:bg-zinc-50/70 dark:hover:bg-white/[0.02]">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
                          <DiskIcon kind={d.kind} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-mono text-[13px] font-semibold">{d.name}</div>
                          <div className="max-w-[16rem] truncate text-xs text-zinc-500">{d.model}</div>
                          {d.serial && <div className="font-mono text-[11px] text-zinc-400">{d.serial}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="tabular px-3 py-3.5 font-medium">{bytes(d.size)}</td>
                    <td className="hidden px-3 py-3.5 md:table-cell">
                      <Badge>{kindLabel[d.kind]}</Badge>
                    </td>
                    <td className="px-3 py-3.5">
                      <HealthBadge health={d.health} />
                    </td>
                    <td className="tabular hidden px-3 py-3.5 text-zinc-600 sm:table-cell dark:text-zinc-400">
                      {d.temperature != null ? `${d.temperature}°C` : "—"}
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex flex-col items-start gap-0.5">
                        <DiskStatusBadge d={d} />
                        <span className="max-w-[14rem] truncate text-xs text-zinc-500">{d.status_detail}</span>
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
      <ConfirmDialog
        open={!!wipe}
        onClose={() => setWipe(null)}
        onConfirm={() => wipe && doWipe.mutate(wipe.name)}
        loading={doWipe.isPending}
        danger
        title={`Wipe ${wipe?.name}?`}
        confirmText="Wipe disk"
        typeToConfirm={wipe?.name}
        message={
          <>
            All partitions and data on <b>{wipe?.model}</b> ({bytes(wipe?.size)}) will be permanently erased.
          </>
        }
      />
      <JobDialog jobId={job} onClose={() => setJob(null)} />
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
