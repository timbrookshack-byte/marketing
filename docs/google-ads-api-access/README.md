# Google Ads API access application

`360-marketing-design-document.pdf` is the design document submitted with the
application for Basic access to the Google Ads API, in answer to *"Provide
documentation of your tool"*.

The company details on page 1 — entity, storefront, contact address and the
Google Ads account IDs — are filled in and the document is ready to submit.

## Where the application goes

Google Cloud Console, on the Google Ads API Overview page for the project behind
the OAuth credentials:

    https://console.cloud.google.com/apis/api/googleads.googleapis.com/googleads_overview

There is a separate, similarly worded application titled **App Conversion
Tracking & Remarketing API** which is not this one. It is for forwarding mobile
app install and in-app events into Google Ads, it requires an App Store or Play
Store URL for an app we do not have, and its own first paragraph says it does
not grant Google Ads API access. Being refused at that question is the form
working correctly, not a field to argue with.

## Regenerating it

`build.py` builds the PDF from the screenshots beside it:

```bash
pip install reportlab pillow
python3 build.py . 360-marketing-design-document.pdf
```

The screenshots are of the real application. They were captured against a
throwaway database holding representative figures, because the portal carries no
sample data of its own and the live Google Ads account cannot be read until this
application is approved. The document says so on the screenshots page rather
than passing them off as live numbers — the layout, the calculations and the
controls are the real ones.
