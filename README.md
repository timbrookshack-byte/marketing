# 360 Marketing

Every ad channel and every sale in one place, with an analysis layer that says where the next
dollar should go — and which campaigns to stop funding today.

Built around one idea: **an ad network marking its own homework is not evidence.** The portal
pulls spend from the networks and orders from your store, matches them back to each other, and
judges every campaign on money that actually arrived.

---

## What it does

**Connects the channels.** One connector interface covers every platform, so adding a network is
a new file and one line in the registry — nothing downstream changes.

| Live | Ad platforms | Revenue & analytics |
|---|---|---|
| Implemented | Google Ads, Meta Ads, OpenAI Ads*, LinkedIn Ads, TikTok Ads | Shopify, Stripe, WooCommerce, GA4 |
| OAuth wired, fetch still to write | Microsoft Advertising, Reddit, X, Amazon, Pinterest, Snapchat | — |

\* OpenAI Ads is **provisional** — see [below](#a-note-on-openai-ads).

Every platform in both rows appears in the UI, carries demo data, and is included in
cross-channel analysis. The ones without a live fetch throw a specific, actionable error rather
than silently returning nothing, so "no data" is never ambiguous.

**Closes the loop on revenue.** Store orders are matched back to campaigns by click id
(`gclid`, `fbclid`, `ttclid`, `oaiclid`…), then by UTM campaign, then by UTM source. Anything
that matches none of those lands in an explicit unattributed bucket rather than being spread
around — guessing is how dashboards start lying.

**Finds the leaks, deterministically.** Before any model is involved, a rules engine flags:

- spend with zero attributed orders, with a statistical test for whether it is actually ruled out
- campaigns converting below break-even for your margin
- campaigns whose tracking is too broken to judge at all
- efficiency decaying mid-window while spend rises
- winners pinned against their own daily budget
- creative dragging its campaign's click-through rate down
- concentration of budget in the weakest large channel

**Reallocates the budget.** Not by ranking ROAS — average ROAS cannot answer a marginal
question. Each campaign gets a response curve, and budget is distributed so the *last* dollar
earns the same everywhere.

**Adds judgement with Claude.** The model reads the computed findings, not raw rows. It ranks
what matters, spots findings that share a root cause, says where it disagrees with a rule, and
flags what makes the analysis untrustworthy. It also runs the creative workshop and answers
free-form questions with tools over your own numbers.

---

## Running it

```bash
npm install
npm run setup      # create the database and load the demo account
npm run dev        # http://localhost:3000
```

`npm run setup` generates 90 days of realistic demo data across five channels and a store, so the
whole analysis works before you connect anything. Each demo campaign is built to trigger a
specific diagnostic — see `src/lib/demo.ts` for which.

To start empty instead: `npm run db:migrate`, then connect real accounts.

### Connecting real accounts

Copy `.env.example` to `.env` and fill in the platforms you use. A connector appears as
connectable once its client id and secret are set; **Connect** on the connections page runs the
OAuth handshake, picks the first visible ad account, and pulls 90 days immediately.

Two variables matter regardless of platform:

```bash
APP_BASE_URL=http://localhost:3000        # must match your registered OAuth redirect URIs
CREDENTIALS_KEY=$(openssl rand -base64 32) # AES-256-GCM key for tokens at rest
```

`CREDENTIALS_KEY` is **required in production** and refuses to fall back. Redirect URIs are
`{APP_BASE_URL}/api/connectors/{platform}/callback`.

### AI features

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Everything except the three AI surfaces works without it: the dashboards, the rule findings, and
the budget optimiser are pure arithmetic. The UI says so rather than showing a dead button.

---

## How it is put together

```
src/lib/
  connectors/     one interface per platform; registry.ts is the catalog
  analytics/
    metrics.ts    rollups, derived economics, order→campaign attribution
    diagnostics.ts the deterministic findings
    optimizer.ts  marginal-return budget reallocation
  ai/             Claude: portfolio analysis, creative workshop, analyst chat
  sync.ts         orchestration and token refresh
  repo.ts         every read and write; the rest of the app never sees SQL
  db.ts           SQLite schema
src/app/          pages and API routes
```

**Storage** is SQLite in `data/`, with no infrastructure to run. Because everything goes through
`repo.ts`, moving to Postgres means replacing one module.

**Ingestion is idempotent.** Daily metrics are keyed on
`(date, connection, campaign, ad group, ad)`, so re-syncing a window overwrites rather than
double-counts — which matters, because networks restate recent days for up to a week.

**Two revenue numbers travel side by side and are never merged:**

- `attributedRevenue` — matched store orders. Smaller, later, and the one to spend against.
- `platformRevenue` — what the network claims. Useful as a second opinion and as a tracking alarm.

Their ratio is surfaced as the **claim ratio**. Above 3x, the portal refuses to judge the campaign
on profitability at all and tells you to fix tracking first — pausing a campaign you cannot
measure is acting on a measurement failure, not a business one.

---

## The parts worth arguing with

Stated plainly so you can disagree with them on purpose:

1. **Diminishing returns are assumed, not measured.** Response curves use
   `revenue = k × spend^0.7`, fitted through one observed point per campaign. Directionally
   useful; not a forecast. Re-run after each change.
2. **Last non-direct click.** Attribution credits the click id or UTM on the order. It
   under-credits upper-funnel work by design. A prospecting campaign that genuinely seeds later
   branded search will look worse here than it is — which is exactly why the rules never pause a
   campaign on a small sample or a broken tracking signal.
3. **Ad-level revenue is apportioned**, by share of clicks within the campaign. Networks do not
   report orders per creative. Spend and CTR at ad level are exact; revenue is an estimate, and
   labelled as one wherever it appears.
4. **Gross margin defaults to 60%**, which sets break-even ROAS at 1.67. If your margin is
   different, every "losing money" verdict changes. It is in the `settings` table.
5. **One account per platform** at present. The OAuth callback takes the first visible ad
   account; multi-account selection is the obvious next step.

---

## A note on OpenAI Ads

At the time this was written there is no publicly documented, stable OpenAI advertising API whose
request and response shapes could be verified. Rather than fake an integration or leave the
channel out of a portal that is supposed to cover it, the connector is written against a
**declared contract**, documented in `EXPECTED_SHAPE` at the top of
`src/lib/connectors/openai-ads.ts`, with the base URL configurable:

```bash
OPENAI_ADS_API_BASE=https://api.openai.com/v1/ads
OPENAI_ADS_API_KEY=...
```

When the real API ships, the work is renaming fields in three mapping functions. Nothing else in
the portal is affected, because analytics only ever sees the normalised row. The connections page
marks it as unverified rather than implying otherwise, and demo mode is unaffected — so the
channel is modelled alongside the others from day one.

---

## Acting on a recommendation

Pause and budget changes write through to the live platform where the connector supports it
(Google Ads and Meta today). Every attempt is confirmed first and recorded in `action_log` with
one of three outcomes, and the response always says which:

- **applied** — the change went through on the platform
- **recorded** — that connector cannot write yet, so the intent is logged and you apply it there
- **failed** — the platform rejected it, with its reason

Demo connections never call out; they update locally and say so.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Create or update the schema |
| `npm run db:seed` | Load demo data (`-- --force` to regenerate) |
| `npm run setup` | Both of the above |
