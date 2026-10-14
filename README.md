# GigTask — frontend and database API

GigTask now has **separate frontend and backend folders**. The default API connects to the inherited GigTask PostgreSQL and MongoDB databases. Local/cloud database hosts are selected through environment variables, with no application-code changes.

```text
frontend/                    browser UI + independent static server
backend/
  src/                       PostgreSQL/MongoDB HTTP API
  database/                  inherited avni_db schema, scripts, seeders and evidence
  scripts/                   migrations and linked functional-demo seed
  test/                      real-database/configuration tests
  demo/                      optional SQLite fallback
```

Read [backend/README.md](backend/README.md) for the **backend change log**, configuration, transaction decisions and test details. The assignment PDFs and the flow DOCX are kept as references.

## Local setup

Requires Node.js 22.13+, PostgreSQL 16+ and MongoDB 7+. Create an empty PostgreSQL database named `gigtask_db` using your database account, then from this project root:

```bash
npm install --prefix backend
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit `backend/.env` to match your PostgreSQL/MongoDB credentials. Start both databases, then:

```bash
npm run db:migrate
npm run db:seed:scale
npm start
```

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3000/api
- **Database health:** http://localhost:3000/api/health

`npm start` launches both processes and stops both when interrupted. Alternatively run `npm run start:backend` and `npm run start:frontend` in separate terminals. The frontend fetches the API across ports using configured CORS. Normal server startup never creates schemas or seeds data implicitly.

The scale seed deliberately replaces existing GigTask data with 1,000 clients, 2,000 freelancers, 60,000 contracts, 101,000 reconciled audit records (every contract reduces its client's balance) and 500,000 fresh worker pings. MongoDB portfolios/reviews use shared SQL IDs; names have no numeric suffixes. For the smaller non-destructive functional fixture, use `npm run db:seed` instead.

To refresh synthetic worker pings after their two-hour lifetime:

```bash
npm run db:pings
```

## Docker alternative

```bash
docker compose up -d --build
docker compose exec backend npm run migrate
docker compose exec backend npm run seed:scale
```

Then open http://localhost:5173. Compose provides PostgreSQL, MongoDB, API and frontend with persistent database volumes and loopback-bound host ports. Existing services on ports 5432/27017 must be stopped or the mappings adjusted first. Compose environment settings use service hostnames inside containers; frontend configuration uses the browser-accessible API URL. `backend/.env` configures host-run processes, not the Compose environment block.

## Switch local databases to cloud

Update **backend/.env** and restart the backend:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@POSTGRES_HOST:5432/gigtask_db?sslmode=verify-full
MONGODB_URI=mongodb+srv://USER:PASSWORD@MONGO_CLUSTER/?retryWrites=true&w=majority
MONGODB_DB=gigtask_db
PG_SSL_MODE=url
```

Use your provider's connection strings and access configuration. A fresh cloud database needs migration and data import/seeding too; changing a URL does not transfer existing data. Custom PostgreSQL CA certificates are supported by PG_SSL_CA_FILE with PG_SSL_MODE=verify-full.

If you move the API server itself, change **frontend/.env**:

```dotenv
FRONTEND_API_URL=https://YOUR_API_HOST/api
```

Set backend `CORS_ORIGIN` to the frontend's actual origin. Database URLs are never sent to the browser. Cloud endpoints have not been tested because no provider credentials were supplied.

## Optional offline SQLite demo

```bash
npm run start:demo
```

Starts the independent frontend and the retained SQLite API. Existing root `var/gigtask.sqlite` data is preserved. This mode does not demonstrate the required PostgreSQL/MongoDB workflows. Default `npm start` uses real PostgreSQL/MongoDB.

## Implemented flows

Persistent demo actor switching; role-scoped browsing with server pagination; client/freelancer/contract details; prefilled funding with confirmation and preserved failure input; atomic stored-procedure funding and trigger audit; idempotent retries; participant-only forward status controls; database active-contract conflicts; date-filtered audit with running balances; SQL window/dense-rank analytics; materialized-view refresh; MongoDB portfolios/reviews/$facet analytics; fresh unique nearby workers using $geoNear; map/list results and polling; responsive layout and loading/empty/error states.

Funding follows Assignment 1's deduction requirement: the inherited escrow_balance field is the available seeded client balance in this demo; reserving a budget reduces it. The API migration corrects the inherited procedure's opposite direction. Completion records revenue but does not implement payouts or refunds. This decision and all backend changes are logged in backend/README.md.

