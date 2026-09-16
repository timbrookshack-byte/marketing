"""Builds the design document submitted with a Google Ads API access request."""
import sys
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, Image, KeepTogether, NextPageTemplate,
                                PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle)
from PIL import Image as PILImage

SHOTS = sys.argv[1]
OUT = sys.argv[2]

INK      = colors.HexColor("#16181D")
MUTED    = colors.HexColor("#5B6170")
RULE     = colors.HexColor("#D8DBE2")
ACCENT   = colors.HexColor("#1B4DB1")
PANEL    = colors.HexColor("#F4F6F9")

ss = getSampleStyleSheet()

def style(name, **kw):
    base = dict(fontName="Helvetica", fontSize=9.6, leading=14.4, textColor=INK,
                spaceAfter=7, alignment=TA_LEFT)
    base.update(kw)
    return ParagraphStyle(name, **base)

BODY    = style("body")
LEAD    = style("lead", fontSize=10.6, leading=16, textColor=MUTED, spaceAfter=12)
H1      = style("h1", fontName="Helvetica-Bold", fontSize=19, leading=23, spaceAfter=3, spaceBefore=0)
H2      = style("h2", fontName="Helvetica-Bold", fontSize=12.4, leading=16,
                spaceBefore=17, spaceAfter=7, textColor=INK)
H3      = style("h3", fontName="Helvetica-Bold", fontSize=10, leading=14, spaceBefore=10, spaceAfter=4)
BULLET  = style("bullet", leftIndent=12, bulletIndent=2, spaceAfter=4)
CELL    = style("cell", fontSize=8.7, leading=12.2, spaceAfter=0)
CELLB   = style("cellb", fontSize=8.7, leading=12.2, spaceAfter=0, fontName="Helvetica-Bold")
MONO    = style("mono", fontName="Courier", fontSize=8.3, leading=11.8, spaceAfter=0)
CAPTION = style("caption", fontSize=8.6, leading=12.4, textColor=MUTED, spaceBefore=5)
NOTE    = style("note", fontSize=8.8, leading=13, textColor=MUTED)

doc = BaseDocTemplate(OUT, pagesize=A4,
                      leftMargin=20*mm, rightMargin=20*mm,
                      topMargin=18*mm, bottomMargin=17*mm,
                      title="360 Marketing — Tool Design Document",
                      author="The Furniture Shack Pty Ltd",
                      subject="Google Ads API access application")

LANDSCAPE = (A4[1], A4[0])

def make_template(tid, pagesize):
    """A wide screenshot is unreadable squeezed into a portrait column, so each
    figure gets the orientation that lets it fill the page."""
    pw, ph = pagesize
    width = pw - doc.leftMargin - doc.rightMargin
    height = ph - doc.topMargin - doc.bottomMargin
    frame = Frame(doc.leftMargin, doc.bottomMargin, width, height, id=tid)

    def chrome(canvas, d):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.4)
        canvas.setFillColor(MUTED)
        canvas.drawString(doc.leftMargin, ph - 12*mm, "360 Marketing — Tool Design Document")
        canvas.drawRightString(pw - doc.rightMargin, ph - 12*mm,
                               "Google Ads API access application")
        canvas.setStrokeColor(RULE); canvas.setLineWidth(0.5)
        canvas.line(doc.leftMargin, ph - 14.5*mm, pw - doc.rightMargin, ph - 14.5*mm)
        canvas.drawCentredString(pw / 2, 11*mm, str(canvas.getPageNumber()))
        canvas.restoreState()

    return PageTemplate(id=tid, frames=[frame], onPage=chrome, pagesize=pagesize)

doc.addPageTemplates([make_template("portrait", A4), make_template("landscape", LANDSCAPE)])

S = []

def bullets(items, st=BULLET):
    for text in items:
        S.append(Paragraph(text, st, bulletText="•"))

def keyvalue(rows, widths=(46*mm, 114*mm)):
    data = [[Paragraph(k, CELLB), Paragraph(v, CELL)] for k, v in rows]
    t = Table(data, colWidths=widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
    ]))
    S.append(t)
    S.append(Spacer(1, 8))

def table(header, rows, widths):
    data = [[Paragraph(h, CELLB) for h in header]]
    for r in rows:
        data.append([Paragraph(c, MONO if i == 0 and c.startswith(("GET ", "POST ")) else CELL)
                     for i, c in enumerate(r)])
    t = Table(data, colWidths=widths, hAlign="LEFT", repeatRows=1)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, 0), PANEL),
        ("TOPPADDING", (0, 0), (-1, -1), 5.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
        ("LINEABOVE", (0, 0), (-1, 0), 0.6, INK),
    ]))
    S.append(t)
    S.append(Spacer(1, 9))

PORTRAIT_BOX  = (170*mm, 241*mm)
LANDSCAPE_BOX = (257*mm, 156*mm)

