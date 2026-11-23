import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Download, KeyRound, Network, RefreshCw, SlidersHorizontal } from "lucide-react";
import { api } from "../lib/api";
import { ago, date, DATE_FORMATS } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Settings, UpdateInfo } from "../lib/types";
import { Badge, Button, Callout, ConfirmDialog, Input, PageHeader, PageLoader, Select, Switch, Tabs } from "../components/ui";
import { Row, RowBlock, RowCard, SaveBar, Section } from "../components/rows";
import { useSearch } from "../lib/router";
import EntraTab from "./SettingsEntra";
import NetworkTab from "./SettingsNetwork";
import OsUpdateTab from "./SettingsOsUpdate";

type TabId = "general" | "network" | "entra" | "update";
const TABS: { value: TabId; label: string; icon: React.ReactNode }[] = [
  { value: "general", label: "General", icon: <SlidersHorizontal /> },
  { value: "network", label: "Network", icon: <Network /> },
  { value: "entra", label: "EntraID", icon: <KeyRound /> },
  { value: "update", label: "Update", icon: <Download /> },
];

export default function SettingsPage() {
  const initial = new URLSearchParams(location.search).get("tab") as TabId | null;
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.value === initial) ? initial! : "general");
  // a link to another tab while Settings is open (the update button opens ?tab=update)
  const search = useSearch();
  useEffect(() => {
    const t = new URLSearchParams(search).get("tab") as TabId | null;
    if (t && TABS.some((x) => x.value === t)) setTab(t);
  }, [search]);
  const change = (t: TabId) => {
    setTab(t);
    history.replaceState(null, "", t === "general" ? location.pathname : `${location.pathname}?tab=${t}`);
  };
  return (
    <>
      <PageHeader title="Settings" description="All system settings" />
      <div className="mb-5">
        <Tabs value={tab} onChange={change} tabs={TABS} />
      </div>
      {tab === "general" && <GeneralTab />}
      {tab === "network" && <NetworkTab />}
      {tab === "entra" && <EntraTab />}
      {tab === "update" && <UpdateTab />}
    </>
  );
}

function GeneralTab() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const tz = useQuery({ queryKey: ["timezones"], queryFn: () => api.get<string[]>("/settings/timezones"), staleTime: Infinity });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  const save = useAction((body: Partial<Settings>) => api.put<Settings>("/settings", body), {
    success: "Settings saved",
    invalidate: ["settings", "system", "dashboard"],
  });
  if (!form || !settings.data) return <PageLoader />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v });
  const FIELDS = ["hostname", "timezone", "workgroup", "smb_min_protocol", "smb_macos_compat", "date_format", "time_format"] as const;
  const changes = FIELDS.filter((k) => form[k] !== settings.data![k]).length;
  const W = "w-full sm:w-64";
  return (
    <RowCard>
      <Section title="This NAS" />
      <Row label="Name" hint={`Reachable as ${form.hostname}.local`}>
        <Input value={form.hostname} onChange={(e) => set("hostname", e.target.value)} className={W} aria-label="Name" />
      </Row>
      <Section title="Date and time" />
      <Row label="Time zone">
        <Select value={form.timezone} onChange={(e) => set("timezone", e.target.value)} className={W} aria-label="Time zone">
          {(tz.data ?? [form.timezone]).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      </Row>
      <Row label="Format">
        <Select value={form.date_format} onChange={(e) => set("date_format", e.target.value)} className="w-full sm:w-40" aria-label="Date format">
          {DATE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {example(f)}
            </option>
          ))}
        </Select>
        <Select value={form.time_format} onChange={(e) => set("time_format", e.target.value)} className="w-full sm:w-28" aria-label="Time format">
          <option value="24h">17:45</option>
          <option value="12h">5:45 PM</option>
        </Select>
      </Row>
      <Section title="Windows and macOS sharing" />
      <Row label="Workgroup">
        <Input value={form.workgroup} onChange={(e) => set("workgroup", e.target.value.toUpperCase())} maxLength={15} className={W} aria-label="Workgroup" />
      </Row>
      <Row label="Minimum SMB version" hint="SMB2_10 or newer is recommended">
        <Select value={form.smb_min_protocol} onChange={(e) => set("smb_min_protocol", e.target.value)} className={W} aria-label="Minimum SMB version">
          {form.smb_protocols.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </Select>
      </Row>
      <Row inline label="macOS compatibility" hint="Faster Finder browsing and correct metadata">
        <Switch checked={form.smb_macos_compat} onChange={(v) => set("smb_macos_compat", v)} label="macOS compatibility" />
      </Row>
      <SaveBar
        show={changes > 0}
        note={`${changes} change${changes > 1 ? "s" : ""}`}
        onDiscard={() => setForm(settings.data!)}
        loading={save.isPending}
        onSave={() => save.mutate(Object.fromEntries(FIELDS.map((k) => [k, form[k]])) as Partial<Settings>)}
      />
    </RowCard>
  );
}

