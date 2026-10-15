# GigTask backend — PostgreSQL and MongoDB

This is GigTask's HTTP API, backed by the inherited GigTask repository formerly at `avni_db/`, now retained under `backend/database/`.

## Run locally

From the project root (Node.js 22.13+, PostgreSQL 16+, MongoDB 7+):

```bash
npm install --prefix backend
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit `backend/.env` with the credentials and URLs for your databases. The PostgreSQL database must exist; the migration creates application tables, not the database itself. For example, create `gigtask_db` using your PostgreSQL administration account. Start PostgreSQL and MongoDB, then:

```bash
npm run db:migrate
npm run db:seed:scale
npm start
```

Frontend: http://localhost:5173. API: http://localhost:3000/api. Health: http://localhost:3000/api/health. The health response checks both databases and returns 503 if either is unavailable. Each database-specific screen can still work independently of the other database.

The explicit migration command creates the schema (`01_schema_ddl.sql`) if the database is empty, then applies `02` to `05` and `07_api_integration.sql` on every run (all are idempotent, so it also upgrades older databases), applies the MongoDB validators and indexes from `mongo/01_collections_and_indexes.js`, and refreshes earnings. It can be rerun. Ordinary API startup does not migrate or seed databases automatically. An existing GigTask schema is expected to contain all Part A tables, indexes, triggers and the materialized view; a partially imported schema must be repaired first.

The linked seed command inserts a small synthetic relational dataset **only when clients is empty**. It uses existing SQL freelancer IDs for MongoDB portfolios, reviews and location pings. Repeated runs preserve existing SQL rows, portfolios and reviews, and refresh the linked location pings. It does not delete legacy UUID documents. If legacy MongoDB records were seeded with random UUIDs, those records remain unlinked; do not expect them to resolve to SQL freelancers. Use this linked seed for functional demos.

```bash
npm run db:pings
```

Refreshes only linked worker locations (and the earnings snapshot), without adding portfolio/review records. Pings stop appearing in discovery after two hours unless refreshed.

## Local ↔ cloud configuration

Only the backend connects to the databases. Update these values in `backend/.env` and restart the backend:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@POSTGRES_HOST:5432/gigtask_db?sslmode=verify-full
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER_HOST/?retryWrites=true&w=majority
MONGODB_DB=gigtask_db
PG_SSL_MODE=url
```

Use the connection strings and network access settings supplied by your provider. URL-encode special characters in connection-string passwords. `PG_SSL_MODE=url` respects PostgreSQL URL SSL settings, so changing the connection URL is sufficient for normal local/cloud swaps. For a custom CA, use `PG_SSL_MODE=verify-full` and `PG_SSL_CA_FILE=/path/to/ca.pem`; certificate verification remains enabled. MongoDB TLS, SRV discovery and authentication come from `MONGODB_URI`.

A new empty cloud database also needs `npm run db:migrate` and data seeding/import. Changing endpoints changes the database you connect to; it does not copy data between databases. No source-code change is needed for the same schema on another host.

If the API itself moves, update `FRONTEND_API_URL` in `frontend/.env` and set `CORS_ORIGIN` in the backend to the frontend's exact origin. Frontend configuration contains **only the public HTTP API URL**, never PostgreSQL or MongoDB credentials. `/config.js` supplies it at frontend startup without a build step.

## Structure and API boundary

```text
backend/
  src/
    config.js            environment configuration and verified PostgreSQL TLS
    connections.js       PostgreSQL pool and lazy MongoDB client
    server.js            HTTP transport, body limits, CORS, error responses
    api.js               role/ownership checks and workflow routing
    validation.js        input validation and public error mapping
    mongo-pipelines.js   parameterized $geoNear and $facet workflows
  database/              sql/01-06 (assignment), sql/07 (API only), mongo/01-03, data generators, historical evidence
  scripts/
    migrate.js           idempotent schema/index migration
    seed-linked.js       linked small seed and fresh location pings
  test/                  configuration and actual-database integration tests
  demo/                  explicit SQLite fallback, not the default backend
```

