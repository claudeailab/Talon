import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, Package, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";
import { api } from "../lib/api";
import { ago, clock, cx, date } from "../lib/format";
import { useAction } from "../lib/hooks";
import { useSearch } from "../lib/router";
import { restartNas } from "../components/restart";
import type { UpdateInfo } from "../lib/types";
import { Badge, Button, Callout, ConfirmDialog, PageHeader, PageLoader, Progress, Segmented, Select, Switch, Tabs, TimeInput } from "../components/ui";
import { Row, RowBlock, RowCard, Section } from "../components/rows";

type Pkg = { name: string; old: string; new: string; security: boolean; restart: boolean };
type Run = { state: "idle" | "running" | "success" | "error"; percent?: number; text?: string; error?: string };
type OsInfo = {
  os: string;
  checked_at: number | null;
  error: string | null;
  packages: Pkg[];
  security: number;
  restart_needed: boolean;
  progress: Run & { phase?: string; package?: string; done?: number; total?: number };
  auto: { mode: "off" | "security" | "all"; restart: boolean; restart_time: string; interval_hours: number };
  checking: Run;
  last_install: { at: number; ok: boolean; count: number; error?: string } | null;
};

type TabId = "settings" | "talon" | "system" | "changelog";
const TABS: { value: TabId; label: string }[] = [
  { value: "settings", label: "Settings" },
  { value: "talon", label: "Talon" },
  { value: "system", label: "System" },
  { value: "changelog", label: "Changelog" },
];

const CHECK_EVERY: [number, string][] = [
  [1, "Every hour"],
  [6, "Every 6 hours"],
  [12, "Every 12 hours"],
  [24, "Every day"],
  [168, "Every week"],
  [0, "Never (only Check now)"],
];

const useTalon = () => useQuery({ queryKey: ["update"], queryFn: () => api.get<UpdateInfo>("/update") });
const useOs = () =>
  useQuery({
    queryKey: ["os-update"],
    queryFn: () => api.get<OsInfo>("/os-update"),
    refetchInterval: (q) => (q.state.data?.progress.state === "running" || q.state.data?.checking.state === "running" ? 1000 : 30000),
  });

export default function UpdatesPage() {
  const tabOf = (search: string): TabId => {
    const t = new URLSearchParams(search).get("tab");
    return t === "talon" || t === "system" || t === "changelog" ? t : "settings";
  };
  const [tab, setTab] = useState<TabId>(() => tabOf(location.search));
  // links from the bell or the menu (?tab=talon) while the page is open
  const search = useSearch();
  useEffect(() => setTab(tabOf(search)), [search]);
  const change = (t: TabId) => {
    setTab(t);
    history.replaceState(null, "", t === "settings" ? location.pathname : `${location.pathname}?tab=${t}`);
  };
  return (
    <>
      <PageHeader title="Updates" description="Talon and the operating system" />
      <div className="mb-5">
        <Tabs value={tab} onChange={change} tabs={TABS} />
      </div>
      {tab === "settings" && <SettingsTab open={change} />}
      {tab === "talon" && <TalonTab />}
      {tab === "system" && <SystemTab />}
      {tab === "changelog" && <ChangelogTab />}
    </>
  );
}

/* ---------------------------------------------------------------- Settings */

function SettingsTab({ open }: { open: (t: TabId) => void }) {
  const talon = useTalon();
  const os = useOs();
  if (!talon.data || !os.data) return <PageLoader />;
  const t = talon.data;
  const o = os.data;
  return (
    <div className="space-y-5">
      <RowCard>
        <StatusRow
          name="Talon"
          detail={`Version ${t.current}`}
          ok={!t.available}
          text={t.available ? `Version ${t.latest} available` : "Up to date"}
          onClick={() => open("talon")}
        />
        <StatusRow
          name="System"
          detail={o.os}
          ok={!o.packages.length && !o.restart_needed}
          text={
            o.packages.length
              ? `${o.packages.length} update${o.packages.length === 1 ? "" : "s"}${o.security ? ` · ${o.security} security` : ""}`
              : o.restart_needed
                ? "Restart to finish"
                : "Up to date"
          }
          onClick={() => open("system")}
        />
      </RowCard>
      <TalonSettings t={t} />
      <SystemSettings o={o} />
    </div>
  );
}

