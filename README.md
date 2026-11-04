# Mobile Shop ERP

Offline-first PWA foundation for Kerala mobile shops.

## Current foundation
- Responsive mobile/desktop shell and navigation
- IndexedDB database and initial store schema
- Local JSON export and restore
- Installable PWA manifest and service worker
- Starter screens for sales, recharge, inventory, customers, repairs, purchases, expenses, money and settings

## Run locally
Serve this folder over HTTPS or localhost (service workers require a secure context):
```bash
python -m http.server 8000
```
Open http://localhost:8000.

## Deploy with GitHub Pages
Repository Settings → Pages → Deploy from a branch → main → / (root) → Save.

## Important
This is the initial application foundation, not yet a complete production accounting ERP. The full double-entry ledger, stock costing, GST validation, returns, reconciliation, encrypted backups and comprehensive tests remain to be implemented before business-critical use. Data is local to this browser profile. Export backups frequently and keep copies elsewhere.
