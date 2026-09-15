import { buildInspirationSnapshot, latestAngleReport, listInspirationRuns } from "@/lib/inspiration";
import { sourceLabel } from "@/lib/inspiration/registry";
import { channelColor, platformLabel } from "@/lib/connectors/registry";
import { isAiConfigured } from "@/lib/ai/client";
import { formatNumber } from "@/lib/util";
import { Card, ChannelDot, SeverityBadge, StatTile, TableWrap, Td, Th } from "@/components/ui";
import { AngleAnalysisButton, CompetitorManager } from "./controls";

export const dynamic = "force-dynamic";

const BAND_COPY: Record<string, { label: string; severity: "good" | "warning" | "neutral" | "critical" }> = {
  proven: { label: "Still running, months in", severity: "good" },
  promising: { label: "Past the cut point", severity: "warning" },
  early: { label: "Too new to read", severity: "neutral" },
  retired: { label: "They cut it", severity: "critical" },
};

export default function InspirationPage() {
  const snapshot = buildInspirationSnapshot();
  const report = latestAngleReport();
  const runs = listInspirationRuns(8);

  const proven = snapshot.concepts.filter((item) => item.traction.band === "proven");
  const retired = snapshot.concepts.filter((item) => item.traction.band === "retired");
  const gaps = (report?.gaps ?? []) as {
    angle: string;
    whyItMatters: string;
    risk: string;
    priority: string;
  }[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Concept inspiration</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
          What other brands are running, and which of it is probably working. Nobody publishes their
          return on ad spend, so this does not pretend to show it — it reads the one thing public ad
          libraries do expose, which is <strong>how long an ad has been running</strong>. Advertisers
          cut losers within days.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Brands watched"
          value={String(snapshot.competitors.length)}
          hint={`${formatNumber(snapshot.ranked.length)} creatives stored`}
        />
        <StatTile
          label="Distinct concepts"
          value={String(snapshot.concepts.length)}
          hint="Rewordings of one promise counted once"
        />
        <StatTile
          label="Long-runners"
          value={String(proven.length)}
          tone="good"
          hint="Live 90+ days — the strongest public signal there is"
        />
        <StatTile
          label="They cut these"
          value={String(retired.length)}
          tone={retired.length > 0 ? "critical" : "neutral"}
          hint="Rejected experiments. Worth knowing before you repeat one."
        />
      </div>

      <CompetitorManager
        competitors={snapshot.competitors}
        sources={snapshot.sources}
        aiConfigured={isAiConfigured()}
      />

      {snapshot.isEmpty ? null : (
        <Card
          title="What the evidence says"
          subtitle="Ranked by how much the public record supports the idea, not by how new or clever it is."
        >
          <div className="flex flex-col divide-y hairline">
            {snapshot.concepts.map((concept) => {
              const band = BAND_COPY[concept.traction.band];
              return (
                <article
                  key={`${concept.source}-${concept.externalId}`}
                  className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={band.severity}>{band.label}</SeverityBadge>
                    <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      <ChannelDot color={channelColor(concept.platform)} />
                      {concept.platform === "unknown" ? "Unknown platform" : platformLabel(concept.platform)}
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      via {sourceLabel(concept.source)}
                    </span>
                    <span className="ml-auto flex items-baseline gap-3 text-[12px]">
                      <span className="tnum text-[var(--text-secondary)]">
                        {concept.traction.daysLive}d {concept.traction.isLive ? "live" : "then cut"}
                      </span>
                      {concept.traction.variantCount > 1 ? (
                        <span className="tnum text-[var(--text-secondary)]">
                          {concept.traction.variantCount} variants
                        </span>
                      ) : null}
                      <span className="tnum font-semibold">{concept.traction.score}</span>
                    </span>
                  </div>

                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-semibold">{concept.advertiser}</span>
                    {concept.headline ? (
                      <span className="text-[14px]">&ldquo;{concept.headline}&rdquo;</span>
                    ) : null}
                  </div>

                  {concept.body ? (
                    <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
                      {concept.body}
                    </p>
                  ) : null}

                  <p className="max-w-3xl text-[12px] leading-relaxed text-[var(--text-muted)]">
                    {concept.traction.verdict}
                  </p>

                  {concept.permalink ? (
                    <a
                      href={concept.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-[var(--text-muted)] underline underline-offset-2"
                    >
                      See it in the public ad library
                    </a>
                  ) : null}
                </article>
              );
            })}
          </div>
        </Card>
      )}

      <Card
        title="Where you are not competing"
        subtitle="Clustering both sides on the promise being made, then subtracting. A gap only counts if your own ads genuinely do not make that promise."
        action={<AngleAnalysisButton aiConfigured={isAiConfigured()} hasData={!snapshot.isEmpty} />}
      >
        {report ? (
          <div className="flex flex-col gap-5">
            <p className="max-w-4xl text-[14px] leading-relaxed">{report.summary}</p>

            {gaps.length > 0 ? (
              <div className="flex flex-col gap-3">
                {gaps.map((gap) => (
                  <div key={gap.angle} className="rounded-lg border p-3 hairline">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge
                        severity={
                          gap.priority === "high" ? "critical" : gap.priority === "medium" ? "warning" : "neutral"
                        }
                      >
                        {gap.priority} priority
                      </SeverityBadge>
                      <h3 className="text-[14px] font-medium">{gap.angle}</h3>
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                      {gap.whyItMatters}
                    </p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
                      <strong className="font-medium">Why it might not transfer:</strong> {gap.risk}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-[var(--text-secondary)]">
                No gaps found — your creative already covers the angles this competitive set runs.
              </p>
            )}

            {(report.concepts as { angle: string; channel: string; headline: string; body: string; callToAction: string; whyThisChannel: string; inspiredBy: string; howItDiffers: string; successMetric: string }[]).length > 0 ? (
              <div>
                <h3 className="mb-3 text-[13px] font-semibold">Concepts to test</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {(report.concepts as { angle: string; channel: string; headline: string; body: string; callToAction: string; whyThisChannel: string; inspiredBy: string; howItDiffers: string; successMetric: string }[]).map(
                    (concept, index) => (
                      <article key={index} className="rounded-lg border p-3 hairline">
                        <div className="flex items-center gap-2">
                          <ChannelDot color={channelColor(concept.channel)} />
                          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                            {concept.angle}
                          </span>
                        </div>
                        <h4 className="mt-1.5 text-[14px] font-medium">{concept.headline}</h4>
                        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{concept.body}</p>
                        <div className="mt-2 text-[12px] text-[var(--text-muted)]">
                          CTA: {concept.callToAction}
                        </div>
                        <p className="mt-2 border-t pt-2 text-[12px] leading-relaxed text-[var(--text-secondary)] hairline">
                          <strong className="font-medium text-[var(--text-primary)]">Prompted by:</strong>{" "}
                          {concept.inspiredBy}
                        </p>
                        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                          <strong className="font-medium text-[var(--text-primary)]">Ours, not theirs:</strong>{" "}
                          {concept.howItDiffers}
                        </p>
                        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                          <strong className="font-medium text-[var(--text-primary)]">Wins if:</strong>{" "}
                          {concept.successMetric}
                        </p>
                      </article>
                    ),
                  )}
                </div>
              </div>
            ) : null}

            {report.caveats.length > 0 ? (
              <div>
                <h3 className="mb-1.5 text-[13px] font-semibold">What would make this wrong</h3>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  {report.caveats.map((caveat) => (
                    <li key={caveat}>{caveat}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-[11px] text-[var(--text-muted)]">
              Generated {new Date(report.createdAt).toLocaleString()}.
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--text-secondary)]">
            Nothing analysed yet. Add the brands you compete with, pull their ads, then run the angle
            analysis to see which of their promises you are not making.
          </p>
        )}
      </Card>

      <Card
        title="Read this before acting on any of it"
        subtitle="The reasoning behind the scores, and the three ways it can mislead you."
      >
        <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          <p>
            <strong className="text-[var(--text-primary)]">What the score is.</strong> A paid ad costs
            money every day it delivers. Advertisers watch that and cut what does not pay, usually
            within a week or two. So an ad still live after three months has survived a renewed
            decision to keep funding it, every one of those days — and nobody builds six variants of a
            concept that flopped. That is behavioural evidence, not a claim anyone made about
            themselves.
          </p>
          <p>
            <strong className="text-[var(--text-primary)]">Where it misleads.</strong> A big brand can
            run an awareness ad for a year on a budget line that never had a return target, so
            anything past about 300 days is flagged rather than trusted. Evergreen creative is
            sometimes just neglect. And their economics are not yours: a 70%-margin brand can sustain
            a cost per sale that would bankrupt a 25%-margin retailer.
          </p>
          <p>
            <strong className="text-[var(--text-primary)]">So treat a high score as</strong> &ldquo;worth
            stealing the idea and testing&rdquo;, never as &ldquo;this will work for us&rdquo;.
          </p>
        </div>
      </Card>

      {runs.length > 0 ? (
        <Card title="Recent pulls">
          <TableWrap>
            <table className="w-full min-w-[620px] border-collapse">
              <thead>
                <tr className="border-b hairline">
                  <Th>When</Th>
                  <Th>Source</Th>
                  <Th>Status</Th>
                  <Th align="right">Found</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b align-top hairline last:border-0">
                    <Td>{new Date(run.startedAt).toLocaleString()}</Td>
                    <Td>{sourceLabel(run.source)}</Td>
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
                    <Td align="right">{run.found}</Td>
                    <Td className="max-w-md text-[12px] text-[var(--text-secondary)]">
                      {run.error ?? "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ) : null}
    </div>
  );
}
