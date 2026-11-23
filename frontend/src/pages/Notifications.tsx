import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Send, Thermometer } from "lucide-react";
import { api } from "../lib/api";
import { cx, sameSet, sameValue } from "../lib/format";
import { useAction } from "../lib/hooks";
import SmtpCard from "./NotificationsSmtp";
import { Row, RowCard, SaveBar, Section } from "../components/rows";
import type { NotificationSettings } from "../lib/types";
import { Badge, Button, Card, CardHeader, Input, PageHeader, PageLoader, Switch, Tabs } from "../components/ui";

type TabId = "email" | "notifications" | "thresholds";

export default function NotificationsPage() {
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<NotificationSettings>("/notifications") });
  const initial = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState<TabId>(initial === "thresholds" || initial === "notifications" ? initial : "email");
  const change = (t: TabId) => {
    setTab(t);
    history.replaceState(null, "", t === "email" ? location.pathname : `${location.pathname}?tab=${t}`);
  };
  // the Notifications tab appears once email (SMTP) is set up
  const smtp = !!q.data?.smtp;
  const shown = tab === "notifications" && q.data && !smtp ? "email" : tab;
  return (
    <>
      <PageHeader title="Notifications" description="Choose when Talon warns you" />
      <div className="mb-5">
        <Tabs
          value={shown}
          onChange={change}
          tabs={[
            { value: "email", label: "Email" },
            ...(smtp ? [{ value: "notifications" as const, label: "Notifications" }] : []),
            { value: "thresholds", label: "Thresholds" },
          ]}
        />
      </div>
      {shown === "email" ? <SmtpCard /> : shown === "notifications" ? <EmailTab /> : <ThresholdsCard />}
    </>
  );
}

/** Notifications → Notifications: who gets emails, and for what. */
function EmailTab() {
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<NotificationSettings>("/notifications") });
  const [recipients, setRecipients] = useState("");
  const [events, setEvents] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!q.data) return;
    setRecipients(q.data.recipients.join(", "));
    setEvents(q.data.events);
  }, [q.data]);
  const list = recipients.split(/[,;\s]+/).filter(Boolean);
  const save = useAction(() => api.put<NotificationSettings>("/notifications", { recipients: list, events }), {
    success: "Notification settings saved",
    invalidate: ["notifications"],
  });
  const test = useAction(() => api.post("/notifications/test"), { success: "Test notification sent" });
  if (!q.data) return <PageLoader />;

  const changed = !sameSet(list, q.data.recipients) || !sameValue(events, q.data.events);
  return (
    <RowCard>
      <Section
        title="Email notifications"
        right={
          <Button size="sm" variant="ghost" icon={<Send className="size-3.5" />} disabled={changed || !q.data.recipients.length} loading={test.isPending} onClick={() => test.mutate()}>
            Send test
          </Button>
        }
      />
      <Row label="Send to" hint="Separate several addresses with commas; each alert is sent once, and again if it comes back">
        <Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="you@example.com" className="w-full sm:w-72" aria-label="Send to" />
      </Row>
      <Section title="Send an email when" />
      <div className="grid md:grid-cols-2">
        {Object.entries(q.data.labels).map(([id, label]) => (
          <div key={id} className="flex min-h-11 items-center justify-between gap-4 border-t border-zinc-100 px-5 py-2 first:border-t-0 md:[&:nth-child(2)]:border-t-0 dark:border-white/5">
            <span className="min-w-0 text-[13.5px] font-medium break-words">{label}</span>
            <Switch checked={!!events[id]} onChange={(v) => setEvents({ ...events, [id]: v })} label={label} />
          </div>
        ))}
      </div>
      <SaveBar
        show={changed}
        onDiscard={() => {
          setRecipients(q.data!.recipients.join(", "));
          setEvents(q.data!.events);
        }}
        loading={save.isPending}
        onSave={() => save.mutate()}
      />
    </RowCard>
  );
}

/* ---------------------------------------------------------------- alert thresholds */

type Limits = { temp_hdd: number; temp_ssd: number; temp_nvme: number; volume_full: number; ssd_wear: number; bad_sectors: boolean };
type ThresholdInfo = { values: Limits; defaults: Limits; now: Record<"hdd" | "ssd" | "nvme", { name: string; temperature: number }[]> };
type NumKey = Exclude<keyof Limits, "bad_sectors">;

