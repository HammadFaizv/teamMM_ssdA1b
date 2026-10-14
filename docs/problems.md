# GigTask problems and uncovered edge cases

Found by reviewing the project against `assign1_ssd_v1.pdf` (Project 5) and `Assignment1b` (Assignment 2) on 14 October 2026. Status: **FIXED** = changed and tested, **PARTLY FIXED** = see the note, **OPEN** = not yet addressed. Items marked *(review)* come from reading the code; they were not reproduced against a running system unless stated.

## 1. Assignment wording not met

| # | Problem | Status |
| --- | --- | --- |
| 1 | **Workflow 1 isolation and error handling.** Assignment 1 requires the funding procedure to start a `REPEATABLE READ` transaction, COMMIT, and catch exceptions with ROLLBACK. `fund_gig` ran under the default `READ COMMITTED` and had no exception handling; the API owned the transaction. | **FIXED**, see below |
| 2 | Escrow semantics: `escrow_balance` is treated as available balance and completing a contract never releases or refunds. `ESCROW_RELEASE` and `ESCROW_REFUND` cannot be produced from the app, and `ESCROW_REFUND` is never used. | OPEN |
| 3 | The unfiltered platform `$facet` does a COLLSCAN of every review, against the rubric's "avoid collection scans". Documented honestly, but a literal grader may deduct. | OPEN |
| 4 | Submission items missing from the repo: repository URL and final commit hash, contribution table, demo video link, wireframes that predate the build (current ones are retrospective), `api/`/`web/` layout (the repo uses `backend/`/`frontend/`), `<team>_a1b.zip` naming, intact Assignment 1 git history. | OPEN |

## 2. Backend edge cases with no test

