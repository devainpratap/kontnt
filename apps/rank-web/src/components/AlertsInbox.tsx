import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AlertKind, AlertWithContext } from "@rankos/shared";

import { api } from "../lib/api";
import { formatRelativeTime } from "../lib/format";
import { Button } from "./Button";
import { StatusPill } from "./StatusPill";
import { Surface, SurfaceHeader } from "./Surface";

/** Whether an alert is good news or bad, so the inbox reads at a glance. */
const TONE: Record<AlertKind, "good" | "bad" | "warn"> = {
  "entered-top-3": "good",
  "dropped-out-of-top-3": "warn",
  "dropped-out-of-top-10": "bad",
  "large-move": "warn",
  "page-lost-clicks": "bad",
  "new-competitor-top-3": "warn"
};

export function AlertsInbox({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();

  const alerts = useQuery({
    queryKey: ["alerts", clientId],
    queryFn: () => api.listAlerts(clientId)
  });

  const acknowledge = useMutation({
    mutationFn: (alertId: string) => api.acknowledgeAlert(alertId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts", clientId] })
  });

  const acknowledgeAll = useMutation({
    mutationFn: () => api.acknowledgeAllAlerts(clientId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts", clientId] })
  });

  const rows = alerts.data ?? [];

  // Always visible, so the feature is discoverable and its healthy state is
  // legible - an empty inbox reads as "all clear", not "missing".
  if (rows.length === 0) {
    return (
      <Surface>
        <SurfaceHeader
          eyebrow="Automatic monitoring"
          title="Alerts"
          description="Rank-movement alerts appear here - entered or dropped out of the top 3, fell off page one, or moved sharply. Blocked or failed checks never raise one."
          aside={<StatusPill tone="good">All clear</StatusPill>}
        />
        <p className="text-[13px] text-ink-500">
          No alerts right now. New ones are raised automatically after each rank check.
        </p>
      </Surface>
    );
  }

  return (
    <Surface className="border-amber-200">
      <SurfaceHeader
        eyebrow="Needs attention"
        title={`Alerts (${rows.length})`}
        description="Raised automatically when a tracked position changes meaningfully. Blocked or failed checks never raise an alert."
        aside={
          <Button size="sm" variant="ghost" loading={acknowledgeAll.isPending} onClick={() => acknowledgeAll.mutate()}>
            Acknowledge all
          </Button>
        }
      />

      <div className="grid gap-2">
        {rows.map((alert: AlertWithContext) => (
          <div
            key={alert.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-hairline bg-white px-3 py-2"
          >
            <div className="flex items-center gap-3">
              <StatusPill tone={TONE[alert.kind] ?? "warn"}>{alert.kind.replace(/-/g, " ")}</StatusPill>
              <span className="text-[13px] text-ink-800">{alert.description}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-ink-400">{formatRelativeTime(alert.detectedAt)}</span>
              <Button
                size="sm"
                variant="ghost"
                loading={acknowledge.isPending && acknowledge.variables === alert.id}
                onClick={() => acknowledge.mutate(alert.id)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}
