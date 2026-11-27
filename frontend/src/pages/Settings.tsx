import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { KeyRound, Network, SlidersHorizontal } from "lucide-react";
import { api } from "../lib/api";
import { DATE_FORMATS } from "../lib/format";
import { useAction, useDraft } from "../lib/hooks";
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

const HOSTNAME_RE = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const WORKGROUP_RE = /^[A-Z0-9_-]{1,15}$/;
const GENERAL = ["hostname", "timezone", "date_format", "time_format", "workgroup", "smb_min_protocol", "smb_macos_compat"] as const;

/** Settings → General: changes are kept until Save. */
function GeneralTab() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const tz = useQuery({ queryKey: ["timezones"], queryFn: () => api.get<string[]>("/settings/timezones"), staleTime: Infinity });
  const saved = settings.data && (Object.fromEntries(GENERAL.map((k) => [k, settings.data![k]])) as Pick<Settings, (typeof GENERAL)[number]>);
  const { draft: f, dirty, set, reset, saved: done } = useDraft(saved);
  const save = useAction((body: Partial<Settings>) => api.put<Settings>("/settings", body), {
    success: "Settings saved",
    invalidate: ["settings", "system", "dashboard"],
    onSuccess: () => done(),
  });
  if (!settings.data || !f || !saved) return <PageLoader />;
  const d = settings.data;
  const problem = !f.hostname
    ? "Enter a name for the NAS"
    : !HOSTNAME_RE.test(f.hostname)
      ? "Name: letters, digits and - (not at the start or end)"
      : !f.workgroup
        ? "Enter the workgroup"
        : !WORKGROUP_RE.test(f.workgroup)
          ? "Workgroup: up to 15 letters, digits, - and _"
          : null;
  const changed = Object.fromEntries(GENERAL.filter((k) => f[k] !== saved[k]).map((k) => [k, f[k]])) as Partial<Settings>;
  const W = "w-full sm:w-72";
  return (
    <RowCard>
      <Section title="This NAS" />
      <Row label="Name" hint={`Reachable as ${f.hostname || d.hostname}.local when Bonjour is on under Services`}>
        <Input value={f.hostname} onChange={(e) => set("hostname", e.target.value.replace(/\s/g, ""))} aria-invalid={!!f.hostname && !HOSTNAME_RE.test(f.hostname)} className={W} aria-label="Name" />
      </Row>
      <Section title="Date and time" />
      <Row label="Time zone">
        <Select value={f.timezone} onChange={(e) => set("timezone", e.target.value)} className={W} aria-label="Time zone">
          {(tz.data ?? [f.timezone]).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      </Row>
      <Row label="Format">
        <Select value={f.date_format} onChange={(e) => set("date_format", e.target.value)} className="w-full sm:w-44" aria-label="Date format">
          {DATE_FORMATS.map((x) => (
            <option key={x} value={x}>
              {example(x)}
            </option>
          ))}
        </Select>
        <Select value={f.time_format} onChange={(e) => set("time_format", e.target.value)} className="w-full sm:w-26" aria-label="Time format">
          <option value="24h">17:45</option>
          <option value="12h">5:45 PM</option>
        </Select>
      </Row>
      <Section title="Windows and macOS sharing" />
      <Row label="Workgroup">
        <Input value={f.workgroup} onChange={(e) => set("workgroup", e.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={15} aria-invalid={!!f.workgroup && !WORKGROUP_RE.test(f.workgroup)} className={W} aria-label="Workgroup" />
      </Row>
      <Row label="Minimum SMB version" hint="SMB2_10 or newer is recommended">
        <Select value={f.smb_min_protocol} onChange={(e) => set("smb_min_protocol", e.target.value)} className={W} aria-label="Minimum SMB version">
          {d.smb_protocols.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </Select>
      </Row>
      <Row inline label="macOS compatibility" hint="Faster Finder browsing and correct metadata">
        <Switch checked={f.smb_macos_compat} onChange={(v) => set("smb_macos_compat", v)} label="macOS compatibility" />
      </Row>
      <SaveBar dirty={dirty} problem={problem} onDiscard={reset} loading={save.isPending} onSave={() => save.mutate(changed)} />
    </RowCard>
  );
}

/** The date of today in a format, for the Date format choices. */
function example(f: string): string {
  const d = new Date();
  const [dd, mm, y] = [String(d.getDate()).padStart(2, "0"), String(d.getMonth() + 1).padStart(2, "0"), d.getFullYear()];
  return f === "yyyy-mm-dd" ? `${y}-${mm}-${dd}` : f === "mm/dd/yyyy" ? `${mm}/${dd}/${y}` : f.replace("dd", dd).replace("mm", mm).replace("yyyy", String(y));
}
