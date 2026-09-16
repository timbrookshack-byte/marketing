# Google Ads API access application

`360-marketing-design-document.pdf` is the design document submitted with the
application for Basic access to the Google Ads API, in answer to *"Provide
documentation of your tool"*.

Three placeholders must be filled in before it is submitted — they are the facts
only the business can confirm, and they appear in the table on page 1:

- `[LEGAL COMPANY NAME]`
- `[STOREFRONT DOMAIN]`
- `[CONTACT EMAIL]`

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
