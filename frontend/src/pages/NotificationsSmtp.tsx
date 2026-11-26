import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PlugZap } from "lucide-react";
import { TestResult, type Check } from "../components/testresult";
import { api } from "../lib/api";
import { useAction } from "../lib/hooks";
import type { SmtpConfig } from "../lib/types";
import { Badge, Button, PageLoader, Segmented } from "../components/ui";
import { Row, RowCard, Section } from "../components/rows";
import { AutoField } from "../components/autosave";

const DEFAULT_PORT = { starttls: 587, ssl: 465, none: 25 } as const;
type Body = { host: string; port: number; security: SmtpConfig["security"]; username: string; password: string; sender: string };

/** Notifications → Email: the server Talon sends email through. Each field saves by itself;
 *  email is used once the server and the sender are both filled in. */
export default function SmtpCard() {
  const q = useQuery({ queryKey: ["smtp"], queryFn: () => api.get<SmtpConfig>("/settings/smtp") });
  const save = useAction((body: Body) => api.put<SmtpConfig>("/settings/smtp", body), { success: "Saved", invalidate: ["smtp", "notifications"] });
  // checks connection, encryption, sign-in and sender without sending an email
  const [checks, setChecks] = useState<Check[] | null>(null);
  const test = useAction((body: Body) => api.post<{ checks: Check[] }>("/settings/smtp/test", { config: body }), {
    onSuccess: (r) => setChecks(r.checks),
  });
  if (!q.data) return <PageLoader />;
  const d = q.data;
  // the saved settings; an empty password keeps the saved one
  const saved: Body = { host: d.host, port: d.port, security: d.security, username: d.username, password: "", sender: d.sender };
  const put = (patch: Partial<Body>) => save.mutateAsync({ ...saved, ...patch });
  const setSecurity = (s: Body["security"]) =>
    put({ security: s, port: (Object.values(DEFAULT_PORT) as number[]).includes(d.port) ? DEFAULT_PORT[s] : d.port });
  const W = "w-full sm:w-72";

  return (
    <RowCard>
      <Section
        title="SMTP server"
        badge={d.configured ? <Badge tone="green" dot>Configured</Badge> : <Badge dot>{d.host && !d.sender ? "Add a sender address" : "Not configured"}</Badge>}
        right={
          <Button size="sm" variant="link" icon={<PlugZap className="size-3.5" />} disabled={!d.configured} loading={test.isPending} onClick={() => test.mutate(saved)}>
            Test
          </Button>
        }
      />
      <Row label="Server" hint="For example smtp.office365.com">
        <div className="flex w-full gap-2 sm:w-72">
          <AutoField
            value={d.host}
            onSave={(v) => put({ host: v })}
            filter={(v) => v.trim()}
            validate={(v) => (!v || /^[A-Za-z0-9.-]+$/.test(v) ? null : "Enter a server name like smtp.example.com")}
            placeholder="smtp.office365.com"
            width="min-w-0 flex-1"
            aria-label="SMTP server"
          />
          <AutoField
            value={String(d.port)}
            onSave={(v) => put({ port: Number(v) })}
            filter={(v) => v.replace(/\D/g, "").slice(0, 5)}
            validate={(v) => (Number(v) >= 1 && Number(v) <= 65535 ? null : "1–65535")}
            inputMode="numeric"
            width="w-24 shrink-0"
            className="tabular"
            aria-label="Port"
          />
        </div>
      </Row>
      <Row label="Connection security">
        <Segmented
          value={d.security}
          onChange={setSecurity}
          options={[
            { value: "starttls", label: "STARTTLS" },
            { value: "ssl", label: "SSL/TLS" },
            { value: "none", label: "None" },
          ]}
        />
      </Row>
      <Row label="User name" hint="Leave empty if the server needs no sign-in">
        <AutoField value={d.username} onSave={(v) => put({ username: v })} autoComplete="off" width={W} aria-label="User name" />
      </Row>
      <Row label="Password" hint={d.password_set ? "Saved. Type a new one to change it." : "Not saved yet"}>
        <AutoField value="" secret onSave={(v) => put({ password: v })} placeholder={d.password_set ? "••••••••••••" : ""} autoComplete="new-password" width={W} aria-label="Password" />
      </Row>
      <Row label="Sender address">
        <AutoField
          value={d.sender}
          onSave={(v) => put({ sender: v })}
          filter={(v) => v.trim()}
          validate={(v) => (!v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : "Enter an address like nas@example.com")}
          placeholder="nas@example.com"
          width={W}
          aria-label="Sender address"
        />
      </Row>
      {checks && <TestResult checks={checks} />}
    </RowCard>
  );
}