PostgreSQL serves actors, clients, freelancers, contracts, balances, audit logs, stored-procedure funding, window analytics and materialized-view summaries. MongoDB serves portfolios, reviews, `$facet` review summaries and `$geoNear` location discovery. The API joins nearby IDs back to PostgreSQL and checks availability there too. Relational money remains NUMERIC(10,2); the API returns numeric display values compatible with the existing UI and validates exact-cent budgets before passing decimal strings to PostgreSQL.

Funding runs `CALL fund_gig(client_id,freelancer_id,budget,NULL::integer)` inside an API-owned `REPEATABLE READ` transaction (migration 10; serialization failures are retried up to three times). A structured contract ID, trigger-generated audit entry, before/after balances and an idempotency record all belong to the same commit. A session-scoped advisory lock, taken before the transaction starts, serializes retries of the same key across API instances. The client row lock serializes balance deductions for the same client.

Status changes lock the contract, verify participant ownership, enforce forward transitions in both API and database, and rely on the original partial unique index to reject a second IN_PROGRESS contract. Completion does not imply a payout or refund. Earnings summaries remain cached until the UI's **Refresh earnings** action calls `refresh_freelancer_earnings()`; the function uses `REFRESH MATERIALIZED VIEW CONCURRENTLY` and records its successful refresh time.

Nearby discovery runs one `$geoNear` over each worker's single current ping (`is_current`, available, no older than two hours, within 5 km), then drops workers PostgreSQL marks unavailable. Results are bounded by the number of workers and are paginated by the API. Pings whose `freelancer_id` is not a PostgreSQL integer id cannot exist (the Mongo validators require it). Worker-location results remain usable as a list if map tiles fail.

The demo actor headers (`X-Demo-Role`, `X-Demo-Id`) are not real authentication. The API enforces permissions relative to that selected identity. Admin has no funding/status mutation permissions; refreshing derived analytics is allowed for the assignment's required refresh control.

## Backend change log — 14 October 2026

| Change | Files | Reason / effect |
| --- | --- | --- |
| Separate application folders | `backend/`, `frontend/`, root scripts | Moved old `api/` to `backend/demo/`, old `web/` to `frontend/`, and `avni_db/` to `backend/database/`. Kept the inherited scripts and historical evidence; updated imports and paths. Existing SQLite data remains at root `var/`. |
| Make real databases the default | `src/server.js`, `src/api.js`, `src/connections.js`, package files | Added actual PostgreSQL/MongoDB HTTP routes. `npm start` now starts separate API/frontend processes. SQLite requires `npm run start:demo`. Added locked `pg`/`mongodb` dependencies. |
| Configurable local/cloud endpoints | `src/config.js`, `.env.example`, frontend server/config | DATABASE_URL and MONGODB_URI select database hosts; MONGODB_DB selects the MongoDB database. FRONTEND_API_URL selects the HTTP API. Added CORS/preflight handling, connection timeouts and verified TLS configuration. |
| Correct funding direction and return contract ID | `database/sql/07_api_integration.sql` | Original `04_stored_procedures.sql` increased escrow and only printed the ID. Added a four-argument overload that checks availability, locks the client, checks balance, deducts funds and returns the inserted ID. Replaced the three-argument procedure implementation with a compatible wrapper. Originals remain on disk for comparison. |
| Correct trigger action labels | `07_api_integration.sql` | New negative changes are ESCROW_HOLD and positive changes ESCROW_RELEASE, matching the chosen available-balance convention and Assignment 1's deduction requirement. Historical audit records are not rewritten. |
| Prevent duplicate funding | `07_api_integration.sql`, `src/api.js` | Added api_funding_requests and transaction-scoped idempotency locking. Same actor/payload/key returns the original response; changed payload/key ownership gives 409. |
| Enforce budgets/status/audit integrity | `07_api_integration.sql` | Added positive-budget and required-status checks, forward-only status trigger, append-only audit protection, and client/date audit index. Existing active-contract unique index is retained. NOT VALID checks preserve historical rows while protecting new writes; old invalid records should be audited before validating constraints globally. |
| Fix sequence synchronization | `07_api_integration.sql`, linked seed | Explicitly seeded IDs require sequence correction. Migration never moves an existing sequence backwards; the small seeder syncs sequences after its first insert batch. |
| Wire required SQL analytics | `src/api.js`, `07_api_integration.sql` | Uses inherited recorded-day seven-day window semantics and SQL DENSE_RANK. Reads original freelancer_lifetime_earnings; added concurrent refresh function and api_metadata refresh time. Ranking is server-paginated. |
| Make inherited Mongo scripts executable as JS | `database/mongo/01_*.js`, `02_*.js`, `03_*.js` | Replaced interactive `use gigtask_db;` with `db = db.getSiblingDB("gigtask_db")`. Standalone scripts keep the original database name; API/migrator use MONGODB_DB. |
| Parameterize Mongo workflows for HTTP requests | `src/mongo-pipelines.js`, `src/api.js`, migrator | Reuses the review facet branches, supports selected-worker scope and dynamic origin coordinates, and adds fresh/latest/unique worker handling plus SQL availability checks. Added a freelancer/time index for latest-ping lookup. The standalone Workflow 3 remains the inherited raw-ping demonstration; API adds application-level discovery correctness. |
| Link MongoDB records to PostgreSQL | `scripts/seed-linked.js` | Old Python Mongo seeder generates unrelated UUIDs. New seed uses actual integer SQL IDs, bounded bulk writes and stable demo IDs. Existing records are preserved. |
| Enable URL-based original PostgreSQL seeding | `database/data_generation/postgres_seeder.py` | Added DATABASE_URL support; legacy POSTGRES_* variables remain supported. Original bulk seeder still requires fresh data and the original documented sequence/view refresh steps. |
| Repeatable migration and container setup | `scripts/migrate.js`, Dockerfiles, root docker-compose.yml | Creates fresh inherited schema, applies additive API fixes, provisions actual inherited Mongo validators/indexes, and supplies optional local database/frontend/API containers. No automatic schema mutation during normal API startup. |
| Verify actual databases and separated frontend | `test/`, root browser smoke | Added isolated PostgreSQL/MongoDB integration tests and cross-origin browser testing, in addition to retained SQLite demo tests. |

