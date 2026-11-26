import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Copy, PlugZap } from "lucide-react";
import { api } from "../lib/api";
import { dateFormat, dateToIso, isoToDate } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { EntraCheck, EntraConfig } from "../lib/types";
import { TestResult } from "../components/testresult";
import { Badge, Button, DateInput, Modal, PageLoader, Select, useToast } from "../components/ui";
import { Row, RowCard, Section } from "../components/rows";
import { AutoField } from "../components/autosave";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const redirectUri = () => `${location.origin}/api/onedrive/callback`;

export function CopyField({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className="flex items-start gap-2">
      {/* plain text, not a field: shown in full (it wraps) and never takes the focus */}
      <code className="min-h-10 min-w-0 flex-1 rounded-xl bg-zinc-50 px-3.5 py-2.5 font-mono text-[13px] break-all select-all ring-1 ring-zinc-200 ring-inset dark:bg-white/[0.04] dark:ring-white/10">
        {value}
      </code>
      <Button
        icon={<Copy className="size-4" />}
        onClick={() => navigator.clipboard?.writeText(value).then(() => toast("success", "Copied"), () => toast("error", "Copy failed"))}
      >
        Copy
      </Button>
    </div>
  );
}

/** Settings → Entra ID: the app registration. Each field saves by itself. */
export default function EntraTab() {
  const q = useQuery({ queryKey: ["entra"], queryFn: () => api.get<EntraConfig>("/settings/entra") });
  const smtp = useQuery({ queryKey: ["smtp"], queryFn: () => api.get<{ configured: boolean }>("/settings/smtp") });
  const [guide, setGuide] = useState(false);
  const [checks, setChecks] = useState<EntraCheck[] | null>(null);
  type Body = { tenant: string; client_id: string; client_secret: string; secret_expires: string; remind_days: number; remind_to: string[] };
  const save = useAction((body: Body) => api.put<EntraConfig>("/settings/entra", { ...body, origin: location.origin }), {
    success: "Saved",
    invalidate: ["entra", "onedrive"],
  });
  // tests what is saved (fields left out use the saved values)
  const test = useAction(() => api.post<{ checks: EntraCheck[] }>("/settings/entra/test", { config: {}, origin: location.origin }), {
    onSuccess: (r) => setChecks(r.checks),
  });
  if (!q.data) return <PageLoader />;
  const d = q.data;
  const saved: Body = { tenant: d.tenant, client_id: d.client_id, client_secret: "", secret_expires: d.secret_expires, remind_days: d.remind_days, remind_to: d.remind_to };
  const put = (patch: Partial<Body>) => save.mutateAsync({ ...saved, ...patch });
  const guid = (v: string) => (!v || GUID.test(v) ? null : "Looks like 00000000-0000-0000-0000-000000000000");
  const W = "w-full sm:w-80";
  const split = (v: string) => v.split(/[\s,;]+/).filter(Boolean);

  return (
    <RowCard>
      <Section
        title="App registration"
        badge={d.configured ? <Badge tone="green" dot>Configured</Badge> : <Badge dot>Not configured</Badge>}
        right={
          <>
            <Button size="sm" variant="link" icon={<BookOpen className="size-3.5" />} onClick={() => setGuide(true)}>
              Setup guide
            </Button>
            <Button size="sm" variant="link" icon={<PlugZap className="size-3.5" />} loading={test.isPending} onClick={() => test.mutate()}>
              Test
            </Button>
          </>
        }
      />
      <Row label="Application (client) ID">
        <AutoField value={d.client_id} onSave={(v) => put({ client_id: v })} filter={(v) => v.trim()} validate={guid} placeholder="00000000-0000-0000-0000-000000000000" width={W} className="font-mono text-[13px]" aria-label="Application (client) ID" />
      </Row>
      <Row label="Directory (tenant) ID">
        <AutoField
          value={GUID.test(d.tenant) ? d.tenant : ""}
          onSave={(v) => put({ tenant: v || "common" })}
          filter={(v) => v.trim()}
          validate={guid}
          placeholder="00000000-0000-0000-0000-000000000000"
          width={W}
          className="font-mono text-[13px]"
          aria-label="Directory (tenant) ID"
        />
      </Row>
      <Row label="Redirect URI" hint={<span className="font-mono break-all">{redirectUri()}</span>}>
        <CopyButton value={redirectUri()} />
      </Row>
      <Section title="Client secret" badge={<ExpiryBadge expiry={d.expiry} />} />
      <Row label="Value" hint={d.secret_set ? "Saved. Type a new one to change it." : "Not saved yet"}>
        <AutoField value="" secret onSave={(v) => put({ client_secret: v })} placeholder={d.secret_set ? "••••••••••••" : ""} autoComplete="new-password" width={W} className="font-mono text-[13px]" aria-label="Client secret value" />
      </Row>
      <Row label="Expires on" hint="Shown in Entra next to the secret">
        <ExpiryField saved={d.secret_expires} onSave={(iso) => put({ secret_expires: iso })} />
      </Row>
      <Row
        label="Reminder"
        hint={smtp.data && !smtp.data.configured ? <span className="text-amber-600 dark:text-amber-400">Set up SMTP first, under Notifications</span> : "An email before the secret expires"}
      >
        <Select value={d.remind_days} onChange={(e) => put({ remind_days: Number(e.target.value) })} className="w-full sm:w-44" aria-label="Send a reminder">
          {[7, 14, 30, 60, 90].map((n) => (
            <option key={n} value={n}>
              {n} days before
            </option>
          ))}
        </Select>
        <AutoField
          value={d.remind_to.join(", ")}
          onSave={(v) => put({ remind_to: split(v) })}
          validate={(v) => (split(v).every((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) ? null : "Enter email addresses, separated by commas")}
          placeholder="it@example.com"
          width="w-full sm:w-56"
          aria-label="Send the reminder to"
        />
      </Row>
      {checks && <TestResult checks={checks} />}
      {guide && <SetupGuide onClose={() => setGuide(false)} />}
    </RowCard>
  );
}

/** The secret's expiry date: saves once a whole date is typed or picked, or when it is cleared. */
function ExpiryField({ saved, onSave }: { saved: string; onSave: (iso: string) => Promise<unknown> }) {
  const [text, setText] = useState(isoToDate(saved));
  useEffect(() => setText(isoToDate(saved)), [saved]);
  const iso = text.trim() === "" ? "" : dateToIso(text);
  useEffect(() => {
    if (iso === null || iso === saved) return;
    const t = setTimeout(() => onSave(iso).catch(() => undefined), 700);
    return () => clearTimeout(t);
  }, [iso]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="w-full sm:w-44">
      <DateInput value={text} onChange={setText} />
      {iso === null && <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">Enter the date as {dateFormat()}</div>}
    </div>
  );
}

/** A small Copy button for a value shown next to it. */
function CopyButton({ value }: { value: string }) {
  const toast = useToast();
  return (
    <Button
      size="sm"
      icon={<Copy className="size-3.5" />}
      onClick={() => navigator.clipboard?.writeText(value).then(() => toast("success", "Copied"), () => toast("error", "Copy failed"))}
    >
      Copy
    </Button>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1 pb-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 space-y-1.5 text-[13px] text-zinc-600 dark:text-zinc-400">{children}</div>
      </div>
    </li>
  );
}

function B({ children }: { children: ReactNode }) {
  return <b className="font-semibold text-zinc-900 dark:text-zinc-100">{children}</b>;
}

function ExpiryBadge({ expiry }: { expiry: EntraConfig["expiry"] }) {
  if (!expiry) return <Badge dot>Not set</Badge>;
  const d = expiry.days;
  const text = d < 0 ? "Expired" : d === 0 ? "Expires today" : d === 1 ? "Expires tomorrow" : `Expires in ${d} days`;
  return (
    <Badge tone={d < 0 ? "red" : expiry.remind ? "amber" : "green"} dot>
      {text}
    </Badge>
  );
}

export function SetupGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="lg" title="Set up the Entra ID app" description="One-time setup, about 5 minutes" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <ol className="space-y-4">
        <Step n={1} title="Open the Entra admin center">
          <p>
            Go to{" "}
            <a className="font-medium text-brand-600 hover:underline dark:text-brand-400" href="https://entra.microsoft.com" target="_blank" rel="noreferrer">
              entra.microsoft.com
            </a>{" "}
            and sign in.
          </p>
        </Step>
        <Step n={2} title="Register the app">
          <p>
            <B>App registrations</B> → <B>New registration</B>, name it <B>Talon</B>.
          </p>
          <div>
            <p>Supported account types:</p>
            <p>
              <B>Any Entra ID Tenant + Personal Microsoft accounts</B>
            </p>
          </div>
          <p>
            Redirect URI: platform <B>Web</B>, paste this address, then click <B>Register</B>.
          </p>
          <CopyField value={redirectUri()} />
        </Step>
        <Step n={3} title="Copy the two IDs">
          <p>
            From the <B>Overview</B> page, copy the <B>Application (client) ID</B> and the <B>Directory (tenant) ID</B> into Talon.
          </p>
        </Step>
        <Step n={4} title="Add the permissions">
          <div>
            <p>
              <B>API permissions</B> → <B>Add a permission</B> → <B>Microsoft Graph</B> → <B>Delegated permissions</B>
            </p>
            <p>
              Add: <B>Files.ReadWrite</B> and <B>offline_access</B> (Allows OneDrive Sync)
            </p>
          </div>
          <div>
            <p>
              <B>API permissions</B> → <B>Add a permission</B> → <B>Microsoft Graph</B> → <B>Application permissions</B>
            </p>
            <p>
              Add: <B>User.Read.All</B> (Allows Entra ID users to access Talon web interface)
            </p>
          </div>
          <p>
            Click <B>Grant admin consent</B>.
          </p>
        </Step>
        <Step n={5} title="Create a client secret">
          <p>
            <B>Certificates & secrets</B> → <B>New client secret</B>, expiry <B>24 months</B>.
          </p>
          <p>
            Copy the secret <B>Value</B> (not the Secret ID) into Talon. It is shown once.
          </p>
          <p>
            In Talon, enter its <B>Expires</B> date under <B>Expires on</B>.
          </p>
        </Step>
        <Step n={6} title="Save and test in Talon">
          <p>
            Each field saves by itself; click <B>Test</B>.
          </p>
        </Step>
      </ol>
    </Modal>
  );
}

