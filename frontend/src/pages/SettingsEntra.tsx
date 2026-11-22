import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Copy, KeyRound, LogIn, PlugZap, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { dateTime, dmyToIso, isoToDmy } from "../lib/format";
import { useAction } from "../lib/hooks";
import type { EntraCheck, EntraConfig } from "../lib/types";
import { TestResult } from "../components/testresult";
import { Badge, Button, Callout, Card, CardHeader, DateInput, Field, IconButton, Input, Modal, PageLoader, Select, ToggleRow, useToast } from "../components/ui";

const ACCOUNT_TYPES = [
  { value: "common", label: "Personal and work accounts" },
  { value: "organizations", label: "Work or school accounts" },
  { value: "consumers", label: "Personal accounts only" },
  { value: "tenant", label: "Only my organization" },
];

export const redirectUri = () => `${location.origin}/api/onedrive/callback`;

export function CopyField({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className="flex gap-2">
      <Input value={value} readOnly className="font-mono text-[13px]" onFocus={(e) => e.target.select()} />
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
  const [kind, setKind] = useState("common");
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
    const t = q.data.tenant;
    setKind(["common", "organizations", "consumers"].includes(t) ? t : "tenant");
    setTenantId(["common", "organizations", "consumers"].includes(t) ? "" : t);
    setClientId(q.data.client_id);
    setSecret("");
    setExpires(isoToDmy(q.data.secret_expires));
    setRemindDays(q.data.remind_days);
    setRemindTo(q.data.remind_to.join(", "));
  }, [q.data]);
  const tenant = kind === "tenant" ? tenantId.trim() : kind;
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
            <Button variant="primary" disabled={!changed || expiresBad} loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        }
      />
      <div className="grid gap-x-8 gap-y-4 px-5 pb-5 md:grid-cols-2 [&>*]:min-w-0">
        <Field label="Application (client) ID">
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-[13px]" />
        </Field>
        <Field label="Client secret value" hint={q.data.secret_set ? "Saved. Leave empty to keep it." : "Not saved yet"}>
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={q.data.secret_set ? "••••••••••••" : ""} autoComplete="new-password" />
        </Field>
        <Field label="Supported account types">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {ACCOUNT_TYPES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        {kind === "tenant" ? (
          <Field label="Directory (tenant) ID">
            <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-[13px]" />
          </Field>
        ) : (
          <Field label="Redirect URI">
            <CopyField value={redirectUri()} />
          </Field>
        )}
        {kind === "tenant" && (
          <Field label="Redirect URI">
            <CopyField value={redirectUri()} />
          </Field>
        )}
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
    <MicrosoftSignIn />
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
            and sign in with an account that can register apps.
          </p>
        </Step>
        <Step n={2} title="Register the app">
          <p>
            <B>App registrations</B> → <B>New registration</B>, name it <B>Talon NAS</B>.
          </p>
          <p>
            Account types: pick the option that includes <B>personal Microsoft accounts</B>.
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
            <B>API permissions</B> → <B>Add a permission</B> → <B>Microsoft Graph</B> → <B>Delegated</B>.
          </p>
          <p>
            Add <B>Files.ReadWrite</B> and <B>offline_access</B>. Work accounts: <B>Grant admin consent</B>.
          </p>
        </Step>
        <Step n={6} title="Save and test in Talon">
          <p>
            Click <B>Save</B>, then <B>Test</B>. Using another address too? Add its redirect URI as well.
          </p>
        </Step>
      </ol>
    </Modal>
  );
}

type SignIn = {
  enabled: boolean;
  local: boolean;
  entra_configured: boolean;
  links: { user: string; email: string; name: string; oid: string; linked: number }[];
};

/** Sign in to Talon with a Microsoft account, through this EntraID app. */
function MicrosoftSignIn() {
  const toast = useToast();
  const q = useQuery({ queryKey: ["signin"], queryFn: () => api.get<SignIn>("/settings/signin") });
  // coming back from linking an account
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get("linked")) toast("success", `Linked ${p.get("linked")}`);
    if (p.get("link_error")) toast("error", p.get("link_error")!);
    if (p.get("linked") || p.get("link_error")) history.replaceState(null, "", "/settings?tab=entra");
  }, [toast]);
  const save = useAction((b: { enabled: boolean; local: boolean }) => api.put<SignIn>("/settings/signin", b), {
    success: "Saved",
    invalidate: ["signin"],
  });
  const link = useAction(() => api.post<{ url: string }>("/auth/microsoft/link", { origin: location.origin }), {
    onSuccess: (r) => {
      location.href = r.url;
    },
  });
  const unlink = useAction((oid: string) => api.del<SignIn>(`/settings/signin/links/${oid}`), {
    success: "Unlinked",
    invalidate: ["signin"],
  });
  if (!q.data) return null;
  const d = q.data;
  return (
    <Card>
      <CardHeader
        icon={<LogIn className="size-4.5" />}
        title={
          <span className="flex items-center gap-2">
            Microsoft Sign-In {d.enabled ? <Badge tone="green" dot>On</Badge> : <Badge dot>Off</Badge>}
          </span>
        }
        subtitle="Sign in to Talon with a Microsoft account"
      />
      <div className="px-5 pb-5">
        {!d.entra_configured && <Callout tone="info" className="mb-3">Set up the EntraID app above first.</Callout>}
        <div className="divide-y divide-zinc-100 dark:divide-white/5">
          <ToggleRow
            title="Sign in with Microsoft"
            description="Shows a Sign in with Microsoft button on the sign-in page"
            checked={d.enabled}
            disabled={!d.entra_configured}
            onChange={(v) => save.mutate({ enabled: v, local: v ? d.local : true })}
          />
          <div className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Linked accounts</div>
                <div className="text-xs text-zinc-500">Each administrator links their own Microsoft account while signed in</div>
              </div>
              <Button size="sm" icon={<LogIn className="size-3.5" />} disabled={!d.enabled} loading={link.isPending} onClick={() => link.mutate()}>
                Link my Microsoft account
              </Button>
            </div>
            {d.links.length > 0 && (
              <ul className="mt-3 divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-200 dark:divide-white/5 dark:ring-white/10">
                {d.links.map((l) => (
                  <li key={l.oid} className="flex items-center gap-3 px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{l.email || l.name}</div>
                      <div className="truncate text-xs text-zinc-500">Signs in as {l.user} · linked {dateTime(l.linked)}</div>
                    </div>
                    <IconButton label={`Unlink ${l.email}`} onClick={() => unlink.mutate(l.oid)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ToggleRow
            title="Sign in with a user name and password"
            description={
              d.enabled && d.links.length
                ? "Off: only Sign in with Microsoft is shown on the sign-in page"
                : "Can be turned off once a Microsoft account is linked"
            }
            checked={d.local}
            disabled={!(d.enabled && d.links.length)}
            onChange={(v) => save.mutate({ enabled: d.enabled, local: v })}
          />
        </div>
        {!d.local && (
          <p className="mt-3 text-xs text-zinc-500">
            Locked out? On the NAS, run <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-white/10">sudo talon enable-local-login</code> to turn password sign-in back on.
          </p>
        )}
      </div>
    </Card>
  );
}
