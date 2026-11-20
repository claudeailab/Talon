import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BellRing, Mail, Send } from "lucide-react";
import { api } from "../lib/api";
import { sameSet, sameValue } from "../lib/format";
import { useAction } from "../lib/hooks";
import { navigate } from "../lib/router";
import type { NotificationSettings } from "../lib/types";
import { Button, Card, CardHeader, Empty, Field, Input, PageHeader, PageLoader, Switch } from "../components/ui";

export default function NotificationsPage() {
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<NotificationSettings>("/notifications") });
  const [recipients, setRecipients] = useState("");
  const [events, setEvents] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!q.data) return;
    setRecipients(q.data.recipients.join(", "));
    setEvents(q.data.events);
  }, [q.data]);
  const list = recipients.split(/[,;\s]+/).filter(Boolean);
  const save = useAction(() => api.put<NotificationSettings>("/notifications", { recipients: list, events }), {
    success: "Notification settings saved",
    invalidate: ["notifications"],
  });
  const test = useAction(() => api.post("/notifications/test"), { success: "Test notification sent" });
  if (!q.data) return <PageLoader />;
  const header = <PageHeader title="Notifications" description="Choose when the NAS sends you an e-mail." />;

  if (!q.data.smtp)
    return (
      <>
        {header}
        <Card>
          <Empty
            icon={<Mail className="size-6" />}
            title="Set up SMTP first"
            text="The NAS needs an SMTP server to send e-mail."
            action={
              <Button variant="primary" onClick={() => navigate("/settings?tab=smtp")}>
                Configure SMTP
              </Button>
            }
          />
        </Card>
      </>
    );

  const changed = !sameSet(list, q.data.recipients) || !sameValue(events, q.data.events);
  return (
    <>
      {header}
      <Card>
        <CardHeader
          icon={<BellRing className="size-4.5" />}
          title="E-mail notifications"
          subtitle="Each alert is sent once, and again if it comes back"
          actions={
            <div className="flex gap-2">
              <Button icon={<Send className="size-4" />} disabled={changed || !q.data.recipients.length} loading={test.isPending} onClick={() => test.mutate()}>
                Send test
              </Button>
              <Button variant="primary" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            </div>
          }
        />
        <div className="space-y-5 px-5 pb-5">
          <Field label="Send to" hint="Separate several addresses with commas">
            <Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="you@example.com" />
          </Field>
          <div>
            <div className="mb-1.5 text-[13px] font-medium">Send an e-mail when</div>
            <div className="grid gap-2 md:grid-cols-2">
              {Object.entries(q.data.labels).map(([id, label]) => (
                <div key={id} className="flex h-11 items-center justify-between gap-4 rounded-xl bg-zinc-50 px-3.5 dark:bg-white/[0.03]">
                  <span className="truncate text-[13px] font-medium">{label}</span>
                  <Switch checked={!!events[id]} onChange={(v) => setEvents({ ...events, [id]: v })} label={label} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
