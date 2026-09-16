import Link from "next/link";
import { buildSnapshot, breakEvenRoas, trend } from "@/lib/analytics";
import { channelColor, platformLabel } from "@/lib/connectors/registry";
import { listConnections } from "@/lib/repo";
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  safeDiv,
} from "@/lib/util";
import { ChannelBars, TimeSeriesChart } from "@/components/charts";
import { Card, EmptyState, Money, PrimaryLink, SeverityBadge, StatTile } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function OverviewPage() {
  const connections = listConnections();

  if (connections.length === 0) {
    return (
      <EmptyState
        title="Nothing connected yet"
        body="Connect an ad account and a store to start. Nothing here is estimated or simulated — every number comes from an account you have connected."
        action={<PrimaryLink href="/connections">Go to connections</PrimaryLink>}
      />
    );
  }

  const snapshot = buildSnapshot(30);

  if (snapshot.isEmpty) {
    return (
      <EmptyState
        title="Connected, but no data yet"
        body="The accounts are linked but nothing has been pulled in. Run a sync from the connections page to load the last 90 days."
        action={<PrimaryLink href="/connections">Run a sync</PrimaryLink>}
      />
    );
  }

  const { portfolio, channels, settings, findings, plan, windowDays } = snapshot;
  const derived = portfolio.derived;
  const breakEven = breakEvenRoas(settings);

  const spendTrend = trend(portfolio.series, (day) => day.spend);
  const revenueTrend = trend(portfolio.series, (day) => day.attributedRevenue);
  const recentRoas = safeDiv(revenueTrend.recent, spendTrend.recent);
  const priorRoas = safeDiv(revenueTrend.previous, spendTrend.previous);

  // "Draining" means only the campaigns that cannot pay for themselves at any
  // budget. Campaigns merely below target are a trim, not a leak, and lumping
  // the two together overstates the problem.
  const drainingFindings = findings.filter((finding) => finding.type === "pause");
  const trimFindings = findings.filter((finding) => finding.type === "reduce_budget");
  const monthlyWaste = drainingFindings.reduce((total, f) => total + f.expectedMonthlyImpact, 0);

  const unattributed = snapshot.attribution.filter((item) => item.method === "unattributed");
  const unattributedRevenue = unattributed.reduce((total, item) => total + item.order.revenue, 0);
  const totalOrderRevenue = snapshot.attribution.reduce((total, item) => total + item.order.revenue, 0);

  const topActions = findings.slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Where the money went</h1>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          {windowDays} days to {snapshot.range.end} · {channels.length} channels ·{" "}
          {formatNumber(portfolio.totals.attributedOrders)} attributed orders
        </p>
      </div>

      {/* The five numbers that decide whether anything else matters. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Ad spend"
          value={formatCompactCurrency(derived.spend, settings.currency)}
          delta={spendTrend.changePct}
          deltaLabel="vs prior half"
        />
        <StatTile
          label="Tracked revenue"
          value={formatCompactCurrency(derived.attributedRevenue, settings.currency)}
          delta={revenueTrend.changePct}
          deltaLabel="vs prior half"
        />
        <StatTile
          label="Return on spend"
          value={`${derived.roas.toFixed(2)}x`}
          tone={derived.roas < breakEven ? "critical" : derived.roas >= settings.targetRoas ? "good" : "neutral"}
          hint={`Break-even ${breakEven.toFixed(2)}x · target ${settings.targetRoas.toFixed(1)}x`}
        />
        <StatTile
          label="Gross profit"
          value={formatCompactCurrency(derived.grossProfit, settings.currency)}
          tone={derived.grossProfit >= 0 ? "good" : "critical"}
          hint={`At a ${formatPercent(settings.grossMargin, 0)} margin, after ad spend`}
        />
        <StatTile
          label="Draining now"
          value={formatCompactCurrency(monthlyWaste, settings.currency)}
          tone={monthlyWaste > 0 ? "critical" : "good"}
          hint="Per month, in campaigns that cannot pay for themselves"
        />
      </div>

      {monthlyWaste > 0 ? (
        <Card
          title="The short version"
          subtitle="What the numbers say to do first, before any AI is involved."
          action={<PrimaryLink href="/recommendations">See all actions</PrimaryLink>}
        >
          <p className="text-[14px] leading-relaxed">
            {drainingFindings.length === 1
              ? "One campaign is"
              : `${drainingFindings.length} campaigns are`}{" "}
            burning about{" "}
            <strong style={{ color: "var(--status-critical)" }}>
              {formatCurrency(monthlyWaste, settings.currency)} a month
            </strong>{" "}
            with nothing to show for it
            {trimFindings.length > 0 ? (
              <>
                , and {trimFindings.length === 1 ? "another one is" : `another ${trimFindings.length} are`}{" "}
                profitable but below target
              </>
            ) : null}
            . Moving that money to the campaigns that are already working is worth an estimated{" "}
            <strong style={{ color: "var(--delta-up)" }}>
              {formatCurrency(plan.projectedMonthlyProfitDelta, settings.currency)}
            </strong>{" "}
            of extra gross profit per month — after allowing for the fact that scaling a winner never
            returns at its current rate.
            {recentRoas > 0 && priorRoas > 0 ? (
              <>
                {" "}
                Account-wide return moved from {priorRoas.toFixed(2)}x to {recentRoas.toFixed(2)}x
                across the window.
              </>
            ) : null}
          </p>
        </Card>
      ) : null}

      <Card
        title="Spend against tracked revenue"
        subtitle="Both in the same currency, so they belong on one axis. Two scales on one plot invent a relationship that is not in the data."
      >
        <TimeSeriesChart
          data={portfolio.series.map((day) => ({
            date: day.date,
            spend: day.spend,
            revenue: day.attributedRevenue,
          }))}
          series={[
            { key: "revenue", label: "Tracked revenue", color: "var(--series-1)" },
            { key: "spend", label: "Ad spend", color: "var(--series-2)" },
          ]}
          currency={settings.currency}
          height={260}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Spend by channel" subtitle="Where the budget is going.">
          <ChannelBars
            data={channels.map((channel) => ({
              label: platformLabel(channel.platform),
              value: channel.totals.spend,
              color: channelColor(channel.platform),
              secondary: `${channel.derived.roas.toFixed(2)}x`,
            }))}
            currency={settings.currency}
          />
        </Card>

        <Card
          title="Return by channel"
          subtitle="The same channels, ranked by what they give back rather than what they take."
        >
          <ChannelBars
            data={[...channels]
              .sort((a, b) => b.derived.roas - a.derived.roas)
              .map((channel) => ({
                label: platformLabel(channel.platform),
                value: channel.derived.roas,
                color: channelColor(channel.platform),
                secondary: `${formatCompactCurrency(channel.derived.grossProfit, settings.currency)} profit`,
              }))}
            valueFormat="number"
          />
          <p className="mt-4 text-[12px] text-[var(--text-muted)]">
            Break-even is {breakEven.toFixed(2)}x at your margin. Anything under that is selling at a
            loss no matter how large the revenue line looks.
          </p>
        </Card>
      </div>

      <Card
        title="Do these first"
        subtitle="Ranked by money, not by tidiness."
        action={<PrimaryLink href="/recommendations">Full list</PrimaryLink>}
      >
        <ul className="flex flex-col divide-y hairline">
          {topActions.map((finding) => (
            <li key={`${finding.type}-${finding.targetId}`} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={finding.severity} />
                <span className="text-[14px] font-medium">{finding.title}</span>
                <span className="ml-auto text-[13px] font-semibold">
                  <Money
                    value={
                      finding.type === "pause" || finding.type === "reduce_budget"
                        ? finding.expectedMonthlyImpact
                        : finding.expectedMonthlyImpact
                    }
                    currency={settings.currency}
                  />
                  <span className="ml-1 font-normal text-[var(--text-muted)]">/mo</span>
                </span>
              </div>
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {finding.rationale}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      {unattributedRevenue > 0 ? (
        <Card title="How much of this can you trust?">
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
            {formatCompactCurrency(unattributedRevenue, settings.currency)} of store revenue —{" "}
            {formatPercent(safeDiv(unattributedRevenue, totalOrderRevenue), 0)} of the total — arrived
            with no click id and no campaign tag. Some of that is genuinely organic, direct and email.
            Some of it is paid traffic whose tracking broke on the way in. Until that share comes
            down, every channel below is being judged on slightly less than the full picture, and the
            weakest-looking channels are the ones most likely to be underselling themselves.{" "}
            <Link href="/sales" className="underline underline-offset-2">
              See the attribution breakdown
            </Link>
            .
          </p>
        </Card>
      ) : null}
    </div>
  );
}
