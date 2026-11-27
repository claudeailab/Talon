import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PlugZap } from "lucide-react";
import { TestResult, type Check } from "../components/testresult";
import { api } from "../lib/api";
import { useAction, useDraft } from "../lib/hooks";
import type { SmtpConfig } from "../lib/types";
import { Badge, Button, PageLoader, Segmented } from "../components/ui";
import { Row, RowCard, SaveBar, Section } from "../components/rows";
import { TextField } from "../components/field";

const DEFAULT_PORT = { starttls: 587, ssl: 465, none: 25 } as const;
type Draft = { host: string; port: string; security: SmtpConfig["security"]; username: string; password: string; sender: string };
type Body = { host: string; port: number; security: SmtpConfig["security"]; username: string; password: string; sender: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Notifications → Email: the server Talon sends email through. Changes are kept until Save;
 *  email is used once the server and the sender are both filled in. */
export default function SmtpCard() {
  const q = useQuery({ queryKey: ["smtp"], queryFn: () => api.get<SmtpConfig>("/settings/smtp") });
  // checks connection, encryption, sign-in and sender without sending an email
  const [checks, setChecks] = useState<Check[] | null>(null);
  const test = useAction((body: Body) => api.post<{ checks: Check[] }>("/settings/smtp/test", { config: body }), {
    onSuccess: (r) => setChecks(r.checks),
  });
  const d = q.data;
  // the saved settings; an empty password keeps the saved one
  const { draft: f, dirty, set, reset } = useDraft<Draft>(
    d && { host: d.host, port: String(d.port), security: d.security, username: d.username, password: "", sender: d.sender },
  );
  const save = useAction((body: Body) => api.put<SmtpConfig>("/settings/smtp", body), {
    success: "Email server saved",
    invalidate: ["smtp", "notifications"],
    onSuccess: () => set("password", ""),
  });
  if (!d || !f) return <PageLoader />;
  const body: Body = { ...f, host: f.host.trim(), sender: f.sender.trim(), port: Number(f.port) };
  const err = {
    host: body.host && !/^[A-Za-z0-9.-]+$/.test(body.host) ? "Enter a server name like smtp.example.com" : null,
    port: Number(f.port) >= 1 && Number(f.port) <= 65535 ? null : "1–65535",
    sender: body.sender && !EMAIL_RE.test(body.sender) ? "Enter an address like nas@example.com" : null,
  };
  const problem = body.host && !body.sender
    ? "Enter the sender address"
    : body.sender && !body.host
      ? "Enter the SMTP server"
      : err.host
        ? "The server name is not valid"
        : err.port
          ? "Enter a port between 1 and 65535"
          : err.sender
            ? "The sender address is not valid"
            : null;
  const setSecurity = (sec: Body["security"]) => {
    set("security", sec);
    if ((Object.values(DEFAULT_PORT) as number[]).includes(Number(f.port))) set("port", String(DEFAULT_PORT[sec]));
  };
  const W = "w-full sm:w-72";

  return (
    <RowCard>
      <Section
        title="SMTP server"
        badge={d.configured ? <Badge tone="green" dot>Configured</Badge> : <Badge dot>Not configured</Badge>}
        right={
          <Button size="sm" variant="link" icon={<PlugZap className="size-3.5" />} disabled={!body.host || !body.sender || !!problem} loading={test.isPending} onClick={() => test.mutate(body)}>
            Test
          </Button>
        }
      />
      <Row label="Server" hint="For example smtp.office365.com">
        <div className="flex w-full gap-2 sm:w-72">
          <TextField value={f.host} onChange={(v) => set("host", v.trim())} error={err.host} placeholder="smtp.office365.com" width="min-w-0 flex-1" aria-label="SMTP server" />
          <TextField value={f.port} onChange={(v) => set("port", v)} filter={(v) => v.replace(/\D/g, "").slice(0, 5)} error={err.port} inputMode="numeric" width="w-24 shrink-0" className="tabular" aria-label="Port" />
        </div>
      </Row>
      <Row label="Connection security">
        <Segmented
          value={f.security}
          onChange={setSecurity}
          options={[
            { value: "starttls", label: "STARTTLS" },
            { value: "ssl", label: "SSL/TLS" },
            { value: "none", label: "None" },
          ]}
        />
      </Row>
      <Row label="User name" hint="Leave empty if the server needs no sign-in">
        <TextField value={f.username} onChange={(v) => set("username", v)} autoComplete="off" width={W} aria-label="User name" />
      </Row>
      <Row label="Password" hint={d.password_set ? "Saved. Type a new one to change it." : "Not saved yet"}>
        <TextField type="password" value={f.password} onChange={(v) => set("password", v)} placeholder={d.password_set ? "••••••••••••" : ""} autoComplete="new-password" width={W} aria-label="Password" />
      </Row>
      <Row label="Sender address">
        <TextField value={f.sender} onChange={(v) => set("sender", v.trim())} error={err.sender} placeholder="nas@example.com" width={W} aria-label="Sender address" />
      </Row>
      {checks && <TestResult checks={checks} />}
      <SaveBar dirty={dirty} problem={problem} onDiscard={reset} loading={save.isPending} onSave={() => save.mutate(body)} />
    </RowCard>
  );
}
