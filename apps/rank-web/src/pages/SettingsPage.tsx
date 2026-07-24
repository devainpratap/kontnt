import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { Button } from "../components/Button";
import { StatusPill } from "../components/StatusPill";
import { Surface, SurfaceHeader } from "../components/Surface";
import { api } from "../lib/api";
import { formatRelativeTime } from "../lib/format";

/**
 * Connection settings. The Google callback redirects back here with a
 * ?google= status so the outcome of the round trip is always visible, rather
 * than the user landing on an unchanged page and having to guess.
 */
export function SettingsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const googleResult = searchParams.get("google");
  const googleDetail = searchParams.get("detail");

  const settings = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const status = useQuery({ queryKey: ["google-status"], queryFn: api.getGoogleStatus });

  // Returning from the OAuth round trip: refresh state, then drop the query
  // params so a reload does not replay the banner.
  useEffect(() => {
    if (!googleResult) {
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["google-status"] });
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    const timer = setTimeout(() => setSearchParams({}, { replace: true }), 8000);
    return () => clearTimeout(timer);
  }, [googleResult, queryClient, setSearchParams]);

  const connect = useMutation({
    mutationFn: api.connectGoogle,
    onSuccess: ({ authUrl }) => {
      // Full navigation, not a popup: Google blocks embedded auth views.
      window.location.href = authUrl;
    }
  });

  const disconnect = useMutation({
    mutationFn: api.disconnectGoogle,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["google-status"] });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
  });

  const google = status.data;

  return (
    <div className="grid gap-6">
      {googleResult === "connected" ? (
        <p className="rounded-[var(--radius-md)] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          Google connected. You can now link a Search Console property to each client.
        </p>
      ) : null}

      {googleResult === "denied" ? (
        <p className="rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          Consent was declined, so nothing was connected.
        </p>
      ) : null}

      {googleResult === "error" ? (
        <p className="rounded-[var(--radius-md)] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
          Google connection failed. {googleDetail}
        </p>
      ) : null}

      {google?.needsReconnect ? (
        <p className="rounded-[var(--radius-md)] border border-rose-300 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
          <strong>Reconnect Google.</strong> The stored refresh token is no longer accepted, so syncing has stopped.
          This usually means the OAuth app is still in &ldquo;Testing&rdquo; mode in Google Cloud Console, which expires
          refresh tokens after 7 days. Set it to &ldquo;In production&rdquo;, then reconnect.
        </p>
      ) : null}

      <Surface>
        <SurfaceHeader
          eyebrow="Connections"
          title="Google Search Console"
          description="One account covers every property it can already see. Read-only access."
          aside={
            google?.connected ? (
              google.needsReconnect ? (
                <StatusPill tone="bad">Needs reconnect</StatusPill>
              ) : (
                <StatusPill tone="good">Connected</StatusPill>
              )
            ) : (
              <StatusPill tone="warn">Not connected</StatusPill>
            )
          }
        />

        {status.isLoading ? <p className="text-sm text-ink-500">Checking connection…</p> : null}

        {google?.connected ? (
          <div className="grid gap-3">
            <dl className="grid gap-2 text-sm">
              <div className="flex gap-2">
                <dt className="text-ink-500">Account:</dt>
                <dd className="text-ink-800">{google.email}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink-500">Connected:</dt>
                <dd className="text-ink-800">{formatRelativeTime(google.connectedAt)}</dd>
              </div>
              {google.lastErrorMessage ? (
                <div className="flex gap-2">
                  <dt className="text-ink-500">Last error:</dt>
                  <dd className="text-rose-700">{google.lastErrorMessage}</dd>
                </div>
              ) : null}
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={connect.isPending} onClick={() => connect.mutate()}>
                Reconnect
              </Button>
              <Button variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {google?.lastErrorMessage ? <p className="text-[13px] text-ink-600">{google.lastErrorMessage}</p> : null}
            <div>
              <Button loading={connect.isPending} onClick={() => connect.mutate()}>
                Connect Google
              </Button>
            </div>
            {connect.isError ? <p className="text-[13px] text-rose-700">{(connect.error as Error).message}</p> : null}
          </div>
        )}
      </Surface>

      <Surface>
        <SurfaceHeader eyebrow="Connections" title="Live rank checks" />
        {settings.data ? (
          <>
            <div className="grid gap-2 rounded-[var(--radius-md)] border border-hairline p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink-800">
                  SERP provider <span className="text-ink-500">({settings.data.serp.name})</span>
                </span>
                <StatusPill tone="unknown">Unavailable</StatusPill>
              </div>
              <p className="text-[13px] text-ink-500">{settings.data.serp.message}</p>
            </div>

            <div className="grid gap-1 rounded-[var(--radius-md)] border border-hairline p-4">
              <span className="text-sm font-medium text-ink-800">Client data folder</span>
              <span className="break-all font-mono text-[12px] text-ink-600">{settings.data.clientsRoot}</span>
            </div>
          </>
        ) : null}
      </Surface>

      <Surface>
        <SurfaceHeader
          title="How to read the numbers"
          description="These metrics answer different questions and are never combined."
        />
        <ul className="grid gap-3 text-[13px] leading-6 text-ink-600">
          <li>
            <strong className="text-ink-800">Search Console average position</strong> is impression-weighted across
            every query variant, device, and location, and lags by about three days. It is the number to stand behind
            with a client.
          </li>
          <li>
            <strong className="text-ink-800">Tracked rank</strong> (arriving in phase 3) is one literal SERP for one
            keyword in one location, captured at a point in time. Useful for movement, not for reconciliation with
            Search Console.
          </li>
          <li>
            <strong className="text-ink-800">The most recent three days are provisional.</strong> Google revises them
            after publishing, so they are drawn dashed rather than as a settled drop.
          </li>
          <li>
            <strong className="text-ink-800">Query totals never match the headline.</strong> Google withholds rare
            queries for privacy, so each client view states what share of clicks is attributable.
          </li>
        </ul>
      </Surface>
    </div>
  );
}
