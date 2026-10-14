# GigTask Database Setup

**GitHub repository:** `https://github.com/Avanishx05/team_4_a1`
**Final commit hash:** `a263c12d0c40cab3ad1e74bdefb198b3372dc55a`

## Prerequisites
- PostgreSQL 16+ and MongoDB installed and running locally
- Python 3 with dependencies from data_generation/requirements.txt

## Setup order (Postgres)
1. createdb gigtask_db
2. Run SQL files in order:
   - psql gigtask_db -f sql/01_schema_ddl.sql
   - psql gigtask_db -f sql/02_indexes.sql
   - psql gigtask_db -f sql/03_triggers_and_audit.sql
   - psql gigtask_db -f sql/04_stored_procedures.sql
   - psql gigtask_db -f sql/05_materialized_views.sql
   - psql gigtask_db -f sql/07_api_integration.sql   (only needed by the web API)
   - sql/06_window_analytics.sql is the Workflow 2 query; run it with psql -f whenever you want the result.
3. Seed data: python3 data_generation/postgres_seeder.py
4. After seeding, sync identity sequences to the seeder's manually-assigned IDs:
   - SELECT setval(pg_get_serial_sequence('clients', 'id'), (SELECT MAX(id) FROM clients));
   - SELECT setval(pg_get_serial_sequence('freelancers', 'id'), (SELECT MAX(id) FROM freelancers));
   - SELECT setval(pg_get_serial_sequence('contracts', 'id'), (SELECT MAX(id) FROM contracts));
   - SELECT setval(pg_get_serial_sequence('wallet_audit_logs', 'id'), (SELECT MAX(id) FROM wallet_audit_logs));
5. Refresh the materialized view after seeding: REFRESH MATERIALIZED VIEW CONCURRENTLY freelancer_lifetime_earnings;

**Run once against a fresh database.** postgres_seeder.py inserts rows with
explicit, script-assigned IDs and does not TRUNCATE first or use
ON CONFLICT DO NOTHING. Running it a second time against the same database
without recreating it first will fail on primary-key violations. If you need
to reseed, drop and recreate gigtask_db first.

## Setup order (MongoDB)
1. mongosh gigtask_db mongo/01_collections_and_indexes.js
2. Seed data: python3 data_generation/mongo_seeder.py --freelancers 5000 (use the same count as postgres_seeder.py; documents refer to PostgreSQL freelancers by integer id)
3. Run workflow scripts: mongo/02_workflow3_geonear.js, mongo/03_workflow4_facet.js