const ROWS: { section: string; key: NumKey; title: string; text: string; unit: string; now?: "hdd" | "ssd" | "nvme"; min: number; max: number }[] = [
  { section: "Disk temperature", key: "temp_hdd", title: "Hard disks (HDD)", text: "Most are rated up to 60 °C", unit: "°C", now: "hdd", min: 30, max: 90 },
  { section: "Disk temperature", key: "temp_ssd", title: "SATA SSDs", text: "Most are rated up to 70 °C", unit: "°C", now: "ssd", min: 30, max: 90 },
  { section: "Disk temperature", key: "temp_nvme", title: "NVMe SSDs", text: "Most slow down above 80 °C", unit: "°C", now: "nvme", min: 30, max: 95 },
  { section: "Storage", key: "volume_full", title: "Volume almost full", text: "Warn when a volume is this full", unit: "% used", min: 50, max: 99 },
  { section: "Storage", key: "ssd_wear", title: "SSD wear", text: "Share of the rated write endurance used", unit: "% worn", min: 50, max: 100 },
];

function ThresholdsCard() {
  const q = useQuery({ queryKey: ["thresholds"], queryFn: () => api.get<ThresholdInfo>("/thresholds") });
  const [f, setF] = useState<Record<NumKey, string> & { bad_sectors: boolean }>();
  const load = (v: Limits) =>
    setF({ temp_hdd: String(v.temp_hdd), temp_ssd: String(v.temp_ssd), temp_nvme: String(v.temp_nvme), volume_full: String(v.volume_full), ssd_wear: String(v.ssd_wear), bad_sectors: v.bad_sectors });
  useEffect(() => {
    if (q.data) load(q.data.values);
  }, [q.data]);
  const body = () => ({ ...Object.fromEntries(ROWS.map((r) => [r.key, Number(f![r.key])])), bad_sectors: f!.bad_sectors });
  const save = useAction(() => api.put<ThresholdInfo>("/thresholds", body()), {
    success: "Thresholds saved",
    invalidate: ["thresholds", "dashboard", "disks", "alerts"],
  });
  if (!q.data || !f) return null;
  const bad = (r: (typeof ROWS)[number]) => {
    const n = Number(f[r.key]);
    return !/^\d+$/.test(f[r.key]) || n < r.min || n > r.max;
  };
  const invalid = ROWS.some(bad);
  const changed = !invalid && !sameValue(body(), q.data.values);
  const isDefault = sameValue(invalid ? null : body(), q.data.defaults);
  let section = "";

  return (
    <Card>
      <CardHeader
        icon={<Thermometer className="size-4.5" />}
        title="Thresholds"
        subtitle="When the bell and emails warn you"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" disabled={isDefault} onClick={() => load(q.data!.defaults)}>
              Reset to defaults
            </Button>
            <Button variant="primary" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        }
      />
      <div className="px-5 pb-2">
        {ROWS.map((r) => {
          const head = r.section !== section;
          section = r.section;
          const now = r.now ? q.data!.now[r.now] : [];
          return (
            <div key={r.key}>
              {head && <div className="mt-2 mb-1 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase first:mt-0 dark:text-zinc-500">{r.section}</div>}
              <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-4 border-t border-zinc-100 py-3 sm:grid-cols-[minmax(0,1fr)_9rem] sm:gap-8 dark:border-white/5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.title}</div>
                    <div className="truncate text-[13px] text-zinc-500 dark:text-zinc-400">{r.text}</div>
                  </div>
                  {now.length > 0 && (
                    <span className="hidden min-w-0 lg:block">
                      <Badge className="max-w-full truncate">
                        Now: {now.slice(0, 4).map((d) => `${d.name} ${d.temperature} °C`).join(" · ")}
                        {now.length > 4 ? ` · +${now.length - 4}` : ""}
                      </Badge>
                    </span>
                  )}
                </div>
                <div
                  className={cx(
                    "flex h-9.5 items-stretch overflow-hidden rounded-xl border bg-white focus-within:border-brand-500 dark:bg-white/[0.04]",
                    bad(r) ? "border-rose-400" : "border-zinc-200 dark:border-white/10",
                  )}
                >
                  <input
                    value={f[r.key]}
                    onChange={(e) => setF({ ...f, [r.key]: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                    inputMode="numeric"
                    aria-label={r.title}
                    className="tabular w-full min-w-0 bg-transparent px-3 text-sm focus:outline-none"
                  />
                  <span className="flex shrink-0 items-center border-l border-zinc-200 bg-zinc-50 px-2.5 text-[13px] whitespace-nowrap text-zinc-500 dark:border-white/10 dark:bg-white/[0.03]">
                    {r.unit}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-zinc-100 py-3 dark:border-white/5">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">Bad sectors</div>
            <div className="truncate text-[13px] text-zinc-500 dark:text-zinc-400">Warn as soon as a disk reports reallocated or pending sectors</div>
          </div>
          <Switch checked={f.bad_sectors} onChange={(v) => setF({ ...f, bad_sectors: v })} label="Bad sectors" />
        </div>
      </div>
    </Card>
  );
}
