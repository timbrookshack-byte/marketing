import { catalog, channelColor } from "@/lib/connectors/registry";
import { listConnections, listSyncRuns } from "@/lib/repo";
import { Card, ChannelDot, TableWrap, Td, Th } from "@/components/ui";
import { ConnectionControls, DemoDataButton, SyncAllButton } from "./controls";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, { label: string; color: string; icon: string }> = {
  connected: { label: "Connected", color: "var(--status-good)", icon: "●" },
  demo: { label: "Demo data", color: "var(--series-1)", icon: "◐" },
  error: { label: "Last sync failed", color: "var(--status-critical)", icon: "■" },
  needs_reauth: { label: "Reconnect needed", color: "var(--status-warning)", icon: "▲" },
  disconnected: { label: "Not connected", color: "var(--text-muted)", icon: "○" },
};

export default function ConnectionsPage() {
  const entries = catalog();
  const connections = listConnections();
  const runs = listSyncRuns(12);
  const connectionByPlatform = new Map(connections.map((c) => [c.platform, c]));

  const adPlatforms = entries.filter((entry) => entry.kind === "ads");
  const revenuePlatforms = entries.filter((entry) => entry.kind !== "ads");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Connections</h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            {connections.length} connected · every platform normalises to the same daily rows, so
            adding one never changes how the analysis reads.
          </p>
        </div>
        <div className="flex gap-2">
          <DemoDataButton hasData={connections.length > 0} />
          <SyncAllButton />
        </div>
      </div>

      <Card
        title="Ad platforms"
        subtitle="Connecting an account pulls campaigns, ad groups, creatives and 90 days of daily metrics."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {adPlatforms.map((entry) => (
            <PlatformCard
              key={entry.platform}
              entry={entry}
              connection={connectionByPlatform.get(entry.platform)}
            />
          ))}
        </div>
      </Card>

      <Card
        title="Revenue and analytics"
        subtitle="This half is what makes the other half trustworthy: without real orders, every channel is judged on its own marking."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {revenuePlatforms.map((entry) => (
            <PlatformCard
              key={entry.platform}
              entry={entry}
              connection={connectionByPlatform.get(entry.platform)}
            />
          ))}
        </div>
      </Card>

      {runs.length > 0 ? (
        <Card title="Recent syncs">
          <TableWrap>
            <table className="w-full min-w-[620px] border-collapse">
              <thead>
                <tr className="border-b hairline">
                  <Th>Started</Th>
                  <Th>Connection</Th>
                  <Th>Status</Th>
                  <Th align="right">Rows</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const connection = connections.find((c) => c.id === run.connectionId);
                  return (
                    <tr key={run.id} className="border-b align-top hairline last:border-0">
                      <Td>{new Date(run.startedAt).toLocaleString()}</Td>
                      <Td>{connection?.displayName ?? run.connectionId}</Td>
                      <Td>
                        <span
                          style={{
                            color:
                              run.status === "success"
                                ? "var(--status-good)"
                                : run.status === "error"
                                  ? "var(--status-critical)"
                                  : "var(--text-muted)",
                          }}
                        >
                          {run.status}
                        </span>
                      </Td>
                      <Td align="right">{run.rowsIngested.toLocaleString()}</Td>
                      <Td className="max-w-md text-[12px] text-[var(--text-secondary)]">
                        {run.error ?? "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ) : null}
    </div>
  );
}

function PlatformCard({
  entry,
  connection,
}: {
  entry: ReturnType<typeof catalog>[number];
  connection: ReturnType<typeof listConnections>[number] | undefined;
}) {
  const status = STATUS_COPY[connection?.status ?? "disconnected"];

  return (
    <article className="flex flex-col gap-2 rounded-lg border p-4 hairline">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ChannelDot color={channelColor(entry.platform)} />
          <h3 className="text-[14px] font-medium">{entry.displayName}</h3>
        </div>
        <span
          className="flex shrink-0 items-center gap-1 text-[11px] font-medium"
          style={{ color: status.color }}
        >
          <span aria-hidden>{status.icon}</span>
          {status.label}
        </span>
      </header>

      <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">{entry.summary}</p>

      {entry.provisional && entry.provisionalNote ? (
        <p
          className="rounded border-l-2 pl-2 text-[11px] leading-relaxed"
          style={{ borderColor: "var(--status-warning)", color: "var(--text-secondary)" }}
        >
          <strong className="font-medium">Not verified against live docs.</strong>{" "}
          {entry.provisionalNote}
        </p>
      ) : null}

      {!entry.configured ? (
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          Needs{" "}
          {entry.missingEnv.map((name, index) => (
            <span key={name}>
              {index > 0 ? ", " : ""}
              <code className="rounded bg-[var(--surface-sunken)] px-1">{name}</code>
            </span>
          ))}{" "}
          in the environment before it can connect.
        </p>
      ) : null}

      {connection?.lastError ? (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--status-critical)" }}>
          {connection.lastError}
        </p>
      ) : null}

      <footer className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <ConnectionControls
          platform={entry.platform}
          connectionId={connection?.id ?? null}
          canConnect={entry.configured && entry.authType === "oauth2"}
          status={connection?.status ?? "disconnected"}
        />
        <a
          href={entry.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-[11px] text-[var(--text-muted)] underline underline-offset-2"
        >
          API docs
        </a>
      </footer>

      {connection?.lastSyncAt ? (
        <p className="text-[11px] text-[var(--text-muted)]">
          Last synced {new Date(connection.lastSyncAt).toLocaleString()}
        </p>
      ) : null}
    </article>
  );
}