BiteStream informed the useful patterns of positive-amount validation, returned transaction IDs and append-only audit logs. Its UUID schema, restaurant/order fields, unsigned audit amount convention, and procedure-level COMMIT/ROLLBACK were not copied. GigTask uses signed audit deltas and lets the API own the full transaction so idempotency stays atomic.

## Tests

From root:

```bash
npm test
npm run test:browser
```

The default API suite includes SQLite fallback tests and configuration/validation tests. Actual PostgreSQL/MongoDB integration tests are skipped unless both TEST_DATABASE_URL and TEST_MONGODB_URI are supplied:

```bash
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/test_database \
TEST_MONGODB_URI=mongodb://localhost:27017 \
npm test
```

Tests create and remove a uniquely named PostgreSQL schema and MongoDB database; use test credentials with schema/database creation permission. With those same variables, `npm run test:browser` uses the real databases and a separate frontend origin. Without them, browser testing uses an isolated SQLite fallback API. Chrome is required (CHROME_BIN can override its path). Temporary schemas/databases are removed on normal completion. The database integration suite covers migrations/seeding repeated safely, CORS, ownership, procedure funding, trigger audit, idempotency, rollback, constraints, materialized view refresh, window analytics and MongoDB facet/geospatial behavior.

## Remaining assignment work

Use the original large-data generators (with shared IDs for MongoDB), regenerate performance evidence after modifications, validate historical data/constraints, add team handover/design/contribution artifacts and record the demo. Retained performance files describe the original authors' run, not evidence for these new API changes. No cloud provider credentials were supplied, so cloud reachability has not been tested.

## Location discovery and Hyderabad reset — 14 October 2026