function StatusRow({ name, detail, ok, text, onClick }: { name: string; detail: string; ok: boolean; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-t border-zinc-100 px-5 py-3 text-left transition first:border-t-0 hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-white/[0.03]"
    >
      <span className={cx("size-2.5 shrink-0 rounded-full", ok ? "bg-emerald-500" : "bg-amber-500")} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{name}</span>
        <span className="block text-xs break-words text-zinc-500">{detail}</span>
      </span>
      <span className={cx("text-right text-[13px] font-medium", ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>{text}</span>
      <ChevronRight className="size-4 shrink-0 text-zinc-400" />
    </button>
  );
}

function CheckEvery({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full sm:w-72" aria-label="How often to check">
      {CHECK_EVERY.map(([h, label]) => (
        <option key={h} value={h}>
          {label}
        </option>
      ))}
    </Select>
  );
}

function TalonSettings({ t }: { t: UpdateInfo }) {
  const save = useAction((body: { interval_hours?: number; auto_install?: boolean }) => api.put<UpdateInfo>("/update/settings", body), {
    invalidate: ["update"],
    success: "Saved",
  });
  return (
    <RowCard>
      <Section title="Talon" />
      <Row label="How often to check">
        <CheckEvery value={t.interval_hours} onChange={(h) => save.mutate({ interval_hours: h })} />
      </Row>
      <Row label="Install automatically" hint={t.auto_install ? "A new version installs by itself at night, between 03:00 and 05:00" : "You are told about a new version; nothing installs by itself"}>
        <Segmented
          value={t.auto_install ? "on" : "off"}
          onChange={(v) => save.mutate({ auto_install: v === "on" })}
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
          ]}
        />
      </Row>
    </RowCard>
  );
}

function SystemSettings({ o }: { o: OsInfo }) {
  const auto = useAction((body: Partial<OsInfo["auto"]>) => api.put<OsInfo>("/os-update/auto", body), { invalidate: ["os-update"], success: "Saved" });
  return (
    <RowCard>
      <Section title="System" />
      <Row label="How often to check">
        <CheckEvery value={o.auto.interval_hours} onChange={(h) => auto.mutate({ interval_hours: h })} />
      </Row>
      <Row
        label="Install automatically"
        hint={
          o.auto.mode === "off"
            ? "Nothing installs by itself; you are told about security updates"
            : `Every night, ${o.auto.mode === "all" ? "all updates" : "security updates"} install by themselves; you get an email (with email set up)`
        }
      >
        <Segmented
          value={o.auto.mode}
          onChange={(v) => auto.mutate({ mode: v })}
          options={[
            { value: "off", label: "Off" },
            { value: "security", label: "Security" },
            { value: "all", label: "All" },
          ]}
        />
      </Row>
      <Row
        inline
        className={cx(o.auto.mode === "off" && "opacity-50")}
        label="Restart when needed"
        hint={o.auto.restart ? "At the time set here, only if an update needs it" : "Only if an update needs it; shared folders are unavailable for a minute or two"}
      >
        {o.auto.restart && (
          <div className="w-20">
            <TimeInput value={o.auto.restart_time} onChange={(t) => auto.mutate({ restart_time: t })} />
          </div>
        )}
        <Switch checked={o.auto.restart} disabled={o.auto.mode === "off"} onChange={(v) => auto.mutate({ restart: v })} label="Restart when needed" />
      </Row>
    </RowCard>
  );
}

/* ---------------------------------------------------------------- shared */

/** Check now: the arrows spin while Talon checks. */
function CheckNow({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant="link" disabled={busy} icon={<RefreshCw className={cx("size-3.5", busy && "animate-spin")} />} onClick={onClick}>
      {busy ? "Checking…" : "Check now"}
    </Button>
  );
}

