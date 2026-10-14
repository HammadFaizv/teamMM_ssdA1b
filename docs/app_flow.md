# GigTask_App_Flow.docx implementation

Source: the supplied `GigTask_App_Flow.docx` at repository root. Its recommended core flow is implemented; the source document is retained unchanged.

| Document area | Implementation |
| --- | --- |
| Entry, roles, actors, Continue | Native actor dialog with required role/actor, paginated searchable seeded names, loading/empty/error/retry, no manual ID registration |
| Shared layout and persistent switcher | Header switcher, localStorage actor persistence, mobile navigation, read-only admin labels |
| Switching drafts | Confirmation for dirty funding drafts; reset draft and filters on actor change; disable switch while mutation pending |
| Direct links | Hash routes plus API role/ownership checks; no actor shows entry; forbidden pages show explanation and Browse link |
| Browse | Role-specific tabs, server pagination/search/status filters; list view state retained in localStorage |
| Worker details | Portfolio, availability, rating summary, selected-worker reviews/analytics, prefilled funding; unavailable workers cannot be funded |
| Client details | Admin balance/detail inspection with contract and audit links; clients restricted to own data |
| Contract details | Participants, reserved budget, creation date, profile link, forward status buttons for participants, confirmation and conflict feedback |
| Funding | Client context, searchable worker selector, decimal budget, expected remaining balance, confirmation, pending lock, preserved failure draft, atomic mutation and contract redirect |
| Transaction outcome | Before/after balance and generated audit ID shown in success notice; contract page links to audit; persisted idempotency key prevents duplicate retry deductions |
| Audit | Own client/admin-selected client, inclusive date filters, signed amount/action/timestamp/balance-after, independent balance/history errors |
| Analytics | Selected/own worker, zero-total/no-revenue handling, SQL seven-day average, SQL dense rank, stored lifetime summary and refresh time |
| Reviews & portfolio | Selected/own worker, flexible portfolio display, certifications/projects, rating distribution/top tags/average, paginated review entries and timestamps |
| Discovery | Explicit job-site coordinates, validation, OpenStreetMap tiles plus distance-sorted list, worker/profile/funding links, preserved query, polling, stale-ping exclusion, one latest ping per worker, map-tile fallback |
| Common states | Visible progress, empty/error explanations, retries, missing/forbidden record handling, responsive tables and cards |
| Optional editing/submissions | Deferred, as permitted by the guide |

## Chosen decisions

1. The API `escrow_balance` is the available seeded client balance for this demo. Funding deducts it and reserves budget on the contract. This is the flow document's convention, not the original inherited procedure's increase-in-escrow behavior.
2. No payout or refund is implied by completion. No extra title, description, job address, bidding or chat fields were invented.
3. Funding requires an available freelancer and a positive exact-cent amount. New funding operations use PostgreSQL NUMERIC(10,2), with exact-cent budgets validated at the API boundary. The explicit SQLite fallback uses integer cents.
4. Contract participants may use forward transitions. Admin is read only. Multiple FUNDED contracts are allowed; unique IN_PROGRESS per freelancer is enforced by the database.
5. Revenue is attributed to contract creation date. The rolling mean includes only recorded revenue days in a seven-calendar-day window. Dense rank uses each worker's latest rolling mean. SQL window functions compute both.
6. Lifetime earnings come from the inherited PostgreSQL materialized view. The frontend has an explicit Refresh earnings button that POSTs to the API; the database refresh function runs REFRESH MATERIALIZED VIEW CONCURRENTLY and records its successful timestamp.
7. Freelancer IDs are shared across portfolio, review, location and relational records. Freelancer availability is the single source of truth. Locations older than two hours are excluded explicitly.
8. Demo role headers are not real authentication. Permissions are enforced relative to the requested demo actor; deployment with real users would need authenticated identity.

## Database boundary

The default implementation now uses PostgreSQL and MongoDB. The inherited `avni_db/` was moved to `backend/database/`; `sql/01` to `06` now follow Assignment 1 Project 5 (funding direction corrected, `REPEATABLE READ` funding, immutable audit trigger), and `sql/07_api_integration.sql` adds only API objects: idempotency storage, forward transitions and refresh metadata. The backend executes the required stored procedure, window query, materialized view, `$geoNear` and `$facet` workflows. All changes and configuration steps are documented in `backend/README.md`.

SQLite remains available only through `npm run start:demo`, with persisted data at root `var/gigtask.sqlite`. Large-scale linked seeding and regenerated performance evidence remain submission tasks; existing inherited performance captures do not verify the new API implementation.

## Suggested live demo

1. Select client 1. Browse freelancers and open freelancer 3, who is available and initially has no active contract.
2. Review their portfolio, reviews and analytics. Fund a small contract from their profile and inspect the audit deduction.
3. Start that contract. Fund a second contract for freelancer 3 and attempt to start it; show the database-backed conflict.
4. Complete the first contract, then start the second. Click Refresh earnings in Analytics and inspect the updated lifetime earnings and ranking.
5. Switch to freelancer 3 to inspect their own records, then to admin to inspect all records without mutation controls.
6. Search Map around latitude 17.385, longitude 78.4867. If the demo data is older than two hours, run `npm run db:pings` first.

Automated API and Chrome smoke tests cover the central paths; they use isolated test databases.