- `src/geography.js` defines the linked demo seed center as **Hyderabad, latitude 17.3850, longitude 78.4867**, with a maximum 10 km seed radius. Most workers are within 3 km of that center, with an outer band around 6–9 km, so the demo origin always has available workers within 5 km. Availability is seeded independently. (Clients no longer have coordinates; see the consolidation section below.)
- Client latitude/longitude columns (`08_client_locations.sql`) were removed again, see the consolidation section below. MongoDB pings copy the exact PostgreSQL worker coordinates.
- Browser discovery now uses **Use my location** and the browser permission prompt. An existing location permission can be reused automatically. Permission denial, unavailable GPS, timeout and insecure origins have readable messages. Browsers require HTTPS or localhost; a website cannot force device GPS on or bypass a denied permission.
- Results prioritize the distance-sorted worker list before an expandable map. Distance is calculated by MongoDB's spherical `$geoNear` from coordinate differences, in metres; raw latitude/longitude subtraction is not a kilometre distance. The origin is the actual browser position unless the user explicitly chooses the labelled seeded Hyderabad demo location. A physical user outside the seeded area can legitimately get no matches.
- `GET /workers/nearby` now paginates **all** qualifying available workers within 5 km instead of silently limiting discovery to 20. It returns total/page/limit/totalPages, origin and radius_meters; frontend uses 10 per page. The map shows workers on the current page.
- Added `scripts/reset-demo.js` and root `npm run db:reset`. This explicitly clears only GigTask's api_funding_requests, wallet_audit_logs, contracts, freelancers and clients rows, and MongoDB Portfolios/GigReviews/WorkerLocations documents. SQL identities restart, MongoDB validators/indexes remain, and the linked seed plus materialized earnings refresh runs afterward. It does not drop either database or touch BiteStream. Both connections are checked before clearing data; resets across two databases are not one atomic transaction, so rerun the command if interrupted.
- As requested, the configured GigTask PostgreSQL and MongoDB data were cleared and reseeded with 32 clients, 48 freelancers, 160 contracts, 192 opening audit entries, 48 portfolios, 240 reviews, and fresh worker pings. The old data was intentionally replaced, not backed up. Location pings remain subject to the two-hour TTL; refresh with `npm run db:pings`.
- Added deterministic geography coverage tests and updated the browser smoke test to exercise denied/granted geolocation and the list-first flow. The original large-scale Python seeders are retained as historical/performance tools; `npm run db:seed` / `db:reset` use the new Hyderabad linked seeder.

### Demo center corrected to the supplied user location

The active demo seed center is now **17.45452, 78.35008 (Hyderabad)**, replacing the earlier central-Hyderabad coordinates, which were outside a 5 km search from the user's actual location. Future resets and seeds use the corrected center. The browser's actual GPS origin and 5 km search radius are unchanged.

### Analytics selection and ranking clarity

Clients now select freelancers by name using a searchable, server-paginated selector. Its optional Previously worked with filter uses only the selected client's IN_PROGRESS or COMPLETED contracts; FUNDED-only agreements do not count as prior work. Added `GET /freelancers?workedWith=true` with server-enforced client context in both real and SQLite APIs. Admin can search names or IDs and sees IDs beside names. Freelancer analytics remain restricted to the selected freelancer's own record. Dense ranking is still computed globally across all freelancers with completed revenue, with only the own global rank exposed to a freelancer; the UI now explicitly labels this comparison. Filtering the name selector does not recompute or narrow the global ranking.

### Name-based searches throughout client pages

Client browsing now searches freelancer names, including searching own contracts by the assigned freelancer's name. Funding options display names without requiring IDs. Reviews/portfolios reuse the searchable, paginated name selector from analytics. Admin browsing and freelancer selection retain name-or-ID search. PostgreSQL and SQLite apply role-aware search behavior on the server; contract list responses include participant names. IDs remain internal route/API identifiers and record references, not information clients must enter. No schema migration or data reset is needed for this change.

## Assignment-scale audit and refresh — 14 October 2026

The attached assignments were treated as requirements references, not as instructions to the assistant. GigTask requires at least 50,000 contracts, 100,000 audit/ledger entries and 500,000 location pings. Added `npm run db:seed:scale`, an explicitly destructive replacement of only the configured GigTask application tables/collections. It generates 1,000 clients, 2,000 freelancers, 60,000 contracts, 101,000 audit rows, 2,000 portfolios, reviews linked one-to-one to completed seeded contracts, and 500,000 geospatial pings. Names are unique combinations from curated real first/last names, with no numeric suffixes; neighbouring ids get different surnames. Shared numeric freelancer IDs link both databases.

