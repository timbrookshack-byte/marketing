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

Every platform in both rows appears in the UI and is included in cross-channel analysis. The ones without a live fetch throw a specific, actionable error rather
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

**Shows what rivals are running.** A concept-inspiration module that reads public ad libraries
and scores what is probably working — see [Concept inspiration](#concept-inspiration) for why that
is an inference rather than a measurement.

**Adds judgement with Claude.** The model reads the computed findings, not raw rows. It ranks
what matters, spots findings that share a root cause, says where it disagrees with a rule, and
flags what makes the analysis untrustworthy. It also runs the creative workshop and answers
free-form questions with tools over your own numbers.

---

## Concept inspiration

**You cannot get a competitor's performance data.** There is no legal way to see another
retailer's ROAS, CTR or conversion rate, and any tool claiming to show it is modelling, not
measuring. This module does not pretend otherwise.

What public ad libraries *do* expose is which ads are running and **for how long** — and that turns
out to be enough, because it is behavioural rather than self-reported. A paid ad costs money every
day it delivers, and advertisers cut losers within a week or two. An ad still live after three
months has survived a renewed decision to keep funding it, every one of those days. Nobody builds
six variants of a concept that flopped.

So the module scores two signals: **longevity** (days between first and last delivery, still
running or not) and **iteration** (how many near-duplicate variants of one concept exist). Both
saturate on a log curve, so a year-old ad does not swamp the ranking.

### What it costs you to be wrong about this

Stated on the page itself, not buried here:

1. A large brand can run an awareness ad for a year on a budget line that never had a return
   target. Anything past ~300 days is flagged rather than trusted.
2. Evergreen creative is sometimes just neglect.
3. **Their economics are not yours.** A 70%-margin DTC brand sustains a cost per sale that would
   bankrupt a 25%-margin retailer.

A high score means "worth stealing the idea and testing", never "this will work".

### Where the ads come from

| Source | Official API | What you get | The catch |
|---|---|---|---|
| Meta Ad Library | Yes | Ad text, delivery dates, EU reach | `ad_type=ALL` returns commercial ads **only for EU/UK delivery**. Elsewhere it is political ads only. ~12-month retention |
| TikTok Commercial Content | Yes | Ad text, delivery dates | Metadata only — no video files. Research-programme access, EU-first coverage |
| LinkedIn Ad Library | Yes | Ad text, dates, thumbnails | B2B in practice. No reach figures |
| Google Ads Transparency | **No** | — | No developer surface at all. Reachable only via a licensed provider on your own key |
| Added by hand | n/a | Whatever you paste | Always works. No approval, any platform |

**Nothing here scrapes.** Scraping breaks constantly, violates terms, and fails silently — which
is the worst property a data source can have, because your analysis quietly gets thinner without
saying so. The Google gap is covered by an adapter for providers you subscribe to yourself, and by
the paste-it-in path.

A source that is not configured reports itself as skipped, with the variable to set. A source that
works but finds nothing says so, with its coverage limits. An empty grid is never ambiguous.

### What it produces

Creatives are clustered into **concepts** — five rewordings of one promise count as one concept
iterated five times, not five ideas. Clustering compares word sets pairwise (Jaccard, 0.45
threshold) rather than hashing each creative independently, because similarity is a property of a
pair and cannot be baked into one item alone.

Then Claude clusters both sides — rivals' creative and your own live ads — on the *promise being
made*, and subtracts. The output is the angles your competitors run with real evidence behind them
that **you do not run at all**, each with the honest reason it might not transfer, plus testable
concepts that say explicitly how they differ from the ad that prompted them.

---

## Running it

Needs **Node 20.9 or newer** (Next 16 requires it). `node -v` to check.

```bash
npm install
npm run setup      # create the database
npm run dev        # http://localhost:3000
```

There is no demo or sample data. Every number in the portal comes from an account you have
connected, so nothing on screen is ever a simulation you might mistake for real spend.

### Opening it day to day

Double-click **start-portal.cmd** in the project folder. It installs and builds
only when those are actually missing, starts the server, waits for the port to
answer and then opens the browser — opening it any sooner shows a connection
error and looks like a failure.

Leave that window open while using the portal; closing it stops the server.

To have it running whenever the machine is on, press `Win`+`R`, enter
`shell:startup`, and put a shortcut to `start-portal.cmd` in the folder that
opens. Right-click the shortcut, set **Run** to **Minimized**, and it starts
quietly at login.

**update-portal.cmd** pulls the latest version and rebuilds. It is only needed
when there is an update; the portal does not need it to run.

### On Windows

Two things bite here, neither obvious from the error message they produce.

**Do not keep the project inside OneDrive.** `node_modules` is tens of thousands of small files;
OneDrive tries to sync every one of them, which makes installs crawl and causes intermittent
`EPERM` and `EBUSY` failures when it locks a file mid-write. Clone somewhere outside the synced
tree — `C:\dev\marketing` or similar. If you must keep it in OneDrive, right-click the folder and
choose *Always keep on this device*, then exclude `node_modules` from sync.

**If `npm install` fails building better-sqlite3**, it could not find a prebuilt binary for your
Node version and fell back to compiling from source. Either install the
[VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) C++ workload, or —
easier — switch to an LTS Node version that has prebuilds:

```powershell
nvm install 22
nvm use 22
```

Connect a revenue source first — Shopify or Stripe. Without real orders every channel is judged on
its own marketing, which is the thing this tool exists to stop.

If you seeded demo data before it was removed from the project, `npm run db:purge-demo` deletes it
and everything derived from it.

### When Meta Ads syncs but returns nothing

A sync that succeeds with zero rows is the least informative outcome there is:
the account might be the wrong one, the right one might have been quiet for the
window, or the insights query might be wrong. All three look identical from the
outside.

```bash
npm run doctor:meta
```

It asks the same question three ways — what every ad account this login can see
has spent in total, what the selected account contains, and what insights
returns for the sync's own window — and then says which of the three cases the
answers describe. `amount_spent` in the account list is the one to read first:
the account you actually advertise from is the one with a non-zero figure, and
an account showing zero will never return rows no matter how the window moves.

### Google Ads has two separate approvals

They are configured in different products, and being granted one tells you
nothing about the other. Confusing them costs an afternoon, so:

| | Where | What it gates |
| --- | --- | --- |
| OAuth consent screen publishing status | Google Cloud Console | Who may authorise the app, and how long refresh tokens live |
| API access level (test → Basic) | Google Ads → API Center, under the manager account | Whether the API returns data for real accounts |

Publishing the consent screen does not grant API access, and being granted API
access does not stop a token expiring. Both are needed.

The publishing status is the one that fails quietly. While it is set to Testing,
Google expires refresh tokens after seven days: the connection works, then dies
a week later with no change on this end. Push the consent screen to production
and reconnect, so the stored token is issued under production rules.

Publishing looks like it needs verification and does not. The dependency runs
the other way — an app cannot be submitted for verification until it is
published — so publish first and expect an "unverified app" warning when
authorising. The Ads scope is sensitive rather than restricted, so an unverified
app keeps working; verification is only enforced well beyond single-operator
use. Uploading a logo on the branding screen is what makes brand verification
mandatory, so leave it empty until everything else works.

Without API access, every report query returns
`CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` no matter how clean the auth is.

### When Google Ads will not connect

Google answers every kind of failure with a bare status code, and the same 403
covers an unapproved project, a login that cannot see the account, and a missing
manager ID. Rather than guess:

```bash
npm run doctor:google
```

It reads the credentials already stored in the database, works out which API
version is being served, and runs the account list and a one-row report query —
printing the URL, the status and Google's own response body for each. No secret
is printed, so the output is safe to paste. What the last error names is the
thing to fix:

| Google says | What to do |
| --- | --- |
| `DEVELOPER_TOKEN_NOT_APPROVED`, `CUSTOMER_NOT_ENABLED` | The Cloud project is not cleared for live accounts. Apply for Basic access on its Google Ads API page. |
| `USER_PERMISSION_DENIED` | The Google account you authorised with cannot see this customer ID, or the ad account sits under a manager and the manager's ID has not been set on the connection. |
| `UNAUTHENTICATED` | The token expired and could not be refreshed. Reconnect. |
| `NOT_FOUND: Method not found` | The API version is not being served. The doctor walks down to one that is. |

### Where credentials go

Two different places, depending on the platform:

**Pasted into the app** — Shopify, Stripe, WooCommerce and OpenAI Ads are connected from the
Connections page.

Shopify is the awkward one: since 1 January 2026 the store admin no longer issues permanent
custom-app tokens, so there is no `shpat_` to find. Register an app in the Dev Dashboard, install
it on your store, and paste its **Client ID** and **Client secret** (`shpss_`). The portal runs the
client credentials grant itself on each sync, so the short-lived token never expires on you. A
legacy `shpat_` from before the change still works if you have one. Click **Connect** on the card, paste what it asks
for, and the app saves it encrypted and immediately runs a first sync so you find out straight
away whether the key works. Nothing for these goes in `.env`.

**In `.env`** — the OAuth platforms (Google Ads, Meta, LinkedIn, TikTok, GA4) need an app
registered with that platform first. Its client id and secret go in `.env`; the per-account
tokens are obtained by clicking **Connect**, and are stored encrypted in the database, never in
the file.

Copy `.env.example` to `.env` and fill in the platforms you use. A connector appears as
connectable once its client id and secret are set; **Connect** on the connections page runs the
OAuth handshake, picks the first visible ad account, and pulls 90 days immediately.

Two variables matter regardless of platform:

```bash
APP_BASE_URL=http://localhost:3000        # must match your registered OAuth redirect URIs
CREDENTIALS_KEY=$(openssl rand -base64 32) # AES-256-GCM key for tokens at rest
```

If a connection authorises but ends up pointing at no account — most often Google Ads, where an
ad account inside a manager (MCC) account does not appear in the accessible-customers list — use
**Set account ID** on its card to name the customer ID and the manager ID directly.

`CREDENTIALS_KEY` is **required in production** and refuses to fall back — connecting an account
without it fails with that message. In development an insecure key is derived instead, with a
warning, so set a real one before connecting anything live. Redirect URIs are
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
  inspiration/
    types.ts      the source interface — one file per ad library
    traction.ts   longevity scoring and concept clustering
    *-library.ts  Meta, TikTok, LinkedIn, licensed provider, hand-entered
  ai/             Claude: portfolio analysis, creative workshop, analyst chat,
                  competitor angle gaps
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
6. **Competitor longevity is a proxy, not a measurement.** The reasoning and its three failure
   modes are in [Concept inspiration](#concept-inspiration). It is the weakest evidence in the
   product and is labelled as such everywhere it appears.

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
marks it as unverified rather than implying otherwise, so the channel is never silently trusted.

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
| `npm run db:purge-demo` | Delete demo data left over from an older install |
| `npm run doctor:google` | Diagnose a Google Ads connection — see below |
| `npm run doctor:meta` | Diagnose a Meta Ads connection, including a sync that returns no rows |
| `npm run doctor:shopify` | Show what evidence of an ad click recent orders actually carry |
| `npm run setup` | Create the database |

Demo data covers the inspiration module too: four fictional competitors whose creatives are built
to exercise the scoring — a concept three brands have all kept live for months, one iterated into
six variants, two that were cut inside three weeks, and a year-long brand film that shows why
longevity alone is not proof of profit.