/** Runs once when a tab opens (React's development double-run is ignored). */
function useOnOpen(fn: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    fn();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function Title({ children, badge }: { children: ReactNode; badge: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {children} {badge}
    </span>
  );
}

/* ---------------------------------------------------------------- Talon */

function TalonTab() {
  const q = useTalon();
  const [confirm, setConfirm] = useState(false);
  const check = useAction(() => api.post<UpdateInfo>("/update/check"), { invalidate: ["update"] });
  const install = useAction(() => api.post("/update/install"), { invalidate: ["update-status", "update"], onSuccess: () => setConfirm(false) });
  useOnOpen(() => check.mutate());
  if (!q.data) return <PageLoader />;
  const d = q.data;
  return (
    <RowCard>
      <Section title="Talon" right={<CheckNow busy={check.isPending} onClick={() => check.mutate()} />} />
      <Row
        label={<Title badge={!d.available && <Badge tone="green" dot>Up to date</Badge>}>Installed: Talon {d.current}</Title>}
        hint={check.isPending ? "Checking for a new version…" : d.checked_at ? `Checked ${ago(d.checked_at)}` : "Not checked yet"}
      />
      {d.available && (
        <>
          <Row
            label={<Title badge={<Badge tone="violet">New</Badge>}>Talon {d.latest}</Title>}
            hint={
              <>
                {d.published_at ? `Released ${date(new Date(d.published_at).getTime() / 1000)}` : "Available"}
                {d.url && (
                  <>
                    {" · "}
                    <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400">
                      Release page <ExternalLink className="size-3" />
                    </a>
                  </>
                )}
              </>
            }
          >
            <Button size="sm" variant="primary" icon={<Download className="size-3.5" />} onClick={() => setConfirm(true)}>
              Install
            </Button>
          </Row>
          {d.notes && (
            <RowBlock>
              <ReleaseNotes text={d.notes} />
            </RowBlock>
          )}
        </>
      )}
      {d.error && (
        <RowBlock>
          <Callout tone="warning" title="Could not check for updates">
            {d.error}
          </Callout>
        </RowBlock>
      )}
      {d.status.state === "failed" && (
        <RowBlock>
          <Callout tone="danger" title={`The last update to ${d.status.target} failed and was rolled back`}>
            {d.status.error}
          </Callout>
        </RowBlock>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => install.mutate()}
        loading={install.isPending}
        title={`Install Talon ${d.latest}?`}
        confirmText="Install now"
        message={
          <ul className="list-disc space-y-1 pl-4">
            <li>Takes about 1–3 minutes; the web interface restarts briefly and reloads by itself.</li>
            <li>Shared folders (SMB/NFS) stay available and volumes are not touched.</li>
            <li>The current version is backed up and restored automatically if anything fails.</li>
          </ul>
        }
      />
    </RowCard>
  );
}

function ReleaseNotes({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("**Full Changelog"));
  return (
    <div className="max-h-72 space-y-1 overflow-y-auto text-[13px] text-zinc-600 dark:text-zinc-300">
      {lines.map((l, i) => {
        const t = l
          .replace(/\*\*/g, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/https?:\/\/\S+/g, "")
          .trim();
        if (/^#+\s/.test(l))
          return (
            <div key={i} className="pt-2 font-semibold text-zinc-900 first:pt-0 dark:text-white">
              {t.replace(/^#+\s*/, "")}
            </div>
          );
        if (/^\s*[-*]\s/.test(l))
          return (
            <div key={i} className="flex gap-2">
              <span className="text-brand-500">•</span>
              <span>{t.replace(/^[-*]\s*/, "")}</span>
            </div>
          );
        return <div key={i}>{t}</div>;
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- System */

function SystemTab() {
  const q = useOs();
  const check = useAction(() => api.post<OsInfo>("/os-update/check"), { invalidate: ["os-update"] });
  const install = useAction(() => api.post<OsInfo>("/os-update/install"), { invalidate: ["os-update"], onSuccess: () => setConfirm(false) });
  const reboot = useAction(() => restartNas(), { onSuccess: () => setRestart(false) });
  const [confirm, setConfirm] = useState(false);
  const [restart, setRestart] = useState(false);
  // both lists start closed; a click on a heading opens it
  const [open, setOpen] = useState({ security: false, other: false });
  useOnOpen(() => check.mutate());
  if (!q.data) return <PageLoader />;
  const d = q.data;
  const running = d.progress.state === "running";
  const checking = d.checking.state === "running" || check.isPending;
  const sec = d.packages.filter((p) => p.security);
  const other = d.packages.filter((p) => !p.security);
  const needsRestart = d.packages.some((p) => p.restart);
  // these packages restart their own service when they are updated: connected computers drop for a few seconds
  const sharing = [...new Set(d.packages.flatMap((p) => SHARING.filter(([re]) => re.test(p.name)).map(([, label]) => label)))];
  const sharingNote = sharing.length
    ? `${sharing.join(" and ")} restart${sharing.length === 1 ? "s" : ""} during the update: shared folders are unavailable for a few seconds, and files open on other computers may need to be reopened.`
    : "Shared folders keep working: Samba and NFS are not among these updates.";
  const n = d.packages.length;
  const status = running ? (
    <Badge tone="blue" dot>Installing</Badge>
  ) : checking ? null : n ? (
    <Badge tone="amber" dot>
      {n} update{n === 1 ? "" : "s"}
      {d.security ? ` · ${d.security} security` : ""}
    </Badge>
  ) : (
    <Badge tone="green" dot>Up to date</Badge>
  );

  return (
    <RowCard>
      <Section title="System" right={<CheckNow busy={checking} onClick={() => check.mutate()} />} />
      <Row
        label={<Title badge={status}>{d.os}</Title>}
        hint={
          checking
            ? "Checking for updates…"
            : n && !running
              ? needsRestart
                ? "A restart is needed afterwards"
                : `Checked ${d.checked_at ? ago(d.checked_at) : "just now"}`
              : d.last_install?.ok
                ? `Last updates installed ${ago(d.last_install.at)}`
                : d.checked_at
                  ? `Checked ${ago(d.checked_at)}`
                  : "Not checked yet"
        }
      >
        {n > 0 && !running && !checking && (
          <Button size="sm" variant="primary" icon={<Download className="size-3.5" />} onClick={() => setConfirm(true)}>
            Install all
          </Button>
        )}
      </Row>
      {(running || d.checking.state === "running") && (
        <RowBlock>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 break-words text-zinc-500">
              {running
                ? d.progress.phase === "download"
                  ? "Downloading"
                  : `Updating ${d.progress.package || "…"} · ${Math.min((d.progress.done ?? 0) + 1, d.progress.total ?? 1)} of ${d.progress.total}`
                : d.checking.text}
            </span>
            <span className="tabular font-semibold text-zinc-500">{Math.round((running ? d.progress.percent : d.checking.percent) ?? 0)}%</span>
          </div>
          <Progress value={(running ? d.progress.percent : d.checking.percent) ?? 0} className="mt-2 h-2" />
          {running && <p className="mt-2 text-xs text-zinc-500">{sharingNote} You can leave this page; the installation continues.</p>}
        </RowBlock>
      )}
      {d.error && !checking && (
        <RowBlock>
          <Callout tone="warning" title="Could not check for updates">
            {d.error}
          </Callout>
        </RowBlock>
      )}
      {d.progress.state === "error" && !running && (
        <RowBlock>
          <Callout tone="danger" title="Installing the updates failed">
            {d.progress.error}
          </Callout>
        </RowBlock>
      )}
      {d.restart_needed && !running && (
        <Row className="bg-amber-50/60 dark:bg-amber-500/10" label="Restart to finish" hint="Some updates, such as a new Linux kernel, are only used after a restart">
          <Button size="sm" variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={() => setRestart(true)}>
            Restart now
          </Button>
        </Row>
      )}
      {n > 0 && !running && !checking && (
        <>
          {sec.length > 0 && (
            <>
              <PkgHeader
                icon={<ShieldAlert className="size-4" />}
                tone="security"
                title={`Security updates · ${sec.length}`}
                text="Fix known security holes; install these soon"
                open={open.security}
                onToggle={() => setOpen({ ...open, security: !open.security })}
              />
              {open.security && <PkgList pkgs={sec} />}
            </>
          )}
          {other.length > 0 && (
            <>
              <PkgHeader
                icon={<Package className="size-4" />}
                tone="other"
                title={`Other updates · ${other.length}`}
                text="Bug fixes and improvements"
                open={open.other}
                onToggle={() => setOpen({ ...open, other: !open.other })}
              />
              {open.other && <PkgList pkgs={other} />}
            </>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => install.mutate()}
        loading={install.isPending}
        title={`Install ${n} update${n === 1 ? "" : "s"}?`}
        confirmText="Install"
        message={`${sharingNote} Configuration files you changed are kept.${needsRestart ? " The NAS needs a restart afterwards." : ""}`}
      />
      <ConfirmDialog
        open={restart}
        onClose={() => setRestart(false)}
        onConfirm={() => reboot.mutate()}
        loading={reboot.isPending}
        title="Restart the NAS?"
        confirmText="Restart"
        message="Shared folders and this web interface are unavailable for a minute or two."
      />
    </RowCard>
  );
}

/** The heading of a group of package updates: what kind they are and why it matters; a click shows the list. */
function PkgHeader({
  icon,
  tone,
  title,
  text,
  open,
  onToggle,
}: {
  icon: ReactNode;
  tone: "security" | "other";
  title: string;
  text: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cx(
        "flex w-full items-center gap-3 border-t px-5 py-2.5 text-left transition hover:brightness-[0.98]",
        tone === "security"
          ? "border-rose-100 bg-rose-50/70 dark:border-rose-400/10 dark:bg-rose-500/10"
          : "border-amber-100 bg-amber-50/70 dark:border-amber-400/10 dark:bg-amber-500/10",
      )}
    >
      <span
        className={cx(
          "flex size-7 shrink-0 items-center justify-center rounded-lg",
          tone === "security" ? "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300" : "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cx("block text-[13.5px] font-semibold", tone === "security" ? "text-rose-700 dark:text-rose-300" : "text-amber-700 dark:text-amber-300")}>
          {title}
        </span>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{text}</span>
      </span>
      <ChevronDown
        className={cx("ml-auto size-4 shrink-0 transition", open && "rotate-180", tone === "security" ? "text-rose-500" : "text-amber-500")}
      />
    </button>
  );
}

/** Packages whose update restarts a file-sharing service (their install scripts restart it). */
const SHARING: [RegExp, string][] = [
  [/^samba$/, "Samba (SMB)"],
  [/^nfs-kernel-server$/, "NFS"],
];

function PkgList({ pkgs }: { pkgs: Pkg[] }) {
  return (
    <ul>
      {pkgs.map((p) => (
        <li key={p.name} className="flex items-center gap-3 border-t border-zinc-100 px-5 py-2 dark:border-white/5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium break-words">{p.name}</div>
            <div className="font-mono text-[11.5px] break-all text-zinc-500">{p.old ? `${p.old} → ${p.new}` : `new: ${p.new}`}</div>
          </div>
          {p.restart && <span className="text-[11.5px] whitespace-nowrap text-amber-600 dark:text-amber-400">Needs a restart</span>}
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- Changelog */

type Release = { version: string; date: number | null; items: string[] };
type Changelog = { current: string; versions: Release[]; error: string | null };

/** 1.0.12 → [1, 0, 12]; newer(a, b): a is a later version than b */
const parts = (v: string) => v.split(".").map((x) => parseInt(x, 10) || 0);
const newer = (a: string, b: string) => {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/** "Today", "Yesterday" or the date, for a day heading */
function dayLabel(ts: number): { name: string; date: string } {
  const d = new Date(ts * 1000);
  const t = new Date();
  const days = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  const name = days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long" });
  return { name: days < 7 ? name : "", date: date(ts) };
}

const PER_PAGE = [10, 25, 50, 100];

/** Every Talon version and what it changed, by day, newest first; or only the versions after the installed one. A page at a time. */
function ChangelogTab() {
  const q = useQuery({ queryKey: ["update-changelog"], queryFn: () => api.get<Changelog>("/update/changelog"), staleTime: 300_000 });
  const [since, setSince] = useState<"all" | "since">("all");
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [since, perPage]);
  if (!q.data) return <PageLoader />;
  const { current, versions, error } = q.data;
  const list = since === "since" ? versions.filter((v) => newer(v.version, current)) : versions;
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const at = Math.min(page, pages - 1);
  const shown = list.slice(at * perPage, (at + 1) * perPage);
  // consecutive versions released on the same day share a heading; undated ones one at the end
  const groups: { key: string; head: { name: string; date: string } | null; items: Release[] }[] = [];
  for (const v of shown) {
    const head = v.date ? dayLabel(v.date) : null;
    const key = head ? head.date : "undated";
    if (groups.at(-1)?.key === key) groups.at(-1)!.items.push(v);
    else groups.push({ key, head, items: [v] });
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={since}
          onChange={setSince}
          options={[
            { value: "all", label: "All versions" },
            { value: "since", label: `Since ${current}` },
          ]}
        />
        {error && <span className="text-xs text-zinc-500">Dates appear when Talon can reach GitHub.</span>}
      </div>
      {list.length === 0 ? (
        <RowCard>
          <div className="px-5 py-8 text-center text-[13.5px] text-zinc-500">
            {since === "since" ? `Nothing newer than ${current}: Talon is up to date.` : "The changelog is not available."}
          </div>
        </RowCard>
      ) : (
        groups.map((g) => (
          <section key={g.key}>
            <h3 className="mb-2 ml-0.5 text-xs font-semibold tracking-wider text-zinc-500 uppercase">
              {g.head ? (
                <>
                  {g.head.name || g.head.date}
                  {g.head.name && <span className="ml-1.5 font-medium tracking-normal text-zinc-400 normal-case">{g.head.date}</span>}
                </>
              ) : (
                "Date not known"
              )}
            </h3>
            <RowCard>
              <div className="divide-y divide-zinc-100 dark:divide-white/5">
                {g.items.map((v) => (
                  <div key={v.version} className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-zinc-700 dark:bg-white/10 dark:text-zinc-200">{v.version}</span>
                      {v.version === current ? <Badge tone="green">Installed</Badge> : newer(v.version, current) ? <Badge tone="blue">New</Badge> : null}
                      {v.date && <span className="tabular ml-auto text-xs text-zinc-400">{clock(v.date)}</span>}
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {v.items.map((it, i) => (
                        <li key={i} className="relative pl-3.5 text-[13.5px] leading-relaxed text-zinc-700 before:absolute before:top-[9px] before:left-0.5 before:size-[5px] before:rounded-full before:bg-brand-300 dark:text-zinc-300 dark:before:bg-brand-400/60">
                          {it}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </RowCard>
          </section>
        ))
      )}
      {list.length > PER_PAGE[0] && (
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-[13px] whitespace-nowrap text-zinc-500">
            Per page
            <Select value={String(perPage)} onChange={(e) => setPerPage(Number(e.target.value))} className="text-[13px]" style={{ width: "5.5rem" }}>
              {PER_PAGE.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
          </label>
          <span className="tabular text-[13px] text-zinc-500">
            {at * perPage + 1}–{Math.min((at + 1) * perPage, list.length)} of {list.length}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" icon={<ChevronLeft className="size-4" />} disabled={at === 0} onClick={() => setPage(at - 1)}>
              Prev
            </Button>
            <Button size="sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
