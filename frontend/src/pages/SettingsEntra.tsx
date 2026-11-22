import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Copy, KeyRound, PlugZap } from "lucide-react";
import { api } from "../lib/api";
import { cx, dmyToIso, isoToDmy } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { EntraCheck, EntraConfig } from "../lib/types";
import { TestResult } from "../components/testresult";
import { Badge, Button, Card, CardHeader, DateInput, Field, Input, Modal, PageLoader, Select, useToast } from "../components/ui";

type Kind = "work" | "personal" | "";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kindOf = (tenant: string): Kind => (tenant === "consumers" ? "personal" : GUID.test(tenant) ? "work" : "");

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
  const [kind, setKind] = useState<Kind>("");
  const [org, setOrg] = useState("");          // work or school: email domain or tenant ID
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
    const t = q.data.tenant;
    setKind(kindOf(t));
    setOrg(GUID.test(t) ? q.data.domain || t : "");
    setClientId(q.data.client_id);
    setSecret("");
    setExpires(isoToDmy(q.data.secret_expires));
    setRemindDays(q.data.remind_days);
    setRemindTo(q.data.remind_to.join(", "));
  }, [q.data]);
  const tenant = kind === "personal" ? "consumers" : kind === "work" ? org.trim() : "";
  const expiresIso = expires.trim() === "" ? "" : dmyToIso(expires);
  const body = { tenant, client_id: clientId.trim(), client_secret: secret };
  const save = useAction(() => api.put<EntraConfig>("/settings/entra", { ...body, secret_expires: expiresIso ?? "", remind_days: remindDays, remind_to: remindTo }), {
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
    tenant !== (kind === "work" && q.data.domain ? q.data.domain : q.data.tenant) ||
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
        {/* the first question: which kind of Microsoft account */}
        <Field label="Account type" hint={!kind ? "Choose the kind of Microsoft account you use with OneDrive" : undefined}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {!kind && <option value="">Choose…</option>}
            <option value="work">Work or school account</option>
            <option value="personal">Personal account (outlook.com, hotmail.com, live.com)</option>
          </Select>
        </Field>
        {kind === "work" ? (
          <Field
            label="Your organization"
            hint={
              GUID.test(q.data.tenant) && org.trim() === (q.data.domain || q.data.tenant)
                ? `Tenant ID ${q.data.tenant}`
                : "Your work email domain (for example contoso.com) or the tenant ID"
            }
          >
            <Input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="contoso.com" />
          </Field>
        ) : (
          <div className="hidden md:block" />
        )}
        <Field label="Application (client) ID">
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-[13px]" />
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
      {guide && <SetupGuide initial={kind} onClose={() => setGuide(false)} />}
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

export function SetupGuide({ initial = "", onClose }: { initial?: Kind; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>(initial);
  const work = kind === "work";
  return (
    <Modal open onClose={onClose} size="lg" title="Set up the EntraID app" description="One-time setup, about 5 minutes" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="mb-5">
        <div className="mb-2 text-sm font-semibold">Which Microsoft account do you use with OneDrive?</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ["work", "Work or school account", "From your company or school"],
            ["personal", "Personal account", "outlook.com, hotmail.com, live.com"],
          ] as const).map(([k, title, text]) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={cx(
                "rounded-xl px-3.5 py-2.5 text-left ring-1 transition",
                kind === k ? "bg-brand-50/60 ring-2 ring-brand-500 dark:bg-brand-500/10" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/[0.03]",
              )}
            >
              <div className="text-sm font-medium">{title}</div>
              <div className="text-xs text-zinc-500">{text}</div>
            </button>
          ))}
        </div>
      </div>
      {!kind ? (
        <p className="text-sm text-zinc-500">Choose one to see the steps.</p>
      ) : (
        <ol className="space-y-4">
          <Step n={1} title="Open the Entra admin center">
            <p>
              Go to{" "}
              <a className="font-medium text-brand-600 hover:underline dark:text-brand-400" href="https://entra.microsoft.com" target="_blank" rel="noreferrer">
                entra.microsoft.com
              </a>{" "}
              and sign in{work ? " with an account that can register apps in your organization" : " with your Microsoft account"}.
            </p>
          </Step>
          <Step n={2} title="Register the app">
            <p>
              <B>App registrations</B> → <B>New registration</B>, name it <B>Talon NAS</B>.
            </p>
            <p>
              Supported account types:{" "}
              {work ? (
                <>
                  <B>Single tenant</B> (accounts in this organizational directory only).
                </>
              ) : (
                <>
                  <B>Personal Microsoft accounts only</B>.
                </>
              )}
            </p>
            <p>
              Redirect URI: platform <B>Web</B>, paste this address, then click <B>Register</B>.
            </p>
            <CopyField value={redirectUri()} />
          </Step>
          <Step n={3} title="Copy the Application (client) ID">
            <p>
              Copy it from the app's <B>Overview</B> page into Talon.
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
            {work && (
              <>
                <p>
                  Then <B>Add a permission</B> → <B>Microsoft Graph</B> → <B>Application permissions</B>: add <B>User.Read.All</B>. Talon uses it to list your organization's people under <B>Users → EntraID Users</B>.
                </p>
                <p>
                  Click <B>Grant admin consent</B>.
                </p>
              </>
            )}
          </Step>
          <Step n={6} title="Save and test in Talon">
            <p>
              Set <B>Account type</B> to <B>{work ? "Work or school account" : "Personal account"}</B>
              {work ? (
                <>
                  {" "}and enter your work email domain under <B>Your organization</B> (for example contoso.com)
                </>
              ) : null}
              . Click <B>Save</B>, then <B>Test</B>.
            </p>
          </Step>
        </ol>
      )}
    </Modal>
  );
}

