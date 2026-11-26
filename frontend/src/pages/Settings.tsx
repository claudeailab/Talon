import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { KeyRound, Network, SlidersHorizontal } from "lucide-react";
import { api } from "../lib/api";
import { DATE_FORMATS } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { Settings } from "../lib/types";
import { PageHeader, PageLoader, Select, Switch, Tabs } from "../components/ui";
import { Row, RowCard, Section } from "../components/rows";
import { AutoField } from "../components/autosave";
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

/** Settings → General: every setting saves as soon as it changes (a text field when you leave it). */
function GeneralTab() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const tz = useQuery({ queryKey: ["timezones"], queryFn: () => api.get<string[]>("/settings/timezones"), staleTime: Infinity });
  const save = useAction((body: Partial<Settings>) => api.put<Settings>("/settings", body), {
    success: "Saved",
    invalidate: ["settings", "system", "dashboard"],
  });
  const d = settings.data;
  if (!d) return <PageLoader />;
  const put = <K extends keyof Settings>(k: K, v: Settings[K]) => save.mutateAsync({ [k]: v } as Partial<Settings>);
  const W = "w-full sm:w-72";
  return (
    <RowCard>
      <Section title="This NAS" />
      <Row label="Name" hint={`Reachable as ${d.hostname}.local when Bonjour is on under Services`}>
        <AutoField
          value={d.hostname}
          onSave={(v) => put("hostname", v)}
          filter={(v) => v.replace(/\s/g, "")}
          validate={(v) => (/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(v) ? null : "Letters, digits and - (not at the start or end)")}
          aria-label="Name"
        />
      </Row>
      <Section title="Date and time" />
      <Row label="Time zone">
        <Select value={d.timezone} onChange={(e) => put("timezone", e.target.value)} className={W} aria-label="Time zone">
          {(tz.data ?? [d.timezone]).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      </Row>
      <Row label="Format">
        <Select value={d.date_format} onChange={(e) => put("date_format", e.target.value)} className="w-full sm:w-44" aria-label="Date format">
          {DATE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {example(f)}
            </option>
          ))}
        </Select>
        <Select value={d.time_format} onChange={(e) => put("time_format", e.target.value)} className="w-full sm:w-26" aria-label="Time format">
          <option value="24h">17:45</option>
          <option value="12h">5:45 PM</option>
        </Select>
      </Row>
      <Section title="Windows and macOS sharing" />
      <Row label="Workgroup">
        <AutoField
          value={d.workgroup}
          onSave={(v) => put("workgroup", v)}
          filter={(v) => v.toUpperCase().replace(/\s/g, "")}
          validate={(v) => (/^[A-Z0-9_-]{1,15}$/.test(v) ? null : "Up to 15 letters, digits, - and _")}
          maxLength={15}
          aria-label="Workgroup"
        />
      </Row>
      <Row label="Minimum SMB version" hint="SMB2_10 or newer is recommended">
        <Select value={d.smb_min_protocol} onChange={(e) => put("smb_min_protocol", e.target.value)} className={W} aria-label="Minimum SMB version">
          {d.smb_protocols.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </Select>
      </Row>
      <Row inline label="macOS compatibility" hint="Faster Finder browsing and correct metadata">
        <Switch checked={d.smb_macos_compat} onChange={(v) => put("smb_macos_compat", v)} label="macOS compatibility" />
      </Row>
    </RowCard>
  );
}

/** The date of today in a format, for the Date format choices. */
function example(f: string): string {
  const d = new Date();
  const [dd, mm, y] = [String(d.getDate()).padStart(2, "0"), String(d.getMonth() + 1).padStart(2, "0"), d.getFullYear()];
  return f === "yyyy-mm-dd" ? `${y}-${mm}-${dd}` : f === "mm/dd/yyyy" ? `${mm}/${dd}/${y}` : f.replace("dd", dd).replace("mm", mm).replace("yyyy", String(y));
}