## Verify

```bash
npm test
npm run test:browser
```

Use TEST_DATABASE_URL and TEST_MONGODB_URI to enable the isolated actual-database integration tests and run the browser suite with real PostgreSQL/MongoDB. See backend/README.md for details. Tests create unique temporary schemas/databases and do not use ordinary configured application data.

Assignment-scale linked data, fresh execution-plan evidence, a handover note and retrospective design wireframes have now been added. See `docs/requirements_audit.md` and `backend/reports/` for verified results. Remaining team submission work includes contribution details, final repository/history verification, repository URL/commit hash and a ≤5-minute demo video. The final ZIP must follow the assignment naming/size rules and exclude node_modules, .env files, local database files, build output and dumps. Real login, payment gateways, portfolio editing and review submission are outside the minimal required flow.

## Verified assignment-scale result — 14 October 2026

All 13 scale-audit checks passed, all 31 regression/real-database tests passed with no skips, and the live browser suite passed against the configured scale dataset. It covered real funding/audit, insufficient-funds preservation, active-contract conflict/recovery, role restrictions, analytics refresh, portfolios/reviews, geolocation, map controls/fallback, and a new worker ping appearing through polling without a page reload.

Final checked counts (small test transactions/pings are included):

| Data | Count |
| --- | ---: |
| clients | 1,000 |
| freelancers | 2,000 |
| contracts | 60,007 |
| wallet_audit_logs | 121,007 |
| Portfolios | 2,000 |
| GigReviews | 41,860 |
| WorkerLocations | 500,002 |

All 3,000 participant names are unique and contain no digits. All ledger rows and current balances reconcile exactly, all IDs link across databases, every seeded client has available workers within 5 km, and current lifetime totals agree with completed contracts.

Fresh PostgreSQL window-query proof (unforced planner; full plan in backend/reports/postgres-explain.txt):

```text
->  Index Only Scan using idx_completed_revenue_cover on contracts  (cost=0.29..1659.31 rows=42001 width=18) (actual time=0.080..51.516 rows=41864.00 loops=1)
Heap Fetches: 4
Planning Time: 1.324 ms
Execution Time: 381.790 ms
```

Fresh MongoDB execution-stat excerpts (full plans in backend/reports/mongo-execution-stats.json; cursor timings exclude later pipeline stages):

```json
{
  "geoNear": {
    "cursorExecutionTimeMillis": 368,
    "totalKeysExamined": 1698,
    "totalDocsExamined": 3119,
    "index": "idx_current_worker_geo"
  },
  "platformFacet": {
    "cursorExecutionTimeMillis": 156,
    "totalKeysExamined": 0,
    "totalDocsExamined": 41860,
    "plan": "COLLSCAN (expected full-platform aggregate)"
  },
  "selectedWorkerFacet": {
    "cursorExecutionTimeMillis": 0,
    "totalKeysExamined": 30,
    "totalDocsExamined": 30,
    "index": "idx_gigrevs_freelancer_created"
  }
}
```

The unfiltered platform facet scans all reviews by definition; selective worker facets and current geospatial discovery use their indexes. The observed end-to-end nearby API request took 6249 ms on the configured cloud connection. These are observed results, not performance guarantees.

Audit: [docs/requirements_audit.md](docs/requirements_audit.md). Evidence: [backend/reports/scale-audit.json](backend/reports/scale-audit.json), [backend/reports/e2e-live.json](backend/reports/e2e-live.json). Wireframes (one SVG board per screen in `docs/design/`): [design system](docs/design/00_design_system.svg), [browse](docs/design/02_browse_contracts.svg), [fund a gig](docs/design/06_fund_gig.svg), [audit](docs/design/08_escrow_audit.svg), [analytics](docs/design/09_freelancer_analytics.svg), [nearby map](docs/design/10_nearby_workers.svg), [reviews](docs/design/12_reviews_portfolios.svg), [phone screens](docs/design/11_mobile_screens.svg).

Still needed for submission: actual team contribution details, verified assigned-fork/history, final team repository URL/commit hash, and the linked ≤5-minute demo video. Docker Compose and clean-machine setup remain unverified. Location pings naturally expire after two hours; regenerate scale data when fresh count/performance proof is needed.