def shot(name, caption):
    path = f"{SHOTS}/{name}.png"
    w, h = PILImage.open(path).size
    landscape = w / h > 1.15
    box_w, box_h = LANDSCAPE_BOX if landscape else PORTRAIT_BOX

    width, height = box_w, box_w * h / w
    if height > box_h:
        height, width = box_h, box_h * w / h

    S.append(NextPageTemplate("landscape" if landscape else "portrait"))
    S.append(PageBreak())
    S.append(Image(path, width=width, height=height, hAlign="CENTER"))
    S.append(Paragraph(caption, CAPTION))

# ---------------------------------------------------------------- cover block
S.append(Paragraph("360 Marketing", H1))
S.append(Paragraph("Tool design document, submitted in support of an application for "
                   "Basic access to the Google Ads API.", LEAD))

keyvalue([
    ("Company", "The Furniture Shack Pty Ltd"),
    ("Websites advertised", "https://www.thefurnitureshack.com.au/ — a Shopify store, thefurnitureshack.myshopify.com"),
    ("Contact", "office@thefurnitureshack.com.au"),
    ("Google Ads manager account", "235-908-4368"),
    ("Google Ads accounts accessed", "821-497-7043 (The Furniture Shack), 108-381-7641"),
    ("Tool name", "360 Marketing"),
    ("Tool type", "Internal reporting and budget-management tool. Not a product, not resold."),
    ("Access requested", "Basic"),
])

# ---------------------------------------------------------------- 1
S.append(Paragraph("1. Business model", H2))
S.append(Paragraph(
    "We are a furniture retailer. We sell our own products directly to consumers through our "
    "own e-commerce store, which runs on Shopify, and we advertise only that store. Every "
    "Google Ads account this tool will touch is owned by us and promotes websites we own.", BODY))
S.append(Paragraph(
    "We do not manage advertising for any other business, we do not act as an agency, and we "
    "do not resell advertising, reporting, or API access to anyone. Revenue comes from selling "
    "furniture, not from the tool.", BODY))

# ---------------------------------------------------------------- 2
S.append(Paragraph("2. Tool access and use", H2))
S.append(Paragraph(
    "360 Marketing is a self-hosted internal tool. Today it runs on the business owner's own "
    "computer and listens only on localhost; it is not published to the internet and has no "
    "public address. If it is later moved onto a private server for staff use, access will be "
    "restricted to named employees behind authentication. No client, agency, or third party will "
    "have access to the tool at any point.", BODY))
S.append(Paragraph("Who uses it", H3))
bullets([
    "The business owner, and in future a small number of our own staff responsible for buying media.",
    "Nobody outside the company. We have no external users and no plans for any.",
])
S.append(Paragraph("What they use it for", H3))
bullets([
    "Viewing spend, clicks, conversions and return for our own campaigns across Google Ads and "
    "our other advertising channels, side by side and in one currency.",
    "Comparing what each advertising platform reports against orders actually recorded in our "
    "Shopify store, so that a campaign is judged on sales we can see rather than on the "
    "platform's own conversion count.",
    "Deciding where to move budget: identifying campaigns that are spending without returning, "
    "and campaigns that are returning well and are limited by their daily budget.",
    "Pausing a campaign, or changing its daily budget, when the operator decides to act on "
    "what the reporting shows.",
])

# ---------------------------------------------------------------- 3
S.append(Paragraph("3. Tool design", H2))
S.append(Paragraph(
    "The tool pulls metrics from the Google Ads API into a local database. The interface reads "
    "from that database rather than calling the API on every page view, so ordinary use produces "
    "no API traffic at all.", BODY))

S.append(Paragraph("Data flow", H3))
flow = [
    ["1", "Authenticate", "The operator signs in with their own Google account through the standard "
     "OAuth 2.0 consent flow, granting the <b>adwords</b> scope. Refresh tokens are stored "
     "encrypted; no service account or shared credential is used."],
    ["2", "Pull", "A sync requests a 90-day window of daily campaign, ad group and ad performance "
     "through GoogleAdsService.SearchStream, plus the account's own details. Each sync issues "
     "roughly five requests per account."],
    ["3", "Normalise", "Figures are converted from micros to account currency and written into a "
     "local SQLite database in the same shape used for every other advertising channel, so that "
     "no part of the analysis is specific to one platform."],
    ["4", "Match", "Orders pulled from our Shopify store are matched to campaigns by Google click "
     "identifier (GCLID) first, then campaign tagging, then source tagging. Unmatched revenue is "
     "reported as unmatched rather than distributed across campaigns."],
    ["5", "Report", "The interface reads only from the local database. Spend, matched revenue, "
     "return on spend, cost per acquisition and gross profit are shown per channel, per campaign "
     "and per ad, over a date range the operator selects."],
    ["6", "Act", "If the operator chooses, the tool writes back a campaign pause or a daily budget "
     "change. Writes never happen automatically; each one is a deliberate click on a named "
     "campaign, and is recorded in a local action log."],
]
table(["#", "Stage", "What happens"],
      flow, [8*mm, 26*mm, 136*mm])

