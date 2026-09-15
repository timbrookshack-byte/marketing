import { buildSnapshot, breakEvenRoas } from "@/lib/analytics";
import { channelColor, platformLabel } from "@/lib/connectors/registry";
import { formatCompactCurrency, formatNumber, formatPercent, formatPercentFixed } from "@/lib/util";
import { EfficiencyScatter, Sparkline, TimeSeriesChart } from "@/components/charts";
import { Card, ChannelDot, EmptyState, Money, PrimaryLink, TableWrap, Td, Th } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function ChannelsPage() {
  const snapshot = buildSnapshot(30);

  if (snapshot.isEmpty) {
    return (
      <EmptyState
        title="No channel data yet"
        body="Once an ad account is connected and synced, every channel lands here side by side on the same definitions."
        action={<PrimaryLink href="/connections">Connect a channel</PrimaryLink>}
      />
    );
  }

  const { channels, settings, campaigns } = snapshot;
  const breakEven = breakEvenRoas(settings);

  // The daily series for every channel, aligned on date so one chart can show
  // them all on a single axis.
  const dates = [...new Set(channels.flatMap((c) => c.series.map((d) => d.date)))].sort();
  const spendByChannel = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const channel of channels) {
      row[channel.platform] = channel.series.find((d) => d.date === date)?.spend ?? 0;
    }
    return row;
  });

  // Past eight entities a ninth hue would not be distinguishable, so the chart
  // shows the largest channels and the table carries the rest.
  const charted = channels.slice(0, 8);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Channels</h1>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          Every network on the same definitions, {snapshot.windowDays} days to {snapshot.range.end}.
        </p>
      </div>

      <Card
        title="Where every campaign sits"
        subtitle="The two lines are the only thresholds that matter: break-even and your target."
      >
        <EfficiencyScatter
          data={campaigns
            .filter((item) => item.totals.spend > 0)
            .map((item) => ({
              label: item.campaign.name,
              x: item.totals.spend,
              y: item.derived.roas,
              size: item.totals.spend,
              status:
                item.derived.roas < breakEven
                  ? ("critical" as const)
                  : item.derived.roas < settings.targetRoas
                    ? ("warning" as const)
                    : ("good" as const),
            }))}
          breakEven={breakEven}
          target={settings.targetRoas}
          currency={settings.currency}
        />
      </Card>

      <Card title="Daily spend by channel" subtitle="One axis, one currency, colour fixed to the channel.">
        <TimeSeriesChart
          data={spendByChannel as { date: string }[]}
          series={charted.map((channel) => ({
            key: channel.platform,
            label: platformLabel(channel.platform),
            color: channelColor(channel.platform),
          }))}
          currency={settings.currency}
          height={260}
        />
      </Card>

      <Card title="Channel table" subtitle="Sorted by spend. Claim ratio is how much more the network says it drove than the store recorded.">
        <TableWrap>
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr className="border-b hairline">
                <Th>Channel</Th>
                <Th align="right">Spend</Th>
                <Th align="right">Tracked revenue</Th>
                <Th align="right">Orders</Th>
                <Th align="right">ROAS</Th>
                <Th align="right">CPA</Th>
                <Th align="right">CTR</Th>
                <Th align="right">Gross profit</Th>
                <Th align="right">Claim ratio</Th>
                <Th align="right">Trend</Th>
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => (
                <tr key={channel.platform} className="border-b hairline last:border-0">
                  <Td>
                    <span className="flex items-center gap-2">
                      <ChannelDot color={channelColor(channel.platform)} />
                      <span className="font-medium">{platformLabel(channel.platform)}</span>
                      <span className="text-[var(--text-muted)]">
                        {channel.activeCampaignCount}/{channel.campaignCount} live
                      </span>
                    </span>
                  </Td>
                  <Td align="right">
                    <Money value={channel.totals.spend} currency={settings.currency} />
                  </Td>
                  <Td align="right">
                    <Money value={channel.totals.attributedRevenue} currency={settings.currency} />
                  </Td>
                  <Td align="right">{formatNumber(channel.totals.attributedOrders)}</Td>
                  <Td align="right">
                    <span
                      style={{
                        color:
                          channel.derived.roas < breakEven
                            ? "var(--status-critical)"
                            : channel.derived.roas >= settings.targetRoas
                              ? "var(--delta-up)"
                              : undefined,
                        fontWeight: 500,
                      }}
                    >
                      {channel.derived.roas.toFixed(2)}x
                    </span>
                  </Td>
                  <Td align="right">
                    {channel.derived.cpa > 0
                      ? formatCompactCurrency(channel.derived.cpa, settings.currency)
                      : "—"}
                  </Td>
                  <Td align="right">{formatPercentFixed(channel.derived.ctr)}</Td>
                  <Td align="right">
                    <Money value={channel.derived.grossProfit} currency={settings.currency} />
                  </Td>
                  <Td align="right">
                    <span
                      title="Network-reported revenue divided by matched store revenue"
                      style={{ color: channel.derived.claimRatio > 2.5 ? "var(--status-warning)" : undefined }}
                    >
                      {channel.derived.claimRatio > 0 ? `${channel.derived.claimRatio.toFixed(1)}x` : "—"}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="inline-flex justify-end">
                      <Sparkline
                        values={channel.series.map((day) => day.spend)}
                        color={channelColor(channel.platform)}
                      />
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