/** The date of today in a format, for the Date format choices. */
function example(f: string): string {
  const d = new Date();
  const [dd, mm, y] = [String(d.getDate()).padStart(2, "0"), String(d.getMonth() + 1).padStart(2, "0"), d.getFullYear()];
  return f === "yyyy-mm-dd" ? `${y}-${mm}-${dd}` : f === "mm/dd/yyyy" ? `${mm}/${dd}/${y}` : f.replace("dd", dd).replace("mm", mm).replace("yyyy", String(y));
}

function ReleaseNotes({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("**Full Changelog"));
  return (
    <div className="max-h-64 space-y-1 overflow-y-auto text-[13px] text-zinc-600 dark:text-zinc-300">
      {lines.map((l, i) => {
        const t = l.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/https?:\/\/\S+/g, "").trim();
        if (/^#+\s/.test(l)) return <div key={i} className="pt-2 font-semibold text-zinc-900 first:pt-0 dark:text-white">{t.replace(/^#+\s*/, "")}</div>;
        if (/^\s*[-*]\s/.test(l)) return <div key={i} className="flex gap-2"><span className="text-brand-500">•</span><span>{t.replace(/^[-*]\s*/, "")}</span></div>;
        return <div key={i}>{t}</div>;
      })}
    </div>
  );
}

const CHECK_EVERY: [number, string][] = [
  [1, "Every hour"],
  [6, "Every 6 hours"],
  [12, "Every 12 hours"],
  [24, "Every day"],
  [168, "Every week"],
  [0, "Never (only Check now)"],
];

/** Talon itself and the operating system it runs on, on one card. */
function UpdateTab() {
  return (
    <RowCard>
      <SoftwareUpdate />
      <OsUpdateTab />
    </RowCard>
  );
}

function SoftwareUpdate() {
  const { data } = useQuery({ queryKey: ["update"], queryFn: () => api.get<UpdateInfo>("/update") });
  const [confirm, setConfirm] = useState(false);
  const [notes, setNotes] = useState(false);
  const check = useAction(() => api.post<UpdateInfo>("/update/check"), {
    invalidate: ["update"],
    success: (r) => (r.error ? "" : r.available ? `Talon ${r.latest} is available` : "Talon is up to date"),
  });
  // opening this tab checks for an even newer version straight away (quietly)
  const qc = useQueryClient();
  useEffect(() => {
    api.post("/update/check").then(() => qc.invalidateQueries({ queryKey: ["update"] }), () => {});
  }, [qc]);
  const interval = useAction((h: number) => api.put<UpdateInfo>("/update/settings", { interval_hours: h }), {
    invalidate: ["update"],
    success: "Saved",
  });
  const install = useAction(() => api.post("/update/install"), {
    invalidate: ["update-status", "update"],
    onSuccess: () => setConfirm(false),
  });
  if (!data) return null;
  return (
    <>
      <Section
        title="Talon"
        right={
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={check.isPending} onClick={() => check.mutate()}>
            Check now
          </Button>
        }
      />
      {data.available ? (
        <Row
          label={
            <span className="flex flex-wrap items-center gap-2">
              Talon {data.latest} <Badge tone="violet">New</Badge>
            </span>
          }
          hint={
            <>
              You have {data.current}
              {data.published_at && ` · released ${date(new Date(data.published_at).getTime() / 1000)}`}
              {data.notes && (
                <>
                  {" · "}
                  <button type="button" onClick={() => setNotes(!notes)} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                    {notes ? "Hide what's new" : "What's new"}
                  </button>
                </>
              )}
            </>
          }
        >
          <Button size="sm" variant="primary" icon={<Download className="size-3.5" />} onClick={() => setConfirm(true)}>
            Install
          </Button>
        </Row>
      ) : (
        <Row
          label={
            <span className="flex flex-wrap items-center gap-2">
              Talon {data.current} <Badge tone="green" dot>Up to date</Badge>
            </span>
          }
          hint={data.checked_at ? `Checked ${ago(data.checked_at)}` : "Not checked yet"}
        />
      )}
      {notes && data.available && data.notes && (
        <RowBlock>
          <ReleaseNotes text={data.notes} />
        </RowBlock>
      )}
      {data.error && (
        <RowBlock>
          <Callout tone="warning" title="Could not check for updates">{data.error}</Callout>
        </RowBlock>
      )}
      {data.status.state === "failed" && (
        <RowBlock>
          <Callout tone="danger" title={`The last update to ${data.status.target} failed and was rolled back`}>
            {data.status.error}
          </Callout>
        </RowBlock>
      )}
      <Row label="Check for updates" hint="You are told when a new version is available; nothing installs by itself">
        <Select value={data.interval_hours} onChange={(e) => interval.mutate(Number(e.target.value))} className="w-full sm:w-56" aria-label="Check for updates">
          {CHECK_EVERY.map(([h, label]) => (
            <option key={h} value={h}>{label}</option>
          ))}
        </Select>
      </Row>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => install.mutate()}
        loading={install.isPending}
        title={`Install Talon ${data.latest}?`}
        confirmText="Install now"
        message={
          <ul className="list-disc space-y-1 pl-4">
            <li>Takes about 1–3 minutes; the web interface restarts briefly and reloads by itself.</li>
            <li>Shared folders (SMB/NFS) stay available and volumes are not touched.</li>
            <li>The current version is backed up and restored automatically if anything fails.</li>
          </ul>
        }
      />
    </>
  );
}
