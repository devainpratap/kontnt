import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import type { CreateClientInput } from "@rankos/shared";

import { Button } from "../components/Button";
import { StatusPill } from "../components/StatusPill";
import { Surface, SurfaceHeader } from "../components/Surface";
import { TextAreaField, TextField } from "../components/TextField";
import { api } from "../lib/api";
import { formatNumber, formatRelativeTime, parseTermList } from "../lib/format";

const emptyForm = {
  name: "",
  primaryDomain: "",
  gscProperty: "",
  brandTerms: "",
  notes: ""
};

function NewClientForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const createClient = useMutation({
    mutationFn: (payload: CreateClientInput) => api.createClient(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      setForm(emptyForm);
      setError(null);
      onDone();
    },
    onError: (mutationError: Error) => setError(mutationError.message)
  });

  const update = (key: keyof typeof emptyForm) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Surface>
      <SurfaceHeader
        eyebrow="New client"
        title="Add a client"
        description="The domain is what we match against SERP results, so enter it bare — no scheme, no path."
      />

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          createClient.mutate({
            name: form.name.trim(),
            primaryDomain: form.primaryDomain.trim(),
            gscProperty: form.gscProperty.trim() || null,
            brandTerms: parseTermList(form.brandTerms),
            notes: form.notes.trim()
          });
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Client name"
            required
            placeholder="Acme Logistics"
            value={form.name}
            onChange={update("name")}
          />
          <TextField
            label="Primary domain"
            required
            placeholder="acmelogistics.com"
            hint="Bare domain only. Used to identify the client in SERP results."
            value={form.primaryDomain}
            onChange={update("primaryDomain")}
          />
        </div>

        <TextField
          label="Search Console property"
          placeholder="sc-domain:acmelogistics.com"
          hint="Optional for now — you can pick this from a list once Google is connected."
          value={form.gscProperty}
          onChange={update("gscProperty")}
        />

        <TextAreaField
          label="Brand terms"
          placeholder="acme, acme logistics"
          hint="Comma or newline separated. Excluded from opportunity analysis so reports surface non-brand growth."
          value={form.brandTerms}
          onChange={update("brandTerms")}
        />

        <TextAreaField label="Notes" placeholder="Anything worth remembering about this account." value={form.notes} onChange={update("notes")} />

        {error ? (
          <p className="rounded-[var(--radius-md)] border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button type="submit" loading={createClient.isPending}>
            Add client
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Surface>
  );
}

export function ClientsPage() {
  const [showForm, setShowForm] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const clients = useQuery({
    queryKey: ["clients", includeArchived],
    queryFn: () => api.listClients(includeArchived)
  });

  return (
    <div className="grid gap-6">
      {showForm ? <NewClientForm onDone={() => setShowForm(false)} /> : null}

      <Surface>
        <SurfaceHeader
          eyebrow="Accounts"
          title="Clients"
          description="Every client is a folder on disk plus an index row. Nothing leaves this machine."
          aside={
            <>
              <Button variant="ghost" size="sm" onClick={() => setIncludeArchived((value) => !value)}>
                {includeArchived ? "Hide archived" : "Show archived"}
              </Button>
              {!showForm ? (
                <Button size="sm" onClick={() => setShowForm(true)}>
                  Add client
                </Button>
              ) : null}
            </>
          }
        />

        {clients.isLoading ? <p className="text-sm text-ink-500">Loading clients…</p> : null}

        {clients.isError ? (
          <p className="rounded-[var(--radius-md)] border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            Could not reach the RankOS API. Is <code>npm run dev:rank-server</code> running on :3102?
          </p>
        ) : null}

        {clients.data && clients.data.length === 0 ? (
          <div className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-ink-300 px-4 py-8 text-center">
            <p className="text-sm font-medium text-ink-700">No clients yet</p>
            <p className="text-[13px] text-ink-500">
              Add your first client to create its folder and start tracking Search Console data.
            </p>
          </div>
        ) : null}

        {clients.data && clients.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-[12px] uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-4 font-medium">Client</th>
                  <th className="py-2 pr-4 font-medium">Domain</th>
                  <th className="py-2 pr-4 text-right font-medium">Keywords</th>
                  <th className="py-2 pr-4 font-medium">Search Console</th>
                  <th className="py-2 pr-4 font-medium">Last GSC sync</th>
                  <th className="py-2 pr-4 font-medium">Last rank check</th>
                  <th className="py-2 font-medium">Alerts</th>
                </tr>
              </thead>
              <tbody>
                {clients.data.map((client) => (
                  <tr key={client.id} className="border-b border-hairline/60 last:border-0">
                    <td className="py-3 pr-4">
                      <Link className="font-medium text-brand-700 hover:underline" to={`/clients/${client.id}`}>
                        {client.name}
                      </Link>
                      {client.archivedAt ? (
                        <span className="ml-2 text-[12px] text-ink-400">archived</span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-ink-600">{client.primaryDomain}</td>
                    <td className="tabular py-3 pr-4 text-right text-ink-700">
                      {formatNumber(client.activeKeywordCount)}
                      {client.keywordCount !== client.activeKeywordCount ? (
                        <span className="text-ink-400"> / {formatNumber(client.keywordCount)}</span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      {client.gscProperty ? (
                        <StatusPill tone="good">Linked</StatusPill>
                      ) : (
                        <StatusPill tone="warn">Not linked</StatusPill>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-ink-600">{formatRelativeTime(client.lastGscSyncAt)}</td>
                    <td className="py-3 pr-4 text-ink-600">{formatRelativeTime(client.lastSerpCheckAt)}</td>
                    <td className="py-3">
                      {client.unacknowledgedAlertCount > 0 ? (
                        <StatusPill tone="bad">{client.unacknowledgedAlertCount}</StatusPill>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Surface>
    </div>
  );
}
