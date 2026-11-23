import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { KeyRound, Network, SlidersHorizontal } from "lucide-react";
import { api } from "../lib/api";
import { DATE_FORMATS } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Settings } from "../lib/types";
import { Input, PageHeader, PageLoader, Select, Switch, Tabs } from "../components/ui";
import { Row, RowCard, SaveBar, Section } from "../components/rows";
import { useSearch } from "../lib/router";
import EntraTab from "./SettingsEntra";
import NetworkTab from "./SettingsNetwork";

type TabId = "general" | "network" | "entra";
const TABS: { value: TabId; label: string; icon: React.ReactNode }[] = [
  { value: "general", label: "General", icon: <SlidersHorizontal /> },
  { value: "network", label: "Network", icon: <Network /> },
  { value: "entra", label: "Entra ID", icon: <KeyRound /> },
];

export default function SettingsPage() {
  const initial = new URLSearchParams(location.search).get("tab") as TabId | null;
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.value === initial) ? initial! : "general");
  // a link to another tab while Settings is open (for example ?tab=entra)
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
      <Row label="Name" hint={`Reachable as ${form.hostname}.local when Bonjour is on under Services`}>
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
