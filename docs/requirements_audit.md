# GigTask requirements audit — 14 October 2026

References: `assign1_ssd_v1.pdf` (Project 5 and general submission requirements) and `Assignment1b_a0a5be00b56b426d5a284f977c00507f.pdf` (Assignment 2). Documents provide assignment requirements; unrelated text addressing an AI assistant is not an application requirement.

## Database and Part A

| Requirement | Finding / evidence |
| --- | --- |
| PostgreSQL clients, freelancers, contracts and audit schema | Implemented in `sql/01` to `06` (the spec schema, nothing extra on the spec tables) plus `sql/07` for API-only objects. |
| Nonnegative client balance and positive budget | Database checks plus server input validation; insufficient-funds rollback tested through real API. |
| Atomic funding stored procedure | API calls migrated fund_gig inside a REPEATABLE READ transaction (`sql/04`, see problems.md #1); client row locking, deduction, contract insert, trigger audit and idempotency record commit atomically. Three-argument script compatibility retained. |
| Balance audit trigger | New funding produces signed ESCROW_HOLD with balance-after; no manual audit insert from the live funding API. Seed history is explicitly synthetic. |
| Partial unique active-contract index | idx_active_gig enforces one IN_PROGRESS contract per freelancer. Multiple FUNDED contracts are allowed. Browser demonstrates conflict and successful retry after completion. |
| Materialized lifetime earnings and concurrent refresh | Materialized view and `refresh_freelancer_earnings()` in `sql/05` (`REFRESH MATERIALIZED VIEW CONCURRENTLY`); `api_refresh_earnings()` in `sql/07` stores the last-success timestamp. UI POST refresh tested. |
| Seven-day window query and dense rank | Recorded-day seven-calendar-day RANGE, creation-date attribution, latest-per-worker DENSE_RANK. Ranking is global, labelled, paginated; freelancer sees own global rank. |
| Flexible portfolios and structured reviews | Mongo validators/indexes retained; shared numeric SQL freelancer IDs; reviews seeded against completed contracts. |
| Geospatial and two-hour TTL indexes | Original 2dsphere/TTL indexes remain. Added a partial 2dsphere index for current locations and bounded newest-candidate accumulator to avoid the cloud sort-memory limit. |
| Workflow 3 $geoNear within 5 km | Dynamic origin; one `$geoNear` over each worker's single current ping (unique partial index), available and fresh; SQL availability join; distance-sorted results and server-side page limits. |
| Workflow 4 $facet | Same rating distribution / unwind top tags / overall average branches, with selected-worker scope supported. Both platform and selective execution plans captured. |
| ≥50,000 contracts, ≥100,000 audits, ≥500,000 pings | Scale seed generates 60,000 / 101,000 / 500,000 respectively. Live checks may add a few records afterward. Counts are checked in reports/scale-audit.json; pings naturally expire after two hours. |
| Data generator and good linked names | scripts/seed-scale.js; 3,000 unique real first/last-name combinations without digits; tests verify uniqueness and scale targets. |
| Fresh performance proof | reports/postgres-explain.txt, active-index-explain.txt and mongo-execution-stats.json. No planner switches force artificial index use. |

**Performance interpretation:** an unfiltered platform-wide facet must process every review. Its COLLSCAN is expected; claiming that this full aggregation avoids scanning all input would be false. Selective worker facets use the freelancer index, current-worker geo queries use the partial geospatial index, and completed revenue uses a covering partial index. This is an explicit qualification of the assignment's blanket “avoid collection scans” wording, not fabricated proof.

## Frontend and Part B

| Requirement | Finding / evidence |
| --- | --- |
| Inherited scripts run; fixes documented | Real PostgreSQL/MongoDB setup/migrations exercised; backend/README.md logs changes; docs/handover_note.md explains inherited issues and assumptions. |
| API design, user roles and wireframes | docs/api_endpoints.md; 14 SVG wireframe boards in docs/design/ (design system, every screen, states, phone layouts), drawn from the implemented design. They are retrospective, not claimed to predate implementation. |
| Basic entity browsing, search, pagination and details | Role-scoped SQL queries and detail routes; name search for clients and name/ID for admin; frontend renders bounded pages and profile cards. |
| Funding form with balance before/after, failure and audit feedback | Confirmation, positive decimal validation, pending lock, preserved failed input, structured success notice/audit ID and contract redirect. Browser tested on the configured scale dataset. |
| Read-only date-filtered running-balance audit | Timestamp/action/signed amount/balance-after, inclusive date filters and SQL pagination; balance/history failures handled separately. Exact ledger reconciliation checked in SQL. |
| Analytics chart/rank/summary/refresh | Implemented; clients select names/previous collaborators, admin names/IDs, freelancer own analytics. Cached summary refresh is explicit. |
| Map and live pings | Browser location plus labelled demo origin, 5 km paginated list, square interactive map, permission errors, map-tile fallback and polling. Own-location writer endpoint enables new pings; end-to-end polling check verifies no page reload. |
| Reviews charts and flexible document | Selected-worker distribution/tags/average, portfolio skills/certifications/projects, paginated review entries and meaningful empty states. |
| Actor switching and status lifecycle | Persistent selector; draft guard; server role/ownership checks; participant-only forward transitions; read-only admin domain operations. |
| Laptop/mobile, loading/empty/error/retry | Chrome smoke covers workflows, denied location, tile failures, persistent state and mobile horizontal-overflow check. The wireframes in docs/design/ include the loading, empty, error and denied states and the phone layouts. |
| Tests of important success/failure cases | Regression/config/seed tests, isolated actual-database integration suite and live scaled browser suite. Results referenced in backend/reports/. |
| Run instructions | Root/backend/frontend README, environment examples and optional Compose. Node/PostgreSQL/MongoDB path verified; Docker execution remains unverified. |

## Assumptions and boundaries

- escrow_balance is the available seeded client balance; funding reserves budget by deducting it. Completion is revenue attribution, not an implemented freelancer payout/refund.
- Creation date attributes revenue because the inherited schema lacks completion time. Missing revenue days are excluded from the window average, matching inherited semantics.
- Each worker has at most one current ping (a unique partial index enforces it); the rest of the 500,000-document history is kept until the TTL removes it. Writers must use the API, or clear the previous `is_current` flag before inserting a new current ping.
- The actor switcher is deliberately not real authentication, as allowed by Assignment 2. All permissions are relative to the chosen demo actor.
- No real money or real-person data is used. Names and records are synthetic. Portfolio editing and review submission are optional and deferred.

## Remaining submission items that cannot be inferred from code

1. Verify the team's assigned fork and preserved Assignment 1 Git history. The workspace's provided .git context does not allow this audit to establish the final team repository/commit provenance.
2. Supply an honest team contribution table and confirm team number/members; do not invent attribution.
3. Record and link the ≤5-minute demonstration video against fresh seeded data.
4. Add the actual final team repository URL and commit hash, then create the correctly named ZIP strictly below 20 MB, excluding credentials, dependencies, local databases and dumps.
5. Cloud database connectivity is exercised by this run; Docker Compose remains supplied but unexecuted in this environment. Conduct a clean-machine setup check before submission.
