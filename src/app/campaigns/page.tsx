import { buildSnapshot, breakEvenRoas } from "@/lib/analytics";
import { channelColor, platformLabel } from "@/lib/connectors/registry";
import { formatCompactCurrency, formatNumber, formatPercent, safeDiv } from "@/lib/util";
import { Sparkline } from "@/components/charts";
import {
  Card,
  ChannelDot,
  EmptyState,
  Money,
  PrimaryLink,
  SeverityBadge,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { CampaignActions } from "./actions";

export const dynamic = "force-dynamic";

export default function CampaignsPage() {
  const snapshot = buildSnapshot(30);

  if (snapshot.isEmpty) {
    return (
      <EmptyState
        title="No campaigns yet"
        body="Campaigns appear here after the first sync, with the money-losing ones flagged before you have to go looking."
        action={<PrimaryLink href="/connections">Connect an account</PrimaryLink>}
      />
    );
  }

  const { campaigns, settings, plan, windowDays } = snapshot;
  const breakEven = breakEvenRoas(settings);
  const planByCampaign = new Map(plan.lines.map((line) => [line.campaignId, line]));

  // A campaign's worst finding decides the badge it wears in the table.
  const severityByCampaign = new Map<string, { severity: "critical" | "serious" | "warning"; title: string }>();
  const rank = { critical: 3, serious: 2, warning: 1 } as const;
  for (const finding of snapshot.findings) {
    if (finding.scope !== "campaign" || finding.severity === "good") continue;
    const current = severityByCampaign.get(finding.targetId);
    const severity = finding.severity as "critical" | "serious" | "warning";
    if (!current || rank[severity] > rank[current.severity]) {
      severityByCampaign.set(finding.targetId, { severity, title: finding.title });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Campaigns</h1>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          {campaigns.length} campaigns across {new Set(campaigns.map((c) => c.campaign.platform)).size}{" "}
          channels · {windowDays} days to {snapshot.range.end}
        </p>
      </div>

      <Card
        title="Every campaign, ranked by spend"
        subtitle="Proposed daily is what the optimiser would set if you let it rebalance the same total budget."
      >
        <TableWrap>
          <table className="w-full min-w-[1000px] border-collapse">
            <thead>
              <tr className="border-b hairline">
                <Th>Campaign</Th>
                <Th align="right">Spend</Th>
                <Th align="right">Revenue</Th>
                <Th align="right">Orders</Th>
                <Th align="right">ROAS</Th>
                <Th align="right">CPA</Th>
                <Th align="right">Profit</Th>
                <Th align="right">Daily now</Th>
                <Th align="right">Proposed</Th>
                <Th align="right">Trend</Th>
                <Th align="right">Act</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((item) => {
                const flag = severityByCampaign.get(item.campaign.id);
                const line = planByCampaign.get(item.campaign.id);
                const dailyNow = safeDiv(item.totals.spend, windowDays);

                return (
                  <tr key={item.campaign.id} className="border-b align-top hairline last:border-0">
                    <Td>
                      <div className="flex flex-col gap-1">
                        <span className="flex items-center gap-2">
                          <ChannelDot color={channelColor(item.campaign.platform)} />
                          <span className="font-medium">{item.campaign.name}</span>
                          {item.campaign.status !== "active" ? (
                            <span className="rounded border px-1.5 text-[10px] uppercase text-[var(--text-muted)] hairline">
                              {item.campaign.status}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {platformLabel(item.campaign.platform)}
                          {item.campaign.objective ? ` · ${item.campaign.objective}` : ""}
                        </span>
                        {flag ? (
                          <span className="mt-0.5">
                            <SeverityBadge severity={flag.severity}>
                              {flag.title.split(": ").slice(1).join(": ") || flag.title}
                            </SeverityBadge>
                          </span>
                        ) : null}
                      </div>
                    </Td>
                    <Td align="right">
                      <Money value={item.totals.spend} currency={settings.currency} />
                    </Td>
                    <Td align="right">
                      <Money value={item.totals.attributedRevenue} currency={settings.currency} />
                    </Td>
                    <Td align="right">{formatNumber(item.totals.attributedOrders)}</Td>
                    <Td align="right">
                      <span
                        style={{
                          color:
                            item.derived.roas < breakEven
                              ? "var(--status-critical)"
                              : item.derived.roas >= settings.targetRoas
                                ? "var(--delta-up)"
                                : undefined,
                          fontWeight: 500,
                        }}
                      >
                        {item.derived.roas.toFixed(2)}x
                      </span>
                    </Td>
                    <Td align="right">
                      {item.totals.attributedOrders > 0
                        ? formatCompactCurrency(item.derived.cpa, settings.currency)
                        : "—"}
                    </Td>
                    <Td align="right">
                      <Money value={item.derived.grossProfit} currency={settings.currency} />
                    </Td>
                    <Td align="right">{formatCompactCurrency(dailyNow, settings.currency)}</Td>
                    <Td align="right">
                      {line ? (
                        <span
                          style={{
                            color:
                              line.proposedDailySpend === 0
                                ? "var(--status-critical)"
                                : line.changePct > 0.02
                                  ? "var(--delta-up)"
                                  : line.changePct < -0.02
                                    ? "var(--status-warning)"
                                    : undefined,
                          }}
                          title={line.reason}
                        >
                          {line.proposedDailySpend === 0
                            ? "stop"
                            : formatCompactCurrency(line.proposedDailySpend, settings.currency)}
                          {Math.abs(line.changePct) > 0.02 ? (
                            <span className="ml-1 text-[11px] text-[var(--text-muted)]">
                              {line.changePct > 0 ? "+" : ""}
                              {formatPercent(line.changePct, 0)}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td align="right">
                      <span className="inline-flex justify-end">
                        <Sparkline
                          values={item.series.map((day) => day.spend)}
                          color={channelColor(item.campaign.platform)}
                        />
                      </span>
                    </Td>
                    <Td align="right">
                      <CampaignActions
                        campaignId={item.campaign.id}
                        campaignName={item.campaign.name}
                        status={item.campaign.status}
                        suggestedBudget={line?.proposedDailySpend ?? null}
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card title="How the proposed budgets were worked out">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {plan.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