The synthetic ledger now reflects the contracts: each client has an opening deposit, every contract holds its budget (a reduction), and two contracts in three are preceded by a top-up of half that budget. The opening deposit is chosen so the running balance ends exactly at the seeded current balance, and it never dips below it. Rows are written directly rather than through the trigger, which can only stamp the present time; the live funding flow is tested separately. (This replaces the earlier opening-deposit plus top-up/hold pair design, under which contracts did not change balances.)

Changes discovered during scale validation (the index, pipeline and current-ping details below describe that revision; the consolidation section at the end of this file is the current design):

- `09_scale_indexes.sql`: covering partial index on completed freelancer/creation-date revenue including budget. Enables an index-only window-query input after VACUUM/ANALYZE; the original active-contract unique index remains.
- `src/config.js`: PostgreSQL sessions now explicitly use UTC to match the API's interpretation of inherited timestamp-without-time-zone fields. Seeded reviews cannot be dated in the future.
- `src/mongo-pipelines.js`: replaced sorting all historical pings with a bounded `$top` accumulator. The cloud cluster rejected the original sort at its memory limit; increasing timeouts would not fix that.
- `is_current` flags and partial `idx_current_worker_geo` 2dsphere index: the API's `$geoNear` searches current available pings, while all 500,000 historical pings remain in WorkerLocations with the original 2dsphere and two-hour TTL indexes. Latest-ping lookup still checks all fresh history so an older near ping cannot override a newer outside/unavailable ping. Scale seeds mark the final ping in each worker history current; functional/ping seeders mark their stable latest records current. `scripts/mark-current-pings.js` can rebuild current flags for linked records already imported without them.
- `POST /api/workers/:id/location`: only that selected freelancer may publish a validated fresh ping. It upserts a stable current record, ensuring polling sees new locations without growing an unbounded set of current flags. External writers should follow this API/current-record convention, rather than insert arbitrary unmarked history and expect it to become the live location.
- `npm run audit:scale`: checks counts, names, exact ledger reconciliation, balances/statuses/unique active workers, client proximity, ID coverage, indexes, lifetime totals, API pagination/permissions and large-data workflows. Saves fresh actual EXPLAIN plans and execution statistics in `backend/reports/`.
- `npm run test:browser:live`: exercises the current configured dataset through real API/browser flows on temporary server ports. It creates two small contracts and trigger audit entries, then demonstrates start/conflict/complete/retry, refresh, roles, reviews and location/map behavior. It does not wipe the scaled data.
- Added a retrospective handover note, role/design notes and six SVG screen wireframes under docs/. Removed docs/ from .gitignore so assignment documentation can be included in version control.

Seed manifest and audit reports contain no database connection credentials. Pings expire after two hours by design; refresh pings for a demo, or rerun the scale seed to reproduce the full 500,000-row capture. `npm run db:pings` refreshes one stable current location per worker and does not reconstruct an expired historical dataset.

Unfiltered platform `$facet` necessarily reads every review and may report COLLSCAN. The report also captures selected-worker `$facet`, which can use the freelancer index. No planner flags force index use, and no collection scan is falsely labelled indexed. See docs/requirements_audit.md for the requirement-by-requirement outcome and remaining team submission items.

### Final validation outcome

All 13 scale-audit checks, 31 regression/integration tests (no skips), and the live configured-dataset browser suite passed. Actual checked counts and planner excerpts are pasted in the root README. Financial browser checks add small test contracts/audits; polling checks add stable worker-ping records and restore their positions. Bounded retry in the test applies only to idempotent location writes after an intermittent cloud 503; funding retries continue to use persisted idempotency keys. Standalone MongoDB scripts now respect the database selected in the mongosh URI, and Workflow 3 uses the current-ping pipeline at the supplied Hyderabad origin. The frontend refreshes stored actor names from the API after data replacement so an old cached demo name is not displayed.

### Standalone script alignment

As part of the final audit, standalone SQL 03/04/05 were aligned with the corrected negative-hold funding semantics, structured four-argument procedure output (plus compatible three-argument wrapper), and concurrent refresh function. Their unmodified inherited versions were archived in database/docs/inherited-scripts/ for comparison. Migration 07 still adds/enforces the API metadata and guards. Mongo setup 01 now declares the current-ping and latest-history indexes itself; standalone Workflow 3 shares the corrected current-location semantics. Thus executing the documented scripts independently no longer reinstalls the original opposite-direction funding behavior.