| # | Area | Case | Status |
| --- | --- | --- | --- |
| 5 | Funding | Unavailable freelancer, nonexistent freelancer, and a freelancer calling `POST /contracts/fund` (expect 403) are untested through the API. | **FIXED** (test added) |
| 6 | Funding | Missing or malformed `Idempotency-Key` is untested. | **FIXED** (test added) |
| 7 | Funding | Two different keys racing to spend the same balance (double spend) and two concurrent `PATCH` status changes on one contract are untested; only same-key concurrency is. (Problem 1 added a DB-level concurrency check, see below, but not an API one.) | **FIXED** (tests added; the DB-level and API-level checks both pass) |
| 8 | Funding | Budget boundaries (`9999999.99`, `10000000`, `"007"`, `" 5 "`, `"1,5"`) are untested. | **FIXED** (test added) |
| 9 | Validation | `budget()` does `String(value)`, so `budget: [5]` is accepted as `"5"`. `integer(true)` becomes `1`, so `freelancerId: true` funds freelancer 1. *(review)* | **FIXED** (validators tightened, test added) |
| 10 | Funding | `api_funding_requests` grows without bound, and a replayed key returns a stale response. | **PARTLY FIXED**: records older than a day are now trimmed after each funding. A replayed key within that day still returns the stored (possibly stale) response, by design. |
| 11 | Lifecycle | A client alone can move FUNDED to IN_PROGRESS without the freelancer. Funding a freelancer who already has an IN_PROGRESS contract is allowed. `is_available` never changes with contract status. Design choices, but untested and undocumented. | OPEN |
| 12 | Audit | No tests for `from` only, `to` only, an empty range, or a page past the end. The UTC-day boundary differs from the viewer's timezone. No direct tests of the audit trigger for an unchanged balance, a balance increase (no way to credit a balance), or a multi-row UPDATE. | **PARTLY FIXED**: filter, empty-range, past-the-end and trigger tests added. The UTC-day boundary is unchanged and still undocumented in the UI. |
| 13 | Pagination | Only `limit=2` is tested. Not covered: `page=0`, `limit=0`, `limit=101`, `limit=abc`, deep OFFSET on 60k contracts. | **FIXED** (test added) |
| 14 | Search | `ILIKE` input does not escape `%` and `_`, so a search for `%` matches everything. *(review)* | **FIXED** (`%`, `_` and `\` match literally; test added) |
| 15 | Geo | No coordinate-boundary tests: `lat=±90`, `lng=±180`, the antimeridian, a ping at exactly 5000 m, a ping at exactly the 2-hour cutoff. `Number()` accepts `0x10` and `1e1` as coordinates. | **FIXED** (strict decimal parsing; boundary, radius-edge and TTL-edge tests added) |
| 16 | Geo | `/workers/nearby` loads every ping within 5 km into memory with no cap. A measured 6.2 s end-to-end request against the frontend's 12 s abort leaves little headroom on a denser dataset. | **FIXED**: at most one current ping per worker, so the result is bounded by the worker count |
| 17 | Mongo | Untested: a freelancer with zero reviews on the platform-facet path, reviews missing `skill_tags`, and mixed string/int `freelancer_id` beyond the one existing test. Pings written by other tools without `is_current` are silently excluded. | **PARTLY FIXED**: zero-review case tested. Mixed string/int ids and missing `skill_tags` can no longer be stored (validators). Pings from other writers still need `is_current`, now documented in the README. |
| 18 | Mongo | No rate limit on `POST /workers/:id/location`. | OPEN |
| 19 | HTTP | A POST to an unknown path returns 401 before 404. `HEAD`, `DELETE` and unknown methods are untested. The 16384-byte body limit boundary is untested. | **FIXED** (tests pin the current behaviour: unknown GET 404, unsupported methods 405, actor checked before body, 16384/16385-byte limit, invalid JSON). The 401-before-404 order is kept deliberately. |

## 3. Test-suite weaknesses

| # | Problem | Status |
| --- | --- | --- |
| 20 | `npm test` skips the real-database integration suite unless `TEST_DATABASE_URL` and `TEST_MONGODB_URI` are set, so a clean-machine run passes mostly config and validation tests. | **FIXED**: `npm run test:full` fails when the databases are missing; plain `npm test` now prints why the suite was skipped |
| 21 | The integration suite is one `test()` whose sub-tests share state (`first`, `second` contract IDs); an early failure cascades. | OPEN |
| 22 | The SQL procedures had no direct tests; the standalone three-argument `fund_gig` was not covered. | **FIXED** |
| 23 | Docker Compose and a clean-machine setup have never been executed. | OPEN |

## 4. Frontend edge cases not covered

| # | Problem | Status |
| --- | --- | --- |
| 24 | `api()` calls `response.json()` unguarded, so a non-JSON 502 from a proxy shows a raw `SyntaxError`. *(review)* | **FIXED** in `frontend/app.js` (not covered by an automated browser test) |
| 25 | After a funding POST times out the UI says to check contracts; it does not retry safely with the same idempotency key. | OPEN |
| 26 | Untested: polling in a background tab, polling combined with an actor switch, a corrupt `localStorage` value, a response arriving after the actor changed. | OPEN |
| 27 | Mobile checks cover horizontal overflow only: no touch behaviour, no map pan/zoom, Chrome only. | OPEN |
| 28 | No browser test for HTML/script characters in names (`esc()` exists), or for double-clicking Fund (the README claims a pending lock). | OPEN |

---

## Problem 1 fix: Workflow 1 isolation and error handling

**What was wrong.** The assignment's Workflow 1 is "start a `REPEATABLE READ` transaction, deduct the balance, insert the order, COMMIT; on an insufficient balance catch the exception and ROLLBACK". The inherited and migrated `fund_gig` set no isolation level and had no exception handling. The API (not the SQL) opened `BEGIN` at the default `READ COMMITTED`.

**What changed**
- `backend/database/sql/04_stored_procedures.sql` is now the only definition of `fund_gig`. The 4-argument form (used by the API) raises SQLSTATE `25000` unless the transaction is `REPEATABLE READ` or stricter, since a procedure cannot change its own isolation level. The 3-argument form is a standalone entry point: it commits the call's own transaction, sets `REPEATABLE READ`, funds the gig, COMMITs, and on any exception ROLLBACKs and re-raises the original error and SQLSTATE; serialization failures (40001) are retried up to three times.
- `backend/src/api.js`: funding starts `BEGIN ISOLATION LEVEL REPEATABLE READ` and retries 40001 up to three times. The idempotency advisory lock moved from transaction scope to session scope, taken before the transaction, because a `REPEATABLE READ` snapshot is fixed by the first statement.
- `backend/src/validation.js`: a 40001 that survives the retries returns HTTP 409 with a friendly message.

## Consolidation of the SQL and Mongo scripts

Done together with the fixes above, at the request that the SQL match `assign1_ssd_v1.pdf` Project 5 and that only one extra SQL file exist.

- **SQL.** `01` to `06` follow the assignment's file list; `07_api_integration.sql` is the single API file. `08_client_locations.sql`, `09_scale_indexes.sql` and `10_fund_gig_repeatable_read.sql` are gone. `fund_gig` was defined twice (`04` and `07`) and is now defined once. Client `latitude`/`longitude` columns were removed. The audit-immutability trigger is in `03`; the Workflow 2 covering index is in `02`; redundant indexes are dropped.
- **Mongo.** `freelancer_id` must be an integer (the inherited validators and Python seeder used UUID strings that could not join to SQL). Each worker has one current ping, enforced by a unique partial index; Workflow 3 is a single `$geoNear`. The extra Mongo indexes were folded into `01`; `mark-current-pings.js` was removed. `data_generation/mongo_seeder.py` was rewritten (integer ids, one current ping per worker, repeatable).
- **Existing databases.** `npm run db:migrate` upgrades them (see `backend/README.md`, "Database consolidation").

## Verification (14 October 2026)

All runs used throwaway PostgreSQL 18 and MongoDB instances, never the configured databases.

- `npm test` with the real-database suite: 42 passed, 0 failed, 0 skipped (the previous 32 plus 10 new sub-tests; the geo test was rewritten for the new ping model).
- `npm run test:browser`: passed in the SQLite demo mode and against real PostgreSQL/MongoDB.
- Upgrade path: a PostgreSQL database built from the new `01` plus the earlier revision's extra columns, indexes, trigger names and refresh function was migrated twice; the old audit trigger and four indexes were replaced and funding and immutability still worked. The Mongo upgrade (duplicate current pings, old indexes) is covered by an integration test.
- `seed-scale.js` and `audit-scale.js` against a fresh scale database: all 13 audit checks passed; `$geoNear` used `idx_current_worker_geo`; the Workflow 2 plan used `idx_completed_revenue_cover`.

**Not verified.** The Python seeders were not run end to end: `faker` and `pymongo` could not be installed (no network), so only the generation logic of `mongo_seeder.py` was checked, with a stand-in for `faker`. `postgres_seeder.py` was not changed or run. The 40001 retry loops are exercised indirectly by the concurrency tests, not forced. Docker, the live cloud databases, and the live browser suite (`test:browser:live`) were not run. `backend/reports/` still contains the earlier cloud-run evidence, which describes the previous pipeline; re-run `npm run audit:scale` after migrating.
