# Screenshots by version

Each folder holds screenshots of the popup and dashboard for one version of the
extension. They use made-up tabs from `capture/mock-chrome.js`, never real browsing data.

## Taking screenshots for a new version

```bash
docs/screenshots/capture/capture.sh v7-short-name
```

This needs Google Chrome installed. It writes PNGs (2x resolution) to
`docs/screenshots/v7-short-name/`. If the new version adds or changes a screen,
add a line for it to the `SHOTS` list in `capture/capture.sh` first. Then add a
row to the version log below.

## Version log

| Version | What changed | Screenshots |
| --- | --- | --- |
| v1 | Popup inventory: tabs grouped by domain, search, filters (duplicates, audio, discarded), badges, close tab, "Close all duplicates". Background logger started. | Not captured |
| v1.1 | Duplicates match the full URL including `#hash` (so Gmail-style apps aren't flagged). "Close all duplicates" asks for confirmation first. | Not captured |
| v2 | Staleness: "untouched for Nd" on each row, By domain / By staleness sort, 7+ and 14+ day filters, "N stale" stat. One-time backfill of Chrome's last-accessed times. | Not captured |
| v3 | Actions: SAVED badge for bookmarked tabs, per-row Discard and Archive, "Discard all stale" and "Archive all stale", 30-second Undo. | Not captured |
| v3.1 | Undo kept for 2 minutes and survives closing the popup. Tab history recovered after discards and restarts. | Not captured |
| v4 | Data collection only (no UI change): closed tabs kept in `closedLog`, opener tab recorded for each new tab. | Not captured |
| v5 | Full-page dashboard (`dashboard.html`), shared logic moved to `tabs-core.js`, extension's own pages excluded from counts. Then: dashboard rendered as a sortable table with sticky header. | Not captured |
| v6 | Popup reduced to a glance: stats and quick actions; the dashboard became the main view. | Not captured |
| v6.1 | Popup shows the 3 stalest tabs (or the 3 oldest if nothing is stale), "Archive all stale" restored, bulk buttons show counts. | [v6.1-popup-glance](v6.1-popup-glance/) |

Versions before v6.1 were never saved separately, so they can't be screenshotted:
the git history starts at v6.1.

## v6.1-popup-glance

| File | Shows |
| --- | --- |
| `popup-light.png`, `popup-dark.png` | Popup with stats, 3 stalest tabs and bulk buttons |
| `popup-archive-confirm.png` | Popup after clicking "Archive all stale": the confirm list |
| `popup-nothing-stale.png` | Popup when no tab is 7+ days old ("Oldest tabs" instead) |
| `dashboard-by-domain-light.png`, `dashboard-by-domain-dark.png` | Dashboard table grouped by domain |
| `dashboard-by-staleness.png` | Dashboard flat table, most stale first |
| `dashboard-sorted-by-title.png` | Dashboard flat table after clicking the Title column |
