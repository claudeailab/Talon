import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { BookOpen, Copy, PlugZap } from "lucide-react";
import { api } from "../lib/api";
import { dateFormat, dateToIso, isoToDate } from "../lib/format";
import { useAction, useDraft } from "../lib/hooks";
import type { EntraCheck, EntraConfig } from "../lib/types";
import { TestResult } from "../components/testresult";
import { Badge, Button, DateInput, Modal, PageLoader, Select, useToast } from "../components/ui";
import { Row, RowCard, SaveBar, Section } from "../components/rows";
import { TextField } from "../components/field";

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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
type Draft = { client_id: string; tenant: string; client_secret: string; expires: string; remind_days: number; remind_to: string };
type Body = { tenant: string; client_id: string; client_secret: string; secret_expires: string; remind_days: number; remind_to: string[] };
const split = (v: string) => v.split(/[\s,;]+/).filter(Boolean);

/** Settings → Entra ID: the app registration. Changes are kept until Save. */
export default function EntraTab() {
  const q = useQuery({ queryKey: ["entra"], queryFn: () => api.get<EntraConfig>("/settings/entra") });
  const smtp = useQuery({ queryKey: ["smtp"], queryFn: () => api.get<{ configured: boolean }>("/settings/smtp") });
  const [guide, setGuide] = useState(false);
  const [checks, setChecks] = useState<EntraCheck[] | null>(null);
  const d = q.data;
  const { draft: f, dirty, set, reset } = useDraft<Draft>(
    d && {
      client_id: d.client_id,
      tenant: GUID.test(d.tenant) ? d.tenant : "",
      client_secret: "",
      expires: isoToDate(d.secret_expires),
      remind_days: d.remind_days,
      remind_to: d.remind_to.join(", "),
    },
  );
  const save = useAction((body: Body) => api.put<EntraConfig>("/settings/entra", { ...body, origin: location.origin }), {
    success: "Entra ID settings saved",
    invalidate: ["entra", "onedrive"],
    onSuccess: () => set("client_secret", ""),
  });
  // tests what is saved (fields left out use the saved values)
  const test = useAction(() => api.post<{ checks: EntraCheck[] }>("/settings/entra/test", { config: {}, origin: location.origin }), {
    onSuccess: (r) => setChecks(r.checks),
  });
  if (!d || !f) return <PageLoader />;
  const guid = (v: string) => (!v || GUID.test(v) ? null : "Looks like 00000000-0000-0000-0000-000000000000");
  const iso = f.expires.trim() === "" ? "" : dateToIso(f.expires);
  const err = {
    client_id: guid(f.client_id),
    tenant: guid(f.tenant),
    expires: iso === null ? `Enter the date as ${dateFormat()}` : null,
    remind_to: split(f.remind_to).every((x) => EMAIL_RE.test(x)) ? null : "Enter email addresses, separated by commas",
  };
  const secretSet = d.secret_set || !!f.client_secret;
  const problem = err.client_id
    ? "The application (client) ID is not valid"
    : err.tenant
      ? "The directory (tenant) ID is not valid"
      : f.client_id && !secretSet
        ? "Enter the client secret value"
        : !f.client_id && (f.tenant || f.client_secret)
          ? "Enter the application (client) ID"
          : err.expires
            ? "The expiry date is not valid"
            : err.remind_to
              ? "The reminder addresses are not valid"
              : null;
  const body: Body = {
    tenant: f.tenant || "common",
    client_id: f.client_id,
    client_secret: f.client_secret,
    secret_expires: iso ?? "",
    remind_days: f.remind_days,
    remind_to: split(f.remind_to),
  };
  const W = "w-full sm:w-80";
  const mono = "font-mono text-[13px]";
  const zero = "00000000-0000-0000-0000-000000000000";

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
            <Button size="sm" variant="link" icon={<PlugZap className="size-3.5" />} disabled={dirty || !d.configured} title={dirty ? "Save first" : undefined} loading={test.isPending} onClick={() => test.mutate()}>
              Test
            </Button>
          </>
        }
      />
      <Row label="Application (client) ID">
        <TextField value={f.client_id} onChange={(v) => set("client_id", v.trim())} error={err.client_id} placeholder={zero} width={W} className={mono} aria-label="Application (client) ID" />
      </Row>
      <Row label="Directory (tenant) ID">
        <TextField value={f.tenant} onChange={(v) => set("tenant", v.trim())} error={err.tenant} placeholder={zero} width={W} className={mono} aria-label="Directory (tenant) ID" />
      </Row>
      <Row label="Redirect URI" hint={<span className="font-mono break-all">{redirectUri()}</span>}>
        <CopyButton value={redirectUri()} />
      </Row>
      <Section title="Client secret" badge={<ExpiryBadge expiry={d.expiry} />} />
      <Row label="Value" hint={d.secret_set ? "Saved. Type a new one to change it." : "Not saved yet"}>
        <TextField type="password" value={f.client_secret} onChange={(v) => set("client_secret", v.trim())} placeholder={d.secret_set ? "••••••••••••" : ""} autoComplete="new-password" width={W} className={mono} aria-label="Client secret value" />
      </Row>
      <Row label="Expires on" hint="Shown in Entra next to the secret">
        <div className="w-full sm:w-44">
          <DateInput value={f.expires} onChange={(v) => set("expires", v)} />
          {err.expires && <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{err.expires}</div>}
        </div>
      </Row>
      <Row
        label="Reminder"
        hint={smtp.data && !smtp.data.configured ? <span className="text-amber-600 dark:text-amber-400">Set up SMTP first, under Notifications</span> : "An email before the secret expires"}
      >
        <Select value={f.remind_days} onChange={(e) => set("remind_days", Number(e.target.value))} className="w-full sm:w-44" aria-label="Send a reminder">
          {[7, 14, 30, 60, 90].map((n) => (
            <option key={n} value={n}>
              {n} days before
            </option>
          ))}
        </Select>
        <TextField value={f.remind_to} onChange={(v) => set("remind_to", v)} error={err.remind_to} placeholder="it@example.com" width="w-full sm:w-56" aria-label="Send the reminder to" />
      </Row>
      {checks && <TestResult checks={checks} />}
      <SaveBar dirty={dirty} problem={problem} onDiscard={reset} loading={save.isPending} onSave={() => save.mutate(body)} />
      {guide && <SetupGuide onClose={() => setGuide(false)} />}
    </RowCard>
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
            Click <B>Save</B>, then <B>Test</B>.
          </p>
        </Step>
      </ol>
    </Modal>
  );
}

