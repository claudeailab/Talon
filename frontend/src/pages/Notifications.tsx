import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RotateCcw, Send } from "lucide-react";
import { api } from "../lib/api";
import { sameValue } from "../lib/format";
import { useAction } from "../lib/hooks";
import SmtpCard from "./NotificationsSmtp";
import { Row, RowCard, Section } from "../components/rows";
import { AutoField } from "../components/autosave";
import type { NotificationSettings } from "../lib/types";
import { Badge, Button, PageHeader, PageLoader, Switch, Tabs } from "../components/ui";

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

/** Notifications → Notifications: who gets emails, and for what. Each change saves by itself. */
function EmailTab() {
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<NotificationSettings>("/notifications") });
  const save = useAction((body: { recipients: string[]; events: Record<string, boolean> }) => api.put<NotificationSettings>("/notifications", body), {
    success: "Saved",
    invalidate: ["notifications"],
  });
  const test = useAction(() => api.post("/notifications/test"), { success: "Test notification sent" });
  if (!q.data) return <PageLoader />;
  const d = q.data;
  const split = (v: string) => v.split(/[,;\s]+/).filter(Boolean);
  return (
    <RowCard>
      <Section
        title="Email notifications"
        right={
          <Button size="sm" variant="link" icon={<Send className="size-3.5" />} disabled={!d.recipients.length} loading={test.isPending} onClick={() => test.mutate()}>
            Send test
          </Button>
        }
      />
      <Row label="Send to" hint="Separate several addresses with commas; each alert is sent once, and again if it comes back">
        <AutoField
          value={d.recipients.join(", ")}
          onSave={(v) => save.mutateAsync({ recipients: split(v), events: d.events })}
          validate={(v) => (split(v).every((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) ? null : "Enter email addresses, separated by commas")}
          placeholder="you@example.com"
          width="w-full sm:w-72"
          aria-label="Send to"
        />
      </Row>
      <Section title="Send an email when" />
      <div className="grid md:grid-cols-2">
        {Object.entries(d.labels).map(([id, label]) => (
          <div key={id} className="flex min-h-11 items-center justify-between gap-4 border-t border-zinc-100 px-5 py-2 first:border-t-0 md:[&:nth-child(2)]:border-t-0 dark:border-white/5">
            <span className="min-w-0 text-[13.5px] font-medium break-words">{label}</span>
            <Switch checked={!!d.events[id]} onChange={(v) => save.mutate({ recipients: d.recipients, events: { ...d.events, [id]: v } })} label={label} />
          </div>
        ))}
      </div>
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

/** Notifications → Thresholds: when the bell and emails warn. Each value saves when you leave its field. */
function ThresholdsCard() {
  const q = useQuery({ queryKey: ["thresholds"], queryFn: () => api.get<ThresholdInfo>("/thresholds") });
  const save = useAction((body: Limits) => api.put<ThresholdInfo>("/thresholds", body), {
    success: "Saved",
    invalidate: ["thresholds", "dashboard", "disks", "alerts"],
  });
  if (!q.data) return <PageLoader />;
  const { values, defaults } = q.data;
  const isDefault = sameValue(values, defaults);
  const sections = [...new Set(ROWS.map((r) => r.section))];
  return (
    <RowCard>
      {sections.map((sec, i) => (
        <div key={sec}>
          <Section
            title={sec}
            right={
              i === 0 && (
                <Button size="sm" variant="link" icon={<RotateCcw className="size-3.5" />} disabled={isDefault} loading={save.isPending && isDefault} onClick={() => save.mutate(defaults)}>
                  Reset to defaults
                </Button>
              )
            }
          />
          {ROWS.filter((r) => r.section === sec).map((r) => {
            const now = r.now ? q.data!.now[r.now] : [];
            return (
              <Row
                key={r.key}
                label={
                  <span className="flex flex-wrap items-center gap-2">
                    {r.title}
                    {now.length > 0 && (
                      <Badge className="max-w-full [overflow-wrap:anywhere]">
                        Now {now.slice(0, 4).map((d) => `${d.name} ${d.temperature} °C`).join(" · ")}
                        {now.length > 4 ? ` · +${now.length - 4}` : ""}
                      </Badge>
                    )}
                  </span>
                }
                hint={r.text}
              >
                <AutoField
                  value={String(values[r.key])}
                  onSave={(v) => save.mutateAsync({ ...values, [r.key]: Number(v) })}
                  filter={(v) => v.replace(/\D/g, "").slice(0, 3)}
                  validate={(v) => (/^\d+$/.test(v) && Number(v) >= r.min && Number(v) <= r.max ? null : `${r.min}–${r.max}`)}
                  inputMode="numeric"
                  suffix={r.unit}
                  width="w-36"
                  className="tabular"
                  aria-label={r.title}
                />
              </Row>
            );
          })}
        </div>
      ))}
      <Row inline label="Bad sectors" hint="Warn as soon as a disk reports reallocated or pending sectors">
        <Switch checked={values.bad_sectors} onChange={(v) => save.mutate({ ...values, bad_sectors: v })} label="Bad sectors" />
      </Row>
    </RowCard>
  );
}