## Database consolidation — 14 October 2026

The SQL and Mongo scripts were rewritten to match Assignment 1 Project 5 exactly, with one extra SQL file for the API. `sql/08`, `09` and `10`, and `scripts/mark-current-pings.js`, were removed; their contents now live in the numbered files. The problems behind each change are listed in `docs/problems.md`.

| File | Contents |
| --- | --- |
| `sql/01_schema_ddl.sql` | The four spec tables only. `contracts` has `CHECK (budget > 0)` and a non-null status defaulting to FUNDED; no client coordinates. Runs only on an empty database. |
| `sql/02_indexes.sql` | `idx_active_gig` (the required partial unique index), foreign-key indexes, the covering partial index for Workflow 2, the audit index. Replaces redundant older indexes. |
| `sql/03_triggers_and_audit.sql` | Escrow audit trigger (HOLD for decreases, RELEASE for increases) and the immutability trigger (the audit table is append-only). |
| `sql/04_stored_procedures.sql` | Workflow 1: `fund_gig` in a `REPEATABLE READ` transaction. The 3-argument form commits or rolls back by itself and retries serialization failures; the 4-argument form is for callers that own a `REPEATABLE READ` transaction (the API) and refuses weaker isolation. |
| `sql/05_materialized_views.sql` | `freelancer_lifetime_earnings`, its unique index, and `refresh_freelancer_earnings()` using `REFRESH ... CONCURRENTLY`. |
| `sql/06_window_analytics.sql` | Workflow 2: CTEs, seven-day moving average, `DENSE_RANK()`. |
| `sql/07_api_integration.sql` | API only: idempotency table, refresh timestamp table, forward-only contract status trigger, `api_refresh_earnings()`. |
| `mongo/01_collections_and_indexes.js` | Validators (`freelancer_id` is the integer PostgreSQL id) and indexes: 2dsphere, 2-hour TTL, a partial 2dsphere index on current pings, and a unique partial index allowing one current ping per worker. Safe to re-run in mongosh. |
| `mongo/02_workflow3_geonear.js`, `03_workflow4_facet.js` | Workflows 3 and 4. |

Behaviour changes worth knowing:

- **Funding isolation.** The API starts `BEGIN ISOLATION LEVEL REPEATABLE READ` and retries serialization failures (40001) up to three times. The per-key idempotency advisory lock is session-scoped and taken before the transaction: a `REPEATABLE READ` snapshot is fixed by the first statement, so waiting for a lock inside it would hide a same-key request that committed meanwhile. Idempotency records older than a day are deleted after a successful funding.
- **Location pings.** `POST /api/workers/:id/location` now inserts a new ping and clears the worker's previous `is_current` flag first, so history is kept and the unique partial index holds. Workflow 3 is a single `$geoNear`; the earlier `$group`/`$lookup` stages, which compensated for several current pings per worker, are gone. If an insert fails after the flag was cleared, the worker is hidden until the next ping.
- **Existing databases.** `npm run db:migrate` upgrades them: it replaces the funding procedures, trigger names and refresh function, drops the indexes listed in `02`, drops the two Mongo indexes older revisions created, and unsets duplicate current pings before building the unique index. It does not drop the old `clients.latitude`/`longitude` columns (unused, harmless; drop them manually if you want the spec schema exactly) or `clients.created_at`.
- **Reports.** `backend/reports/` was produced by the earlier pipeline and indexes. Re-run `npm run audit:scale` against your database after migrating to refresh it.
- **Validation.** Identifiers must be integers (numbers or digit strings), budgets must be a string or number, coordinates must be plain decimals, and `%`/`_` in searches match literally.
- **Tests.** `npm test` skips the real-database suite unless `TEST_DATABASE_URL` and `TEST_MONGODB_URI` are set; `npm run test:full` makes missing databases a failure.

## Frontend module compatibility — 15 October 2026

The SQLite demo server now uses `frontend/static-files.js` to serve the frontend's `pages/` and `shared/` ES modules after the page refactor. The independent frontend server uses the same explicit allowlist. Private files such as `.env`, server source and package metadata remain inaccessible. API routes, database schemas and data were not changed. Regression tests cover module delivery through both servers and private-file rejection.
