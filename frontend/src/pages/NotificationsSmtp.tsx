import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PlugZap } from "lucide-react";
import { TestResult, type Check } from "../components/testresult";
import { api } from "../lib/api";
import { useAction } from "../lib/hooks";
import type { SmtpConfig } from "../lib/types";
import { Badge, Button, Input, PageLoader, Segmented } from "../components/ui";
import { Row, RowCard, SaveBar, Section } from "../components/rows";

const DEFAULT_PORT = { starttls: 587, ssl: 465, none: 25 } as const;
type Form = { host: string; port: string; security: SmtpConfig["security"]; username: string; password: string; sender: string };

/** Notifications → Email: the server Talon sends email through. */
export default function SmtpCard() {
  const q = useQuery({ queryKey: ["smtp"], queryFn: () => api.get<SmtpConfig>("/settings/smtp") });
  const [f, setF] = useState<Form | null>(null);
  useEffect(() => {
    if (q.data)
      setF({ host: q.data.host, port: String(q.data.port), security: q.data.security, username: q.data.username, password: "", sender: q.data.sender });
  }, [q.data]);
  const body = f && { ...f, port: Number(f.port) };
  const save = useAction(() => api.put<SmtpConfig>("/settings/smtp", body), { success: "SMTP settings saved", invalidate: ["smtp", "notifications"] });
  // checks connection, encryption, sign-in and sender without sending an email
  const [checks, setChecks] = useState<Check[] | null>(null);
  const test = useAction(() => api.post<{ checks: Check[] }>("/settings/smtp/test", { config: body }), {
    onSuccess: (r) => setChecks(r.checks),
  });
  if (!q.data || !f) return <PageLoader />;
  const d = q.data;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const changed = f.host !== d.host || Number(f.port) !== d.port || f.security !== d.security || f.username !== d.username || f.sender !== d.sender || f.password !== "";
  const setSecurity = (s: Form["security"]) =>
    setF({ ...f, security: s, port: Object.values(DEFAULT_PORT).includes(Number(f.port) as 25) ? String(DEFAULT_PORT[s]) : f.port });

  const discard = () => setF({ host: d.host, port: String(d.port), security: d.security, username: d.username, password: "", sender: d.sender });
  const W = "w-full sm:w-64";

  return (
    <RowCard>
      <Section
        title="SMTP server"
        badge={d.configured ? <Badge tone="green" dot>Configured</Badge> : <Badge dot>Not configured</Badge>}
        right={
          <Button size="sm" variant="ghost" icon={<PlugZap className="size-3.5" />} disabled={!f.host || !f.sender} loading={test.isPending} onClick={() => test.mutate()}>
            Test
          </Button>
        }
      />
      <Row label="Server" hint="For example smtp.office365.com">
        <div className="flex w-full gap-2 sm:w-72">
          <Input value={f.host} onChange={(e) => set("host", e.target.value.trim())} placeholder="smtp.office365.com" className="min-w-0 flex-1" aria-label="SMTP server" />
          <div className="w-20 shrink-0">
            <Input value={f.port} onChange={(e) => set("port", e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label="Port" />
          </div>
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
        <Input value={f.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" className={W} aria-label="User name" />
      </Row>
      <Row label="Password" hint={d.password_set ? "Saved. Leave empty to keep it." : "Not saved yet"}>
        <Input type="password" value={f.password} onChange={(e) => set("password", e.target.value)} placeholder={d.password_set ? "••••••••••••" : ""} autoComplete="new-password" className={W} aria-label="Password" />
      </Row>
      <Row label="Sender address">
        <Input value={f.sender} onChange={(e) => set("sender", e.target.value.trim())} placeholder="nas@example.com" className={W} aria-label="Sender address" />
      </Row>
      {checks && <TestResult checks={checks} />}
      <SaveBar show={changed} onDiscard={discard} loading={save.isPending} onSave={() => save.mutate()} />
    </RowCard>
  );
}
