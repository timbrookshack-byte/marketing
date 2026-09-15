import { buildSnapshot } from "@/lib/analytics";
import { adsConnectors, channelColor, platformLabel } from "@/lib/connectors/registry";
import { listCreativeBriefs } from "@/lib/repo";
import { isAiConfigured } from "@/lib/ai/client";
import { formatCompactCurrency, formatPercent, formatPercentFixed, safeDiv } from "@/lib/util";
import { Card, ChannelDot, Money, TableWrap, Td, Th } from "@/components/ui";
import { CreativeWorkshopForm } from "./workshop";

export const dynamic = "force-dynamic";

export default function CreativePage() {
  const snapshot = buildSnapshot(30);
  const briefs = listCreativeBriefs(10);

  // Rank creative on engagement relative to the campaign it sits in, because a
  // 1% CTR is excellent on one channel and poor on another.
  const campaignCtr = new Map(snapshot.campaigns.map((c) => [c.campaign.id, c.derived.ctr]));
  const ranked = snapshot.ads
    .filter((item) => item.totals.impressions > 1000)
    .map((item) => ({
      ...item,
      relative: safeDiv(item.derived.ctr, campaignCtr.get(item.ad.campaignId) ?? 0),
    }))
    .sort((a, b) => a.relative - b.relative);

  const laggards = ranked.slice(0, 6);
  const leaders = [...ranked].reverse().slice(0, 6);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Creative lab</h1>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          Retire what is dragging, then build the replacement against what is already working — not
          against a blank page.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Dragging the set down"
          subtitle="Click-through relative to the rest of the same campaign, so the comparison is fair."
        >
          <AdTable rows={laggards} currency={snapshot.settings.currency} tone="bad" />
        </Card>
        <Card title="Worth building on" subtitle="The angles that are earning their impressions.">
          <AdTable rows={leaders} currency={snapshot.settings.currency} tone="good" />
        </Card>
      </div>

      <Card
        title="Workshop new ads"
        subtitle="Claude sees what is currently running on the channel and how it performs, then writes variants that test genuinely different angles — within that platform's character limits."
      >
        <CreativeWorkshopForm
          aiConfigured={isAiConfigured()}
          platforms={adsConnectors.map((connector) => ({
            id: connector.platform,
            label: connector.displayName,
          }))}
        />
      </Card>

      {briefs.length > 0 ? (
        <Card title="Saved briefs">
          <div className="flex flex-col gap-6">
            {briefs.map((brief) => (
              <article key={brief.id} className="border-b pb-6 last:border-0 last:pb-0 hairline">
                <header className="mb-3 flex flex-wrap items-center gap-2">
                  <ChannelDot color={channelColor(brief.platform)} />
                  <span className="text-[14px] font-medium">{platformLabel(brief.platform)}</span>
                  <span className="text-[12px] text-[var(--text-muted)]">
                    {brief.objective} · {brief.audience}
                  </span>
                  <span className="ml-auto text-[11px] text-[var(--text-muted)]">
                    {new Date(brief.createdAt).toLocaleDateString()}
                  </span>
                </header>
                <div className="grid gap-3 md:grid-cols-2">
                  {brief.variants.map((variant, index) => (
                    <div key={index} className="rounded-lg border p-3 hairline">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                        {variant.angle}
                      </div>
                      <div className="mt-1.5 text-[14px] font-medium">{variant.headline}</div>
                      <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{variant.body}</p>
                      <div className="mt-2 text-[12px] text-[var(--text-muted)]">
                        CTA: {variant.callToAction}
                      </div>
                      <p className="mt-2 border-t pt-2 text-[12px] text-[var(--text-secondary)] hairline">
                        <strong className="font-medium">Testing:</strong> {variant.hypothesis}
                      </p>
                      <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                        <strong className="font-medium">Wins if:</strong> {variant.successMetric}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  <strong className="font-medium text-[var(--text-primary)]">Test plan.</strong>{" "}
                  {brief.testPlan}
                </p>
              </article>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function AdTable({
  rows,
  currency,
  tone,
}: {
  rows: { ad: { id: string; name: string; headline: string | null }; campaignName: string; platform: string; totals: { spend: number }; derived: { ctr: number }; relative: number }[];
  currency: string;
  tone: "good" | "bad";
}) {
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-[var(--text-secondary)]">
        Not enough impressions yet to rank creative fairly.
      </p>
    );
  }

  return (
    <TableWrap>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b hairline">
            <Th>Ad</Th>
            <Th align="right">Spend</Th>
            <Th align="right">CTR</Th>
            <Th align="right">vs campaign</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ad.id} className="border-b align-top hairline last:border-0">
              <Td>
                <span className="flex items-center gap-2">
                  <ChannelDot color={channelColor(row.platform)} />
                  <span className="font-medium">{row.ad.name}</span>
                </span>
                <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{row.campaignName}</div>
                {row.ad.headline ? (
                  <div className="mt-1 max-w-xs truncate text-[12px] text-[var(--text-secondary)]">
                    &ldquo;{row.ad.headline}&rdquo;
                  </div>
                ) : null}
              </Td>
              <Td align="right">
                <Money value={row.totals.spend} currency={currency} />
              </Td>
              <Td align="right">{formatPercentFixed(row.derived.ctr)}</Td>
              <Td align="right">
                <span
                  style={{
                    color:
                      row.relative < 0.7
                        ? "var(--status-critical)"
                        : row.relative > 1.2
                          ? "var(--delta-up)"
                          : undefined,
                    fontWeight: 500,
                  }}
                >
                  {row.relative > 0 ? `${row.relative.toFixed(2)}x` : "—"}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[12px] text-[var(--text-muted)]">
        {tone === "bad"
          ? "Below 0.7x means the ad is taking budget to deliver worse engagement than the ads beside it."
          : "Above 1.2x is an angle worth extending rather than replacing."}{" "}
        Spend is exact; revenue at ad level is apportioned from the campaign by share of clicks —
        networks do not report orders per creative.
      </p>
    </TableWrap>
  );
}
