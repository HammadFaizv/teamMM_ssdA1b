# GigTask handover note

A retrospective record of what was inherited and what changed. It does not claim the original team designed the new UI or API. The inherited repository is kept in `backend/database/` (formerly `avni_db/`); the BiteStream repository was read only as a reference and nothing was copied from it.

## Inherited vs. current database

| Area | Inherited | Current |
|---|---|---|
| `01` schema | No defaults on `created_at` or `status`; `action_type` nullable; FKs added via `ALTER TABLE` | Defaults (`now()`, `FUNDED`); `action_type NOT NULL`; `CHECK (budget > 0)`; inline FKs; no client coordinates |
| `02` indexes | Plain `CREATE INDEX` (fails on re-run); extra `freelancer_id` index | `IF NOT EXISTS` throughout; covering index for Workflow 2; `(client_id, timestamp, id)` audit index; redundant indexes dropped |
| `03` audit trigger | Increase logged as `ESCROW_HOLD`, decrease as `ESCROW_RELEASE` (backwards) | Labels corrected; second trigger makes `wallet_audit_logs` append-only |
| `04` `fund_gig` | Adds the budget instead of deducting; no balance or availability check; ID only printed via `NOTICE` | Deducts; rejects insufficient balance and unavailable workers; requires `REPEATABLE READ`; returns the contract ID. A 3-argument wrapper commits, rolls back and retries serialization failures |
| `05` materialized view | View and unique index only | Adds `refresh_freelancer_earnings()` (concurrent refresh) |
| `06` window query | No final `ORDER BY` | Ordered by rank, then freelancer |
| `07` API objects | Did not exist | Idempotency table, refresh timestamp, forward-only status trigger, `api_refresh_earnings()` |
| Mongo `01` | Hard-coded `use gigtask_db;`; IDs may be strings or UUIDs; no current-ping concept | Re-runnable; integer IDs matching SQL; `is_current` flag with a partial 2dsphere index and a unique partial index (one current ping per worker) |
| Mongo `02` (geo) | Up to 20 results, no freshness filter | Current, available pings from the last 2 hours, top 5; availability confirmed in SQL |
| Mongo `03` (facet) | Hard-coded `use` | Same pipeline, `use` removed |
| Seeders | `mongo_seeder.py` appends on every run with unrelated UUIDs; `postgres_seeder.py` needs `POSTGRES_*` variables | `mongo_seeder.py` is repeatable and linked to SQL IDs; `postgres_seeder.py` also accepts `DATABASE_URL` |

Explicitly seeded SQL IDs need identity sequences synchronised after seeding.

## What the new work does

- **Funding:** the API owns one `REPEATABLE READ` transaction covering client locking, `fund_gig`, the audit trigger, structured contract output and idempotency storage. It takes the idempotency advisory lock before the transaction starts.
- **Integrity:** checks enforce positive budgets, non-negative balances, forward-only status changes and one `IN_PROGRESS` contract per worker. Several `FUNDED` contracts are allowed. Completion does not pay out or refund.
- **Architecture:** the browser talks to an independent HTTP API using configurable database URLs. Permissions follow the selected demo actor; there is no real authentication. PostgreSQL handles money, relations and window analytics; MongoDB handles the geo and facet workflows.
- **Location:** only each worker's latest, unexpired ping counts as current, so expired and duplicate pings never show up as workers.
- **Migrations:** `npm run db:migrate` upgrades databases created by earlier revisions and is safe to re-run. SQL is `01`–`06` as the assignment lists them, plus one API-only `07`.

## Data and caveats

- **Scale seed:** 1,000 clients, 2,000 freelancers, 60,000 contracts, 101,000 reconciled audit entries, one portfolio per worker, reviews linked to completed contracts and 500,000 pings. Names use curated first/last combinations without digits, and coordinates stay near the Hyderabad origin.
- **Unchanged Mongo requirements:** `WorkerLocations` still has the `2dsphere` index on `location` and the 2-hour TTL index (`expireAfterSeconds: 7200`) on `created_at`. The current version only adds a partial 2dsphere index and a unique index on `is_current` pings.
- **Ping lifetime:** pings expire after two hours, so capture count and performance evidence soon after seeding. This is intended TTL behaviour, not durable storage.
- **Money and revenue:** escrow is treated as available balance. Revenue is attributed to the contract creation date and averaged over recorded days in a seven-calendar-day range. Earnings stay cached until an explicit concurrent refresh.
- **Facet scan:** the unfiltered platform-wide facet reads every review, so its collection scan should be reported honestly next to selective indexed review access.

## Fixed issue: Workflow 1 isolation level

Assignment 1 requires `REPEATABLE READ`, COMMIT on success and ROLLBACK on error. The inherited `fund_gig` set no isolation level and had no error handling, so correctness rested on the `FOR UPDATE` lock alone. The four-argument `fund_gig` now refuses to run below `REPEATABLE READ`, and the three-argument form manages its own transaction as described above. The API also begins at `REPEATABLE READ`.

## Consolidation to the assignment layout

Earlier work added three extra migrations (`08` client coordinates, `09` covering index, `10` isolation fix) and duplicated `fund_gig` in `04` and `07`. These were merged back: the audit-immutability trigger lives in `03`, the covering index in `02`, and `07` holds only API objects. The client latitude/longitude columns were dropped because the assignment's `clients` table has none and the API never read them. On the Mongo side, the unique current-ping index removed the `$group`/`$lookup` stages and the unbounded in-memory result from Workflow 3.

## Notes

- **Forked team copy:** `team_4_a2_frontend/backend` keeps the team's original `database/` files unchanged. The current versions are in `database/a2/`, and `scripts/migrate.js` and `scripts/audit-scale.js` read from there.
- **For the original authors:** return transaction IDs, share IDs across databases, make seed scripts repeatable and configurable, state money semantics explicitly, and keep execution plans reproducible.
- **Still needed from the submitting team:** repository history, contribution details, the final commit and the demo video.
- **Evidence:** fresh verification output is in `backend/reports/`; inherited performance captures are historical only. Open items are in `docs/problems.md`.
