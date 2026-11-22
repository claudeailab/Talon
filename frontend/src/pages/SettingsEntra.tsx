import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Copy, KeyRound, PlugZap } from "lucide-react";
import { api } from "../lib/api";
import { dmyToIso, isoToDmy } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { EntraCheck, EntraConfig } from "../lib/types";
import { TestResult } from "../components/testresult";
import { Badge, Button, Card, CardHeader, DateInput, Field, Input, Modal, PageLoader, Select, useToast } from "../components/ui";

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
    setExpires(isoToDmy(q.data.secret_expires));
    setRemindDays(q.data.remind_days);
    setRemindTo(q.data.remind_to.join(", "));
  }, [q.data]);
  const tenant = tenantId.trim();
  const expiresIso = expires.trim() === "" ? "" : dmyToIso(expires);
  const body = { tenant, client_id: clientId.trim(), client_secret: secret };
  const save = useAction(() => api.put<EntraConfig>("/settings/entra", { ...body, origin: location.origin, secret_expires: expiresIso ?? "", remind_days: remindDays, remind_to: remindTo }), {
    success: "EntraID app saved",
    invalidate: ["entra", "onedrive"],
  });
  const test = useAction(() => api.post<{ checks: EntraCheck[] }>("/settings/entra/test", { config: body, origin: location.origin }), {
    onSuccess: (r) => setChecks(r.checks),
  });
  if (!q.data) return <PageLoader />;
  const recipients = remindTo.split(/[\s,;]+/).filter(Boolean);
  const expiresBad = expires.trim() !== "" && !expiresIso;
  const changed =
    tenant !== q.data.tenant ||
    clientId.trim() !== q.data.client_id ||
    secret !== "" ||
    (expiresIso ?? expires) !== q.data.secret_expires ||
    remindDays !== q.data.remind_days ||
    recipients.join(",") !== q.data.remind_to.join(",");

  return (
    <div className="space-y-5">
    <Card>
      <CardHeader
        icon={<KeyRound className="size-4.5" />}
        title={
          <span className="flex items-center gap-2">
            EntraID App {q.data.configured ? <Badge tone="green" dot>Configured</Badge> : <Badge dot>Not configured</Badge>}
          </span>
        }
        subtitle="Microsoft sign-in used by OneDrive"
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" icon={<BookOpen className="size-4" />} onClick={() => setGuide(true)}>
              Setup guide
            </Button>
            <Button icon={<PlugZap className="size-4" />} loading={test.isPending} onClick={() => test.mutate()}>
              Test
            </Button>
            <Button variant="primary" disabled={!changed || expiresBad || !tenant} loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        }
      />
      <div className="grid gap-x-8 gap-y-4 px-5 pb-5 md:grid-cols-2 [&>*]:min-w-0">
        <Field label="Application (client) ID">
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-[13px]" />
        </Field>
        <Field label="Directory (tenant) ID">
          <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-[13px]" />
        </Field>
        <Field label="Client secret value" hint={q.data.secret_set ? "Saved. Leave empty to keep it." : "Not saved yet"}>
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={q.data.secret_set ? "••••••••••••" : ""} autoComplete="new-password" />
        </Field>
        <Field label="Redirect URI">
          <CopyField value={redirectUri()} />
        </Field>
      </div>
      <div className="border-t border-zinc-100 px-5 pt-4 pb-5 dark:border-white/5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          Client secret expiry <ExpiryBadge expiry={q.data.expiry} />
        </div>
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-3 [&>*]:min-w-0">
          <Field label="Secret expires on" error={expiresBad ? "Enter the date as dd-mm-yyyy" : null}>
            <DateInput value={expires} onChange={setExpires} />
          </Field>
          <Field label="Send a reminder">
            <Select value={remindDays} onChange={(e) => setRemindDays(Number(e.target.value))}>
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} days before
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Send the reminder to"
            hint={smtp.data && !smtp.data.configured ? <span className="text-amber-600 dark:text-amber-400">Set up SMTP first</span> : undefined}
          >
            <Input value={remindTo} onChange={(e) => setRemindTo(e.target.value)} placeholder="it@example.com, me@example.com" />
          </Field>
        </div>
      </div>
      {checks && <TestResult checks={checks} />}
      {guide && <SetupGuide onClose={() => setGuide(false)} />}
    </Card>
    </div>
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
    <Modal open onClose={onClose} size="lg" title="Set up the EntraID app" description="One-time setup, about 5 minutes" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
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
            <B>App registrations</B> → <B>New registration</B>, name it <B>Talon NAS</B>.
          </p>
          <p>
            Supported account types: <B>Accounts in any organizational directory and personal Microsoft accounts</B>. Then work, school and personal OneDrive all work.
          </p>
          <p>
            Redirect URI: platform <B>Web</B>, paste this address, then click <B>Register</B>.
          </p>
          <CopyField value={redirectUri()} />
        </Step>
        <Step n={3} title="Copy the two IDs">
          <p>
            From the app's <B>Overview</B> page, copy the <B>Application (client) ID</B> and the <B>Directory (tenant) ID</B> into Talon.
          </p>
        </Step>
        <Step n={4} title="Create a client secret">
          <p>
            <B>Certificates & secrets</B> → <B>New client secret</B>, expiry <B>24 months</B>.
          </p>
          <p>
            Copy the secret <B>Value</B> (not the Secret ID) into Talon. It is shown once. Enter its <B>Expires</B> date under <B>Secret expires on</B>.
          </p>
        </Step>
        <Step n={5} title="Add the permissions">
          <p>
            <B>API permissions</B> → <B>Add a permission</B> → <B>Microsoft Graph</B> → <B>Delegated permissions</B>: add <B>Files.ReadWrite</B> and <B>offline_access</B>.
          </p>
          <p>
            For <B>Users → EntraID Users</B>: <B>Add a permission</B> → <B>Microsoft Graph</B> → <B>Application permissions</B>: add <B>User.Read.All</B>, then click <B>Grant admin consent</B>.
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