S.append(Paragraph("Sync frequency", H3))
S.append(Paragraph(
    "Syncing is currently started by hand from the interface, typically once or twice a day. We "
    "intend to add a scheduled sync that runs at most once per hour, and in practice expect to "
    "run it daily, since our reporting window is daily. There is no per-page-view API call and no "
    "polling loop.", BODY))

S.append(Paragraph("Storage and security", H3))
bullets([
    "Data is held in a local SQLite database file on the machine running the tool. It is not "
    "sent to any third-party service and is not shared with anyone outside the company.",
    "OAuth tokens are encrypted at rest with AES-256-GCM under a key held in the environment, "
    "and are never returned to the browser or displayed in the interface.",
    "Only aggregate advertising performance and our own store's order records are stored. No "
    "personal data about consumers is retrieved from the Google Ads API.",
    "Because the tool is single-tenant and runs on our own hardware, there is no shared "
    "infrastructure and no other party's data in the same database.",
])

S.append(PageBreak())

# ---------------------------------------------------------------- 4
S.append(Paragraph("4. API services called", H2))
S.append(Paragraph(
    "The tool calls the Google Ads REST interface. The API version is resolved at runtime rather "
    "than pinned, so the tool moves off a version before it is sunset. The complete list of calls "
    "the tool makes is below; nothing else is used.", BODY))

table(["Endpoint", "Service", "Purpose"], [
    ["GET customers:listAccessibleCustomers",
     "CustomerService.ListAccessibleCustomers",
     "Discover which of our own accounts the signed-in user can reach, so the operator can pick "
     "the right one. Read-only, called once per connection."],
    ["POST googleAds:searchStream",
     "GoogleAdsService.SearchStream",
     "All reporting. Read-only. Queries the <b>customer</b>, <b>campaign</b>, "
     "<b>campaign_budget</b>, <b>ad_group</b> and <b>ad_group_ad</b> resources, with "
     "<b>metrics</b> and <b>segments.date</b>, for a trailing 90-day window."],
    ["POST campaigns:mutate",
     "CampaignService.Mutate",
     "Pause one named campaign. Write. Only ever triggered by the operator clicking Pause on "
     "that campaign; never scheduled or automatic."],
    ["POST campaignBudgets:mutate",
     "CampaignBudgetService.Mutate",
     "Set the daily budget of one campaign. Write. Only ever triggered by the operator applying "
     "a proposed budget shown in the interface."],
], [50*mm, 44*mm, 76*mm])

S.append(Paragraph("Fields retrieved", H3))
S.append(Paragraph(
    "campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, "
    "campaign.start_date, campaign.end_date, campaign_budget.amount_micros, "
    "ad_group.id, ad_group.name, ad_group.status, ad_group_ad.ad.id, ad_group_ad.ad.name, "
    "ad_group_ad.ad.type, ad_group_ad.ad.final_urls, "
    "ad_group_ad.ad.responsive_search_ad.headlines, "
    "ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.status, "
    "customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, "
    "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, "
    "metrics.conversions_value, metrics.video_views, segments.date.", MONO))
S.append(Spacer(1, 10))

S.append(Paragraph("Compliance", H3))
bullets([
    "The tool is for our own accounts only. It will not be offered to, sold to, or operated on "
    "behalf of any other advertiser.",
    "No Google Ads data is passed to any third party. Reports are read inside the business.",
    "Requests are rate-limited and retried with exponential backoff, honouring Retry-After; "
    "failed requests are not retried in a loop.",
    "We will comply with the Google Ads API Terms and the Required Minimum Functionality policy, "
    "and will keep the tool's API usage within the scope described in this document.",
])

S.append(PageBreak())

# ---------------------------------------------------------------- 5
S.append(Paragraph("5. Screenshots", H2))
S.append(Paragraph(
    "The tool is built and running. The screens below are from the working application; because "
    "our Google Cloud project is not yet approved for production accounts, they are populated "
    "with representative sample figures rather than live Google Ads data. Layout, calculations "
    "and controls are exactly as they will be with live data.", NOTE))
S.append(Spacer(1, 10))

shot("overview", "Overview — spend, revenue matched to store orders, return on spend and gross "
                 "profit for the selected window, with the ranked list of what to act on first.")
shot("campaigns", "Campaigns — every campaign ranked by spend, showing matched orders, return, "
                  "cost per acquisition and profit. Pause and Apply are the only two write "
                  "actions the tool performs, and both require this click.")
shot("channels", "Channels — the same figures aggregated per advertising platform, so Google Ads "
                 "is compared against our other channels on identical definitions.")
shot("sales", "Sales — orders from our Shopify store, and how much of that revenue can be matched "
              "back to a campaign. Revenue that cannot be matched is shown as unmatched rather "
              "than assigned.")
shot("connections", "Connections — where an account is authorised. Google Ads uses the standard "
                    "OAuth consent flow; credentials are encrypted and never displayed again.")

doc.build(S)
print("built", OUT)