**Note on invocation:** all mongo/*.js scripts are meant to be run with the
target database passed on the command line, as shown above (mongosh gigtask_db
<file>.js). 01_collections_and_indexes.js additionally includes an explicit
use gigtask_db; since it performs schema-creating writes (collections,
validators, indexes) and should not depend on how it is invoked.
02_workflow3_geonear.js and 03_workflow4_facet.js rely on the database being
selected via the command line as shown above.

**mongo_seeder.py is repeatable.** It now empties the three collections first, so the paragraph below describes how the original evidence was captured, not how the script behaves today.

**Original behaviour of mongo_seeder.py (historical):** It does not drop or clear existing
documents before inserting, so running it more than once (or with different
--reviews/--locations counts across runs) appends on top of whatever is
already there rather than replacing it. This is why the actual GigReviews
count captured in the Workflow 4 performance proof below (400,000 documents)
is higher than the script's own --reviews default (100,000) — the collection
was seeded across more than one run. If you reseed, drop the
Portfolios/GigReviews/WorkerLocations collections first
(db.GigReviews.drop(), etc.) for a clean, reproducible count.

## Current pings
Each worker has at most one WorkerLocations document with is_current: true (its latest position); a unique partial index enforces this. Workflow 3 searches only those documents. mongo_seeder.py marks the last ping of every worker current.

## Known behavior: WorkerLocations TTL vs. bulk seeding
WorkerLocations has a 2-hour TTL index (per spec, modeling live location pings).
Seeded documents are timestamped 0-5 minutes in the past to simulate "just pinged"
workers, giving the full batch a safe ~2-hour runway before any natural expiry.
Performance captures for Workflow 3 ($geoNear) were taken shortly after seeding.

## Data scale (verified at time of performance capture)
- wallet_audit_logs: 150,000+ rows
- contracts: 60,000+ rows
- WorkerLocations: 600,000 documents
- GigReviews: 400,000 documents (see idempotency note above — actual count
  exceeds the seeder's own --reviews default of 100,000 because it was run
  more than once without clearing the collection first)

---

## PostgreSQL Business Logic

### Escrow Audit Logging
- sql/03_triggers_and_audit.sql
- AFTER UPDATE trigger on clients.escrow_balance
- Automatically records escrow balance changes in wallet_audit_logs
- Records client ID, amount changed, action type, balance after, and timestamp

### Atomic Gig Funding
- sql/04_stored_procedures.sql
- Implements the fund_gig() stored procedure
- Validates gig budget, client, and freelancer
- Locks the client row using FOR UPDATE
- Deducts the gig budget from the client's escrow balance (the original script added it; fixed)
- 3-argument form: runs in its own REPEATABLE READ transaction, commits, and on any error rolls back and re-raises
- 4-argument form: for callers that already hold a REPEATABLE READ transaction (the API); refuses weaker isolation
- Creates a FUNDED contract
- Escrow update and contract creation execute atomically

### Freelancer Lifetime Earnings
- sql/05_materialized_views.sql
- Materialized view: freelancer_lifetime_earnings
- Stores lifetime completed contract count and total completed earnings
- Unique index on freelancer_id supports concurrent refresh
- Refresh using:
  - REFRESH MATERIALIZED VIEW CONCURRENTLY freelancer_lifetime_earnings;

---

## Performance Proof

> The captures below are historical (inherited team, earlier schema). Current captures for the web-API pipeline are written by `npm run audit:scale` to `backend/reports/`.

Full raw captures also live in performance/postgres_explain_analyzes.txt and
performance/mongo_execution_stats.json. Key results are reproduced inline
below per the submission requirement.

### Workflow 2 — Window Analytics (sql/06_window_analytics.sql)

EXPLAIN ANALYZE confirms use of the idx_completed_gig partial index rather
than a sequential scan of contracts.

```
 WindowAgg  (cost=8317.24..8320.72 rows=200 width=52) (actual time=96.319..97.327 rows=4996.00 loops=1)
   Window: w1 AS (ORDER BY latest_freelancer_avg.moving_avg_revenue ROWS UNBOUNDED PRECEDING)
   Buffers: shared hit=41109
   ->  Sort  (cost=8317.22..8317.72 rows=200 width=44) (actual time=96.310..96.439 rows=4996.00 loops=1)
         Sort Key: latest_freelancer_avg.moving_avg_revenue DESC
         Sort Method: quicksort  Memory: 388kB
         ->  Subquery Scan on latest_freelancer_avg  (cost=39.52..8309.57 rows=200 width=44) (actual time=0.866..95.242 rows=4996.00 loops=1)
               ->  Unique  (cost=39.52..8309.57 rows=200 width=44) (actual time=0.864..94.889 rows=4996.00 loops=1)
                     ->  Incremental Sort  (cost=39.52..8206.01 rows=41426 width=44) (actual time=0.864..93.072 rows=41227.00 loops=1)
                           Sort Key: seven_day_freelancer_avg.freelancer_id, seven_day_freelancer_avg.earning_day DESC
                           Presorted Key: seven_day_freelancer_avg.freelancer_id
                           Full-sort Groups: 1138  Sort Method: quicksort  Average Memory: 26kB  Peak Memory: 26kB
                           ->  Subquery Scan on seven_day_freelancer_avg (actual time=0.410..86.665 rows=41227.00 loops=1)
                                 ->  WindowAgg (actual time=0.409..84.242 rows=41227.00 loops=1)
                                       Window: w1 AS (PARTITION BY contracts.freelancer_id ORDER BY (date_trunc('day'::text, contracts.created_at)) RANGE BETWEEN '6 days'::interval PRECEDING AND CURRENT ROW)
                                       ->  GroupAggregate (actual time=0.382..50.564 rows=41227.00 loops=1)
                                             Group Key: contracts.freelancer_id, (date_trunc('day'::text, contracts.created_at))
                                             ->  Incremental Sort (actual time=0.361..36.125 rows=41452.00 loops=1)
                                                   Sort Key: contracts.freelancer_id, (date_trunc('day'::text, contracts.created_at))
                                                   Presorted Key: contracts.freelancer_id
                                                   Full-sort Groups: 1146  Sort Method: quicksort  Average Memory: 26kB  Peak Memory: 26kB
                                                   ->  Index Scan using idx_completed_gig on contracts (actual time=0.053..29.811 rows=41452.00 loops=1)
                                                         Index Searches: 1
 Planning Time: 1.605 ms
 Execution Time: 97.555 ms
```

- Index used: Index Scan using idx_completed_gig on contracts
- Completed contract rows processed: 41,452
- Execution time: 97.555 ms

### Partial Index Verification — idx_active_gig

SQL:
```sql
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT freelancer_id, id AS contract_id, status
FROM contracts
WHERE freelancer_id = 1 AND status = 'IN_PROGRESS';
```

```
 Index Scan using idx_active_gig on contracts  (cost=0.28..8.30 rows=1 width=30) (actual time=0.536..0.537 rows=1.00 loops=1)
   Index Cond: (freelancer_id = 1)
   Index Searches: 1
   Buffers: shared hit=3
 Planning Time: 1.855 ms
 Execution Time: 0.577 ms
```

- Index used: Index Scan using idx_active_gig on contracts
- Index condition: freelancer_id = 1
- Execution time: 0.577 ms
- This is also what enforces the "no overlapping active contract per
  freelancer" constraint at the database level, not just a read-path
  optimization.

Complete PostgreSQL execution plans are available in
performance/postgres_explain_analyzes.txt.

### MongoDB — Workflow 3 ($geoNear on WorkerLocations)

Captured via db.runCommand({ explain: { aggregate: "WorkerLocations", ... },
verbosity: "executionStats" }) against the real seeded collection. Full raw
capture in performance/mongo_execution_stats.json under geoNear_workflow3.

winningPlan.stage: FETCH (filter: is_available) -> inputStage:
GEO_NEAR_2DSPHERE using indexName "idx_workerlocations_2dsphere"

```json
{
  "executionSuccess": true,
  "nReturned": 32,
  "executionTimeMillis": 44,
  "totalKeysExamined": 341,
  "totalDocsExamined": 307
}
```

341 index keys and 307 documents examined to return the nearest candidates
(the pipeline's final $limit narrows output to 20) — nowhere near a scan of
the full WorkerLocations collection. This confirms GEO_NEAR_2DSPHERE is
driving the query via idx_workerlocations_2dsphere, not a COLLSCAN.

### MongoDB — Workflow 4 ($facet on GigReviews)

Captured the same way against the real seeded GigReviews collection (400,000
documents at capture time — see idempotency note above). Full raw capture in
performance/mongo_execution_stats.json under facet_workflow4.

winningPlan.stage: PROJECTION_SIMPLE -> inputStage: COLLSCAN

```json
{
  "executionSuccess": true,
  "nReturned": 400000,
  "executionTimeMillis": 728,
  "totalKeysExamined": 0,
  "totalDocsExamined": 400000
}
```

This COLLSCAN is expected and correct, not a missed index. $facet here
computes three things simultaneously — the full rating distribution, top
skill-tags via $unwind, and the overall average rating — each of which is an
aggregate over the entire GigReviews collection by definition. There is no
selective predicate for an index to narrow down (totalKeysExamined: 0
confirms no index was even consulted); every document must be read
regardless of which index exists. A COLLSCAN for a full-collection aggregate
is the same category of "expected, not a defect" as a full table scan on
SELECT COUNT(*) FROM table with no WHERE clause in Postgres — the supporting
indexes built in mongo/01_collections_and_indexes.js
(idx_gigrevs_freelancer_created, idx_gigrevs_rating) exist for other,
selective access patterns (e.g. "reviews for freelancer X"), not for this
full-collection aggregate.
