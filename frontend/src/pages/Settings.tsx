import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CheckCircle2, Download, HardDrive, Info, KeyRound, Mail, Network, RefreshCw, Server, SlidersHorizontal, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { ago, bytes, date, DATE_FORMATS } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Settings, SysInfo, UpdateInfo } from "../lib/types";
import { Badge, Button, Callout, Card, CardHeader, ConfirmDialog, Field, Input, PageHeader, PageLoader, Select, SubTabs, Switch, Tabs } from "../components/ui";
import { useSearch } from "../lib/router";
import EntraTab from "./SettingsEntra";
import NetworkTab from "./SettingsNetwork";
import SmtpTab from "./SettingsSmtp";
import OsUpdateTab from "./SettingsOsUpdate";

type TabId = "general" | "network" | "entra" | "smtp" | "update" | "about";
const TABS: { value: TabId; label: string; icon: React.ReactNode }[] = [
  { value: "general", label: "General", icon: <SlidersHorizontal /> },
  { value: "network", label: "Networking", icon: <Network /> },
  { value: "entra", label: "EntraID", icon: <KeyRound /> },
  { value: "smtp", label: "SMTP", icon: <Mail /> },
  { value: "update", label: "Update", icon: <Download /> },
  { value: "about", label: "About", icon: <Info /> },
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
      {tab === "smtp" && <SmtpTab />}
      {tab === "update" && <UpdateTab />}
      {tab === "about" && <AboutTab />}
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
  if (!form) return <PageLoader />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v });
  const FIELDS = ["hostname", "timezone", "workgroup", "smb_min_protocol", "smb_macos_compat", "date_format", "time_format"] as const;
  const changed = !!settings.data && FIELDS.some((k) => form[k] !== settings.data![k]);
  return (
    <div className="space-y-5">
    <Card>
      <CardHeader
        icon={<Server className="size-4.5" />}
        title="General & Sharing"
        subtitle="Name, date and time, and Windows/macOS sharing"
        actions={
          <Button
            variant="primary"
            disabled={!changed}
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                hostname: form.hostname,
                timezone: form.timezone,
                workgroup: form.workgroup,
                smb_min_protocol: form.smb_min_protocol,
                smb_macos_compat: form.smb_macos_compat,
                date_format: form.date_format,
                time_format: form.time_format,
              })
            }
          >
            Save
          </Button>
        }
      />
      <div className="grid gap-x-8 gap-y-4 px-5 pb-5 md:grid-cols-2 [&>*]:min-w-0">
        <Field label="Hostname" hint={`Reachable as ${form.hostname}.local`}>
          <Input value={form.hostname} onChange={(e) => set("hostname", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <Field label="Workgroup">
            <Input value={form.workgroup} onChange={(e) => set("workgroup", e.target.value.toUpperCase())} maxLength={15} />
          </Field>
          <Field label="Minimum SMB protocol" hint="SMB2_10+ recommended">
            <Select value={form.smb_min_protocol} onChange={(e) => set("smb_min_protocol", e.target.value)}>
              {form.smb_protocols.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <Field label="Date format">
            <Select value={form.date_format} onChange={(e) => set("date_format", e.target.value)}>
              {DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f} ({example(f)})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Time format">
            <Select value={form.time_format} onChange={(e) => set("time_format", e.target.value)}>
              <option value="24h">24-hour (17:45)</option>
              <option value="12h">12-hour (5:45 PM)</option>
            </Select>
          </Field>
        </div>
        <Field label="Time zone">
          <Select value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
            {(tz.data ?? [form.timezone]).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <div>
          <div className="mb-1.5 text-[13px] font-medium">macOS compatibility</div>
          <div className="flex h-10 items-center justify-between gap-4 rounded-xl bg-zinc-50 px-3.5 dark:bg-white/[0.03]">
            <span className="truncate text-[13px] text-zinc-600 dark:text-zinc-400">Faster Finder browsing and correct metadata</span>
            <Switch checked={form.smb_macos_compat} onChange={(v) => set("smb_macos_compat", v)} label="macOS compatibility" />
          </div>
        </div>
      </div>
    </Card>
    <SystemDiskCard />
    </div>
  );
}

type SdCard = {
  enabled: boolean;
  active: boolean;
  restart_needed: boolean;
  disk: string;
  flash: "sd" | "usb" | "";
  recommended: boolean;
  used_mb: number | null;
  size_mb: number;
  synced_at: number | null;
};

/** Fewer writes to the system disk: logs in memory, copied to the disk once a day. */
function SystemDiskCard() {
  const q = useQuery({ queryKey: ["sdcard"], queryFn: () => api.get<SdCard>("/settings/sdcard") });
  const save = useAction((enabled: boolean) => api.put<SdCard>("/settings/sdcard", { enabled }), {
    success: (_r, on) => (on ? "Turned on. It applies after the next restart." : "Turned off. It applies after the next restart."),
    invalidate: ["sdcard"],
  });
  if (!q.data) return null;
  const d = q.data;
  const what = d.flash === "sd" ? "an SD card" : d.flash === "usb" ? "a USB flash drive" : null;
  return (
    <Card>
      <CardHeader
        icon={<HardDrive className="size-4.5" />}
        title="System Disk"
        subtitle={`Talon runs from ${d.disk}${what ? `, ${what}` : ""}`}
      />
      <div className="space-y-3 px-5 pb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium">Fewer writes to the system disk</div>
            <div className="text-[13px] text-zinc-500">
              Keeps the system logs in memory and writes them to the disk once a day and when the NAS shuts down or restarts. SD cards and USB flash drives last
              much longer. After a power cut, up to a day of system logs can be lost; your files are not affected.
              {what && !d.enabled && <span className="font-medium text-amber-600 dark:text-amber-400"> Recommended for {what}.</span>}
            </div>
          </div>
          <Switch checked={d.enabled} onChange={(v) => save.mutate(v)} label="Fewer writes to the system disk" />
        </div>
        {d.restart_needed ? (
          <Callout tone="info">Applies after the next restart of the NAS.</Callout>
        ) : (
          d.active && (
            <div className="text-xs text-zinc-500">
              Logs in memory: {d.used_mb ?? "?"} MB of {d.size_mb} MB
              {d.synced_at ? ` · last written to the disk ${ago(d.synced_at)}` : " · not written to the disk yet"}
            </div>
          )
        )}
      </div>
    </Card>
  );
}

/** The date of today in a format, for the Date format choices. */
function example(f: string): string {
  const d = new Date();
  const [dd, mm, y] = [String(d.getDate()).padStart(2, "0"), String(d.getMonth() + 1).padStart(2, "0"), d.getFullYear()];
  return f === "yyyy-mm-dd" ? `${y}-${mm}-${dd}` : f === "mm/dd/yyyy" ? `${mm}/${dd}/${y}` : f.replace("dd", dd).replace("mm", mm).replace("yyyy", String(y));
}

function AboutTab() {
  const sys = useQuery({ queryKey: ["system"], queryFn: () => api.get<SysInfo>("/system") });
  if (!sys.data) return <PageLoader />;
  return (
    <Card>
      <CardHeader icon={<Info className="size-4.5" />} title="About" subtitle="This NAS and its software" />
      <dl className="space-y-2.5 px-5 pb-5 text-[13px]">
        {[
          ["Talon version", sys.data.version],
          ["Hardware", sys.data.model],
          ["Processor", `${sys.data.cpu} (${sys.data.cores} cores, ${sys.data.arch})`],
          ["Memory", bytes(sys.data.memory)],
          ["Operating system", sys.data.os],
          ["Kernel", sys.data.kernel],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
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

/** Talon itself, or the operating system it runs on. */
function UpdateTab() {
  const [view, setView] = useState<"talon" | "os">(() => (new URLSearchParams(location.search).get("os") ? "os" : "talon"));
  return (
    <>
      <SubTabs
        className="mb-4"
        value={view}
        onChange={(v) => {
          setView(v);
          history.replaceState(null, "", v === "os" ? "/settings?tab=update&os=1" : "/settings?tab=update");
        }}
        tabs={[
          { value: "talon", label: "Talon" },
          { value: "os", label: "Operating system" },
        ]}
      />
      {view === "talon" ? <SoftwareUpdate /> : <OsUpdateTab />}
    </>
  );
}

function SoftwareUpdate() {
  const { data } = useQuery({ queryKey: ["update"], queryFn: () => api.get<UpdateInfo>("/update") });
  const [confirm, setConfirm] = useState(false);
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
    <Card>
      <CardHeader
        icon={<Sparkles className="size-4.5" />}
        title="Software Update"
        subtitle={data.checked_at ? `Last checked ${ago(data.checked_at)}` : "Not checked yet"}
        actions={
          <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={check.isPending} onClick={() => check.mutate()}>
            Check now
          </Button>
        }
      />
      <div className="space-y-4 px-5 pb-5">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3.5 py-2 dark:bg-white/[0.03]">
          <div className="min-w-0">
            <div className="text-[13px] font-medium">Check for updates</div>
            <div className="text-xs text-zinc-500">You are told when a new version is available; nothing installs by itself</div>
          </div>
          <Select
            value={data.interval_hours}
            onChange={(e) => interval.mutate(Number(e.target.value))}
            className="w-full sm:w-56"
            aria-label="Check for updates"
          >
            {CHECK_EVERY.map(([h, label]) => (
              <option key={h} value={h}>{label}</option>
            ))}
          </Select>
        </div>
        {data.error && <Callout tone="warning" title="Could not check for updates">{data.error}</Callout>}
        {data.available ? (
          <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-violet-50 p-5 ring-1 ring-brand-200/70 dark:from-brand-500/10 dark:to-violet-500/10 dark:ring-brand-400/20">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">Talon {data.latest}</span>
                  <Badge tone="violet">New</Badge>
                </div>
                <div className="text-[13px] text-zinc-500">
                  You have {data.current}
                  {data.published_at && ` · released ${date(new Date(data.published_at).getTime() / 1000)}`}
                  {data.url && (
                    <>
                      {" · "}
                      <a href={data.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline dark:text-brand-400">
                        Release page
                      </a>
                    </>
                  )}
                </div>
              </div>
              <Button variant="primary" icon={<Download className="size-4" />} onClick={() => setConfirm(true)}>
                Install update
              </Button>
            </div>
            {data.notes && (
              <div className="mt-4 border-t border-brand-200/60 pt-4 dark:border-white/10">
                <ReleaseNotes text={data.notes} />
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl bg-zinc-50 p-4 dark:bg-white/[0.03]">
            <CheckCircle2 className="size-5 text-emerald-500" />
            <div>
              <div className="text-sm font-medium">Talon {data.current} is up to date</div>
              <div className="text-xs text-zinc-500">Updates are published at github.com/{data.repo}/releases</div>
            </div>
          </div>
        )}
        {data.status.state === "failed" && (
          <Callout tone="danger" title={`The last update to ${data.status.target} failed and was rolled back`}>
            {data.status.error}
          </Callout>
        )}
      </div>
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
    </Card>
  );
}
