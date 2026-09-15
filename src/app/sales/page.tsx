import { buildSnapshot } from "@/lib/analytics";
import { channelColor, platformLabel } from "@/lib/connectors/registry";
import { formatCompactCurrency, formatNumber, formatPercent, safeDiv } from "@/lib/util";
import { ChannelBars, TimeSeriesChart } from "@/components/charts";
import {
  Card,
  ChannelDot,
  EmptyState,
  Money,
  PrimaryLink,
  StatTile,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<string, string> = {
  click_id: "Click ID",
  utm_campaign: "UTM campaign",
  utm_source: "UTM source only",
  unattributed: "Untraceable",
};

const METHOD_NOTE: Record<string, string> = {
  click_id: "The strongest signal there is — the network's own click identifier survived to checkout.",
  utm_campaign: "Tagged link with a campaign we could match by name or id.",
  utm_source: "We know the channel but not which campaign, so it counts at channel level only.",
  unattributed: "No click id, no campaign tag. Organic, direct, email — or paid traffic whose tracking broke.",
};

export default function SalesPage() {
  const snapshot = buildSnapshot(30);

  if (snapshot.attribution.length === 0) {
    return (
      <EmptyState
        title="No orders yet"
        body="Connect a store or billing system and the portal can tell you which campaigns actually produced sales, rather than which ones claim to have."
        action={<PrimaryLink href="/connections">Connect a revenue source</PrimaryLink>}
      />
    );
  }

  const { attribution, settings, channels, portfolio } = snapshot;

  const totalRevenue = attribution.reduce((total, item) => total + item.order.revenue, 0);
  const newCustomerRevenue = attribution
    .filter((item) => item.order.isNewCustomer)
    .reduce((total, item) => total + item.order.revenue, 0);

  const byMethod = new Map<string, { orders: number; revenue: number }>();
  for (const item of attribution) {
    const bucket = byMethod.get(item.method) ?? { orders: 0, revenue: 0 };
    bucket.orders += 1;
    bucket.revenue += item.order.revenue;
    byMethod.set(item.method, bucket);
  }

  // Revenue by source, paid channels plus everything else that drove a sale.
  const bySource = new Map<string, { revenue: number; orders: number; paid: boolean; platform?: string }>();
  for (const item of attribution) {
    const key = item.platform
      ? platformLabel(item.platform)
      : (item.order.utmMedium === "email"
          ? "Email"
          : item.order.utmSource
            ? item.order.utmSource
            : "Direct / organic");
    const bucket = bySource.get(key) ?? {
      revenue: 0,
      orders: 0,
      paid: Boolean(item.platform),
      platform: item.platform ?? undefined,
    };
    bucket.revenue += item.order.revenue;
    bucket.orders += 1;
    bySource.set(key, bucket);
  }
  const sources = [...bySource.entries()].sort((a, b) => b[1].revenue - a[1].revenue);

  // Daily store revenue split into paid-attributed and everything else.
  const dayMap = new Map<string, { date: string; paid: number; other: number }>();
  for (const item of attribution) {
    const date = item.order.orderedAt.slice(0, 10);
    const row = dayMap.get(date) ?? { date, paid: 0, other: 0 };
    if (item.platform) row.paid += item.order.revenue;
    else row.other += item.order.revenue;
    dayMap.set(date, row);
  }
  const daily = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const paidRevenue = attribution
    .filter((item) => item.platform)
    .reduce((total, item) => total + item.order.revenue, 0);

  // Blended return: total store revenue against total ad spend. It answers a
  // different question from per-campaign ROAS and is far harder to game.
  const blendedRoas = safeDiv(totalRevenue, portfolio.totals.spend);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Sales and attribution</h1>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          {formatNumber(attribution.length)} orders in {snapshot.windowDays} days · this is the side of
          the ledger the ad networks cannot see.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Store revenue"
          value={formatCompactCurrency(totalRevenue, settings.currency)}
          hint="Every order, paid-driven or not"
        />
        <StatTile
          label="Paid-driven"
          value={formatPercent(safeDiv(paidRevenue, totalRevenue), 0)}
          hint={`${formatCompactCurrency(paidRevenue, settings.currency)} traced to a channel`}
        />
        <StatTile
          label="Blended return"
          value={`${blendedRoas.toFixed(2)}x`}
          hint="All store revenue ÷ all ad spend. Harder to game than per-campaign ROAS."
        />
        <StatTile
          label="New customers"
          value={formatPercent(safeDiv(newCustomerRevenue, totalRevenue), 0)}
          hint="Share of revenue from first-time buyers"
        />
      </div>

      <Card
        title="Store revenue, paid against everything else"
        subtitle="If the grey line carries the business, paid is a smaller lever than the ad dashboards suggest."
      >
        <TimeSeriesChart
          data={daily}
          series={[
            { key: "paid", label: "Traced to paid", color: "var(--series-1)" },
            { key: "other", label: "Direct, organic and email", color: "var(--series-2)" },
          ]}
          currency={settings.currency}
          height={240}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Revenue by source" subtitle="Where the orders actually came from.">
          <ChannelBars
            data={sources.map(([label, bucket]) => ({
              label,
              value: bucket.revenue,
              color: bucket.platform ? channelColor(bucket.platform) : "var(--text-muted)",
              secondary: `${formatNumber(bucket.orders)} orders`,
            }))}
            currency={settings.currency}
          />
        </Card>

        <Card
          title="How confident is each match?"
          subtitle="Attribution is a spectrum, not a fact. This is the spectrum."
        >
          <TableWrap>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b hairline">
                  <Th>Method</Th>
                  <Th align="right">Orders</Th>
                  <Th align="right">Revenue</Th>
                  <Th align="right">Share</Th>
                </tr>
              </thead>
              <tbody>
                {(["click_id", "utm_campaign", "utm_source", "unattributed"] as const).map((method) => {
                  const bucket = byMethod.get(method);
                  if (!bucket) return null;
                  return (
                    <tr key={method} className="border-b align-top hairline last:border-0">
                      <Td>
                        <div className="font-medium">{METHOD_LABEL[method]}</div>
                        <p className="mt-0.5 max-w-sm text-[11px] leading-snug text-[var(--text-muted)]">
                          {METHOD_NOTE[method]}
                        </p>
                      </Td>
                      <Td align="right">{formatNumber(bucket.orders)}</Td>
                      <Td align="right">
                        <Money value={bucket.revenue} currency={settings.currency} />
                      </Td>
                      <Td align="right">{formatPercent(safeDiv(bucket.revenue, totalRevenue), 0)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      </div>

      <Card
        title="Where the two sets of books disagree"
        subtitle="Network-reported revenue against matched store orders, per channel."
      >
        <TableWrap>
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b hairline">
                <Th>Channel</Th>
                <Th align="right">Network says</Th>
                <Th align="right">Store confirms</Th>
                <Th align="right">Gap</Th>
                <Th>Read this as</Th>
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => {
                const ratio = channel.derived.claimRatio;
                const verdict =
                  ratio === 0
                    ? "No confirmed orders to compare against."
                    : ratio > 3
                      ? "Too wide to judge the channel on. Fix the tagging before acting."
                      : ratio > 2
                        ? "Wider than view-through alone explains. Worth checking the UTM template."
                        : "Within the range normal cross-device and view-through behaviour explains.";
                return (
                  <tr key={channel.platform} className="border-b hairline last:border-0">
                    <Td>
                      <span className="flex items-center gap-2">
                        <ChannelDot color={channelColor(channel.platform)} />
                        {platformLabel(channel.platform)}
                      </span>
                    </Td>
                    <Td align="right">
                      <Money value={channel.totals.platformRevenue} currency={settings.currency} />
                    </Td>
                    <Td align="right">
                      <Money value={channel.totals.attributedRevenue} currency={settings.currency} />
                    </Td>
                    <Td align="right">
                      <span style={{ color: ratio > 2.5 ? "var(--status-warning)" : undefined }}>
                        {ratio > 0 ? `${ratio.toFixed(1)}x` : "—"}
                      </span>
                    </Td>
                    <Td className="text-[var(--text-secondary)]">{verdict}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
