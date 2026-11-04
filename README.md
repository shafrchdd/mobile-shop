# Mobile Shop ERP

Mobile-first, offline-first PWA for Kerala mobile shops. Built with HTML, CSS, vanilla JavaScript and IndexedDB.

## Implemented workflows
- Mobile-first navigation: Home, Sell, Recharge, Repairs and More; desktop sidebar on wide screens.
- Product catalogue with product type, category, purchase cost, automatic selling price from fixed or percentage markup, stock quantity, low-stock threshold and separate repair markup.
- Sale price recalculates from the saved per-product markup whenever a new purchase changes its weighted-average cost.
- Purchase receiving with product selection, supplier, line-supply/direct-market type, partial payment and stock update.
- POS sales from the same product catalogue; sale reduces stock and records customer credit when an amount is due.
- Customer lookup by phone in sales and repair intake; existing contacts are linked, new contacts can be saved.
- Recharge providers with a default commission plus exact-amount/range overrides.
- Recharge wallet top-ups and recharge transactions; wallet debit is always recharge amount minus the matched commission.
- Supplier types: direct purchase, line supply and recharge distributor.
- Multiple collection agents can be assigned to a supplier; supplier payments can be linked to a purchase invoice or recorded against general distributor balance.
- Repair job cards with device/model, optional IMEI/serial, reported issue, status, inventory components, part markup, service charges and internal overhead breakdown.
- Customer and supplier collection ledgers, expense entry, operational reports and JSON backup/restore.
- PWA manifest, service worker, offline shell and cached Lucide icon library.

## Run locally
Serve over localhost or HTTPS (service workers require a secure context):
```bash
python -m http.server 8000
```
Open http://localhost:8000.

## Deploy with GitHub Pages
Settings → Pages → Deploy from a branch → main → / (root).

## Important limitations
- Recharge execution still happens in the external provider app. This ERP records the recharge and its accounting impact; automatic recharge execution needs a provider API.
- Data is stored in the current browser profile on one device. There is no multi-device sync or cloud recovery.
- The present screens provide operational accounting records, but the full double-entry posting engine, statutory GST invoice validation/filing, sales and purchase returns, complete IMEI-per-unit tracking, barcode/thermal printing, and final reconciled profit-and-loss reports still need to be completed and tested before production accounting use.
- Export JSON backups regularly and keep copies outside the device. Restore replaces the current local data.

Database schema version: 3.