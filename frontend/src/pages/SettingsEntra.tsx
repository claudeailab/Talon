import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Copy, PlugZap } from "lucide-react";
import { api } from "../lib/api";
import { dateFormat, dateToIso, isoToDate } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { EntraCheck, EntraConfig } from "../lib/types";
import { TestResult } from "../components/testresult";
import { Badge, Button, DateInput, Input, Modal, PageLoader, Select, useToast } from "../components/ui";
import { Row, RowCard, SaveBar, Section } from "../components/rows";

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

export default function EntraTab() {
  const q = useQuery({ queryKey: ["entra"], queryFn: () => api.get<EntraConfig>("/settings/entra") });
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [expires, setExpires] = useState("");
  const [remindDays, setRemindDays] = useState(30);
  const [remindTo, setRemindTo] = useState("");
  const smtp = useQuery({ queryKey: ["smtp"], queryFn: () => api.get<{ configured: boolean }>("/settings/smtp") });
  const [guide, setGuide] = useState(false);
  const [checks, setChecks] = useState<EntraCheck[] | null>(null);
  useEffect(() => {
    if (!q.data) return;
    setTenantId(GUID.test(q.data.tenant) ? q.data.tenant : "");
    setClientId(q.data.client_id);
    setSecret("");
    setExpires(isoToDate(q.data.secret_expires));
    setRemindDays(q.data.remind_days);
    setRemindTo(q.data.remind_to.join(", "));
  }, [q.data]);
  const tenant = tenantId.trim();
  const expiresIso = expires.trim() === "" ? "" : dateToIso(expires);
  const body = { tenant, client_id: clientId.trim(), client_secret: secret };
  const save = useAction(() => api.put<EntraConfig>("/settings/entra", { ...body, origin: location.origin, secret_expires: expiresIso ?? "", remind_days: remindDays, remind_to: remindTo }), {
    success: "Entra ID app saved",
    invalidate: ["entra", "onedrive"],
  });
  const test = useAction(() => api.post<{ checks: EntraCheck[] }>("/settings/entra/test", { config: body, origin: location.origin }), {
    onSuccess: (r) => setChecks(r.checks),
  });
  if (!q.data) return <PageLoader />;
  const recipients = remindTo.split(/[\s,;]+/).filter(Boolean);
  const expiresBad = expires.trim() !== "" && !expiresIso;
  const changed =
    tenant !== (GUID.test(q.data.tenant) ? q.data.tenant : "") ||
    clientId.trim() !== q.data.client_id ||
    secret !== "" ||
    (expiresIso ?? expires) !== q.data.secret_expires ||
    remindDays !== q.data.remind_days ||
    recipients.join(",") !== q.data.remind_to.join(",");

  const W = "w-full font-mono text-[13px] sm:w-80";
  const discard = () => {
    setTenantId(GUID.test(q.data!.tenant) ? q.data!.tenant : "");
    setClientId(q.data!.client_id);
    setSecret("");
    setExpires(isoToDate(q.data!.secret_expires));
    setRemindDays(q.data!.remind_days);
    setRemindTo(q.data!.remind_to.join(", "));
  };

  return (
    <RowCard>
      <Section
        title="App registration"
        badge={q.data.configured ? <Badge tone="green" dot>Configured</Badge> : <Badge dot>Not configured</Badge>}
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
        <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className={W} aria-label="Application (client) ID" />
      </Row>
      <Row label="Directory (tenant) ID">
        <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className={W} aria-label="Directory (tenant) ID" />
      </Row>
      <Row label="Redirect URI" hint={<span className="font-mono break-all">{redirectUri()}</span>}>
        <CopyButton value={redirectUri()} />
      </Row>
      <Section
        title="Client secret"
        badge={<ExpiryBadge expiry={q.data.expiry} />}
      />
      <Row label="Value" hint={q.data.secret_set ? "Saved. Leave empty to keep it." : "Not saved yet"}>
        <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={q.data.secret_set ? "••••••••••••" : ""} autoComplete="new-password" className={W} aria-label="Client secret value" />
      </Row>
      <Row label="Expires on" hint={expiresBad ? <span className="text-rose-600 dark:text-rose-400">Enter the date as {dateFormat()}</span> : "Shown in Entra next to the secret"}>
        <DateInput value={expires} onChange={setExpires} className="w-full sm:w-44" />
      </Row>
      <Row
        label="Reminder"
        hint={smtp.data && !smtp.data.configured ? <span className="text-amber-600 dark:text-amber-400">Set up SMTP first, under Notifications</span> : "An email before the secret expires"}
      >
        <Select value={remindDays} onChange={(e) => setRemindDays(Number(e.target.value))} className="w-full sm:w-44" aria-label="Send a reminder">
          {[7, 14, 30, 60, 90].map((d) => (
            <option key={d} value={d}>
              {d} days before
            </option>
          ))}
        </Select>
        <Input value={remindTo} onChange={(e) => setRemindTo(e.target.value)} placeholder="it@example.com" className="w-full sm:w-56" aria-label="Send the reminder to" />
      </Row>
      {checks && <TestResult checks={checks} />}
      <SaveBar show={changed} onDiscard={discard} disabled={expiresBad || !tenant} loading={save.isPending} onSave={() => save.mutate()} />
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

