import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, CheckCircle2, Copy, KeyRound, PlugZap, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { useAction } from "../lib/hooks";
import type { EntraCheck, EntraConfig } from "../lib/types";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageLoader, Select, useToast } from "../components/ui";

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
  const [guide, setGuide] = useState(false);
  const [checks, setChecks] = useState<EntraCheck[] | null>(null);
  useEffect(() => {
    if (!q.data) return;
    const t = q.data.tenant;
    setKind(["common", "organizations", "consumers"].includes(t) ? t : "tenant");
    setTenantId(["common", "organizations", "consumers"].includes(t) ? "" : t);
    setClientId(q.data.client_id);
    setSecret("");
  }, [q.data]);
  const tenant = kind === "tenant" ? tenantId.trim() : kind;
  const body = { tenant, client_id: clientId.trim(), client_secret: secret };
  const save = useAction(() => api.put<EntraConfig>("/settings/entra", body), {
    success: "Entra ID app saved",
    invalidate: ["entra", "onedrive"],
  });
  const test = useAction(() => api.post<{ checks: EntraCheck[] }>("/settings/entra/test", { config: body, origin: location.origin }), {
    onSuccess: (r) => setChecks(r.checks),
  });
  if (!q.data) return <PageLoader />;
  const changed = tenant !== q.data.tenant || clientId.trim() !== q.data.client_id || secret !== "";

  return (
    <Card>
      <CardHeader
        icon={<KeyRound className="size-4.5" />}
        title={
          <span className="flex items-center gap-2">
            Entra ID app {q.data.configured ? <Badge tone="green" dot>Configured</Badge> : <Badge dot>Not configured</Badge>}
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
            <Button variant="primary" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>
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
          <Field label="Redirect URI" hint="Add this exact address to the app in Entra">
            <CopyField value={redirectUri()} />
          </Field>
        )}
        {kind === "tenant" && (
          <Field label="Redirect URI" hint="Add this exact address to the app in Entra">
            <CopyField value={redirectUri()} />
          </Field>
        )}
      </div>
      {checks && (
        <div className="border-t border-zinc-100 px-5 py-4 dark:border-white/5">
          <div className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Test result</div>
          <ul className="space-y-1.5">
            {checks.map((c) => (
              <li key={c.name} className="flex items-center gap-2 text-[13px]">
                {c.ok ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <XCircle className="size-4 shrink-0 text-rose-500" />}
                <span className="shrink-0 font-medium">{c.name}</span>
                <span className="truncate text-zinc-500" title={c.detail}>
                  {c.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {guide && <SetupGuide onClose={() => setGuide(false)} />}
    </Card>
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
            Copy the secret <B>Value</B> (not the Secret ID) into Talon. It is shown once.
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
