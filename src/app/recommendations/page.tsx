import { buildSnapshot } from "@/lib/analytics";
import { channelColor, platformLabel } from "@/lib/connectors/registry";
import { listRecommendations } from "@/lib/repo";
import { isAiConfigured } from "@/lib/ai/client";
import { formatCompactCurrency, formatPercent } from "@/lib/util";
import { Card, ChannelDot, Money, SeverityBadge, StatTile, TableWrap, Td, Th } from "@/components/ui";
import { RecommendationControls, RunAnalysisButton } from "./controls";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  pause: "Stop it",
  reduce_budget: "Spend less",
  scale_budget: "Spend more",
  reallocate: "Move the money",
  test_creative: "New creative",
  fix_tracking: "Fix tracking",
  investigate: "Look into it",
};

export default function RecommendationsPage() {
  const snapshot = buildSnapshot(30);
  const stored = listRecommendations();
  const aiRecommendations = stored.filter((rec) => rec.source === "ai");
  const openAi = aiRecommendations.filter((rec) => rec.status === "open");

  const { findings, settings, plan } = snapshot;

  const stopNow = findings.filter((f) => f.type === "pause");
  const scaleUp = findings.filter((f) => f.type === "scale_budget");
  const monthlyWaste = stopNow.reduce((total, f) => total + f.expectedMonthlyImpact, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Actions</h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            Arithmetic first, judgement second. The rules below are deterministic — the same data
            always produces the same list.
          </p>
        </div>
        <RunAnalysisButton aiConfigured={isAiConfigured()} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Stop now"
          value={formatCompactCurrency(monthlyWaste, settings.currency)}
          tone={monthlyWaste > 0 ? "critical" : "good"}
          hint={`${stopNow.length} campaigns that cannot pay for themselves`}
        />
        <StatTile
          label="Scale up"
          value={formatCompactCurrency(
            scaleUp.reduce((total, f) => total + f.expectedMonthlyImpact, 0),
            settings.currency,
          )}
          tone="good"
          hint={`${scaleUp.length} campaigns with room to grow`}
        />
        <StatTile
          label="Rebalancing is worth"
          value={formatCompactCurrency(plan.projectedMonthlyProfitDelta, settings.currency)}
          tone={plan.projectedMonthlyProfitDelta >= 0 ? "good" : "critical"}
          hint="Extra monthly gross profit at the same total budget"
        />
        <StatTile
          label="Open AI actions"
          value={String(openAi.length)}
          hint={isAiConfigured() ? "From the last Claude analysis" : "Claude is not configured"}
        />
      </div>

      <Card
        title="What the numbers say"
        subtitle="Generated from the data itself — no model involved, nothing to second-guess."
      >
        <ul className="flex flex-col divide-y hairline">
          {findings.map((finding) => (
            <li key={`${finding.type}-${finding.targetId}`} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={finding.severity} />
                <span className="rounded border px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] hairline">
                  {TYPE_LABEL[finding.type] ?? finding.type}
                </span>
                {finding.platform ? (
                  <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    <ChannelDot color={channelColor(finding.platform)} />
                    {platformLabel(finding.platform)}
                  </span>
                ) : null}
                <span className="ml-auto flex items-baseline gap-2 text-[13px]">
                  <span className="text-[var(--text-muted)]">
                    {formatPercent(finding.confidence, 0)} confidence
                  </span>
                  <span className="font-semibold">
                    <Money value={finding.expectedMonthlyImpact} currency={settings.currency} />
                    <span className="font-normal text-[var(--text-muted)]">/mo</span>
                  </span>
                </span>
              </div>
              <h3 className="text-[14px] font-medium">{finding.title}</h3>
              <p className="max-w-4xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {finding.rationale}
              </p>
              <details className="text-[12px] text-[var(--text-muted)]">
                <summary className="cursor-pointer select-none">The numbers behind this</summary>
                <TableWrap>
                  <table className="mt-2 border-collapse">
                    <tbody>
                      {Object.entries(finding.evidence).map(([key, value]) => (
                        <tr key={key}>
                          <Td className="pr-6 text-[var(--text-secondary)]">{key}</Td>
                          <Td align="right">
                            {typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(value)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </details>
            </li>
          ))}
          {findings.length === 0 ? (
            <li className="py-6 text-center text-[13px] text-[var(--text-secondary)]">
              Nothing is flagged. Either the account is in good shape or there is not yet enough spend
              to judge it.
            </li>
          ) : null}
        </ul>
      </Card>

      {aiRecommendations.length > 0 ? (
        <Card
          title="What Claude made of it"
          subtitle="Judgement on top of the findings above — what matters most, what they mean together, and what a rule cannot see."
        >
          <ul className="flex flex-col divide-y hairline">
            {aiRecommendations.map((rec) => (
              <li key={rec.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={rec.severity} />
                  <span className="rounded border px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] hairline">
                    {TYPE_LABEL[rec.type] ?? rec.type}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">{rec.targetName}</span>
                  <span className="ml-auto flex items-baseline gap-2 text-[13px]">
                    <span className="text-[var(--text-muted)]">
                      {formatPercent(rec.confidence, 0)} confidence
                    </span>
                    <span className="font-semibold">
                      <Money value={rec.expectedMonthlyImpact} currency={settings.currency} />
                      <span className="font-normal text-[var(--text-muted)]">/mo</span>
                    </span>
                  </span>
                </div>
                <h3 className="text-[14px] font-medium">{rec.title}</h3>
                <p className="max-w-4xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  {rec.rationale}
                </p>
                <RecommendationControls id={rec.id} status={rec.status} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title="The reallocation, line by line"
        subtitle={`Same total budget of ${formatCompactCurrency(plan.totalDailyBudget, settings.currency)} a day, distributed so the last dollar earns the same everywhere.`}
      >
        <TableWrap>
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="border-b hairline">
                <Th>Campaign</Th>
                <Th align="right">Now</Th>
                <Th align="right">Proposed</Th>
                <Th align="right">Change</Th>
                <Th align="right">Next-dollar return</Th>
                <Th align="right">Monthly profit</Th>
                <Th>Why</Th>
              </tr>
            </thead>
            <tbody>
              {plan.lines.map((line) => (
                <tr key={line.campaignId} className="border-b align-top hairline last:border-0">
                  <Td>
                    <span className="flex items-center gap-2">
                      <ChannelDot color={channelColor(line.platform)} />
                      {line.campaignName}
                    </span>
                  </Td>
                  <Td align="right">{formatCompactCurrency(line.currentDailySpend, settings.currency)}</Td>
                  <Td align="right">
                    {line.proposedDailySpend === 0 ? (
                      <span style={{ color: "var(--status-critical)" }}>stop</span>
                    ) : (
                      formatCompactCurrency(line.proposedDailySpend, settings.currency)
                    )}
                  </Td>
                  <Td align="right">
                    {Math.abs(line.changePct) < 0.02 ? (
                      "—"
                    ) : (
                      <span
                        style={{
                          color: line.changePct > 0 ? "var(--delta-up)" : "var(--status-warning)",
                        }}
                      >
                        {line.changePct > 0 ? "+" : ""}
                        {formatPercent(line.changePct, 0)}
                      </span>
                    )}
                  </Td>
                  <Td align="right">{line.marginalRoas > 0 ? `${line.marginalRoas.toFixed(2)}x` : "—"}</Td>
                  <Td align="right">
                    <Money value={line.projectedMonthlyProfitDelta} currency={settings.currency} />
                  </Td>
                  <Td className="max-w-[300px] text-[12px] text-[var(--text-secondary)]">{line.reason}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
