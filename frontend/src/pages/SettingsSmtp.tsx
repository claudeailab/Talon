import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Mail, Send } from "lucide-react";
import { api } from "../lib/api";
import { useAction } from "../lib/hooks";
import type { NotificationSettings, SmtpConfig } from "../lib/types";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageLoader, Segmented } from "../components/ui";

const DEFAULT_PORT = { starttls: 587, ssl: 465, none: 25 } as const;
type Form = { host: string; port: string; security: SmtpConfig["security"]; username: string; password: string; sender: string };

export default function SmtpTab() {
  const q = useQuery({ queryKey: ["smtp"], queryFn: () => api.get<SmtpConfig>("/settings/smtp") });
  const notif = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<NotificationSettings>("/notifications") });
  const [f, setF] = useState<Form | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [to, setTo] = useState("");
  useEffect(() => {
    if (q.data)
      setF({ host: q.data.host, port: String(q.data.port), security: q.data.security, username: q.data.username, password: "", sender: q.data.sender });
  }, [q.data]);
  useEffect(() => {
    if (notif.data?.recipients.length && !to) setTo(notif.data.recipients[0]);
  }, [notif.data]); // eslint-disable-line
  const body = f && { ...f, port: Number(f.port) };
  const save = useAction(() => api.put<SmtpConfig>("/settings/smtp", body), { success: "SMTP settings saved", invalidate: ["smtp", "notifications"] });
  const test = useAction(() => api.post("/settings/smtp/test", { config: body, to }), {
    success: `Test e-mail sent to ${to}`,
    onSuccess: () => setTestOpen(false),
  });
  if (!q.data || !f) return <PageLoader />;
  const d = q.data;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const changed = f.host !== d.host || Number(f.port) !== d.port || f.security !== d.security || f.username !== d.username || f.sender !== d.sender || f.password !== "";
  const setSecurity = (s: Form["security"]) =>
    setF({ ...f, security: s, port: Object.values(DEFAULT_PORT).includes(Number(f.port) as 25) ? String(DEFAULT_PORT[s]) : f.port });

  return (
    <Card>
      <CardHeader
        icon={<Mail className="size-4.5" />}
        title={
          <span className="flex items-center gap-2">
            SMTP server {d.configured ? <Badge tone="green" dot>Configured</Badge> : <Badge dot>Not configured</Badge>}
          </span>
        }
        subtitle="Used to send e-mail notifications"
        actions={
          <div className="flex gap-2">
            <Button icon={<Send className="size-4" />} disabled={!f.host || !f.sender} onClick={() => setTestOpen(true)}>
              Test
            </Button>
            <Button variant="primary" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        }
      />
      <div className="grid gap-x-8 gap-y-4 px-5 pb-5 md:grid-cols-2 [&>*]:min-w-0">
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem] [&>*]:min-w-0">
          <Field label="SMTP server">
            <Input value={f.host} onChange={(e) => set("host", e.target.value.trim())} placeholder="smtp.office365.com" />
          </Field>
          <Field label="Port">
            <Input value={f.port} onChange={(e) => set("port", e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-[13px] font-medium">Connection security</div>
          <Segmented
            value={f.security}
            onChange={setSecurity}
            options={[
              { value: "starttls", label: "STARTTLS" },
              { value: "ssl", label: "SSL/TLS" },
              { value: "none", label: "None" },
            ]}
          />
        </div>
        <Field label="User name" hint="Leave empty if the server needs no sign-in">
          <Input value={f.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Password" hint={d.password_set ? "Saved. Leave empty to keep it." : "Not saved yet"}>
          <Input type="password" value={f.password} onChange={(e) => set("password", e.target.value)} placeholder={d.password_set ? "••••••••••••" : ""} autoComplete="new-password" />
        </Field>
        <Field label="Sender address">
          <Input value={f.sender} onChange={(e) => set("sender", e.target.value.trim())} placeholder="nas@example.com" />
        </Field>
      </div>
      <Modal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        title="Send a test e-mail"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTestOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" icon={<Send className="size-4" />} disabled={!to} loading={test.isPending} onClick={() => test.mutate()}>
              Send
            </Button>
          </>
        }
      >
        <Field label="Send to" hint="Uses the settings in the form, saved or not">
          <Input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="you@example.com" autoFocus />
        </Field>
      </Modal>
    </Card>
  );
}
