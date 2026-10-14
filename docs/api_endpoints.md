# GigTask API

Base: `http://localhost:3000/api`. JSON responses. Errors: `{ "error": "readable message" }` with 400 validation, 401 missing/invalid actor, 403 forbidden, 404 missing record, 409 business/database conflict, 413 oversized body, or 405 unsupported action. Default backend responses include `mode: "postgres-mongo"`. The separate SQLite fallback reports `demo-sqlite`. Configure the browser HTTP API URL through `frontend/.env` and database URLs through `backend/.env`; see `backend/README.md`.

## Demo identity

Protected routes require `X-Demo-Role: client|freelancer|admin`. Client/freelancer also require `X-Demo-Id: <existing person ID>`. These are demo selectors, **not authenticated credentials**. The API checks role, person existence and record ownership on every protected request. Admin cannot mutate.

Public routes:

- `GET /health` → `{status,mode}`.
- `GET /actors?role=client&page=1&limit=10&search=Priya` → paginated `{id,name}` options, with no balances. Role must be client or freelancer.

## Pagination

Collection responses: `{data:[],page,limit,total,totalPages,mode}`. Default limit 10, maximum 100. Out-of-range pages return empty data. Pagination and filters execute in SQL.

## Browse and detail

| Route | Inputs / behavior |
| --- | --- |
| `GET /overview` | Role-scoped summary; client gets own balance, never another client's balance |
| `GET /clients` | Admin: all; client: own record; freelancer: forbidden; search/page/limit |
| `GET /clients/:id` | Admin or that client; `{data:{id,name,escrow_balance,created_at}}` |
| `GET /freelancers` | Client/admin: workers; freelancer: own record; search, `available=true`, page/limit |
| `GET /freelancers/:id` | Freelancer restricted to own profile; client/admin may inspect any |
| `GET /contracts` | Actor ownership filter applied first; search ID, status, page/limit; admin can filter clientId |
| `GET /contracts/:id` | Participants or admin; ID, client_id, freelancer_id, budget, status, created_at |
| `GET /freelancers/:id/portfolio` | Own freelancer or any client/admin; `{data:document|null}` |

## Fund a gig

`POST /contracts/fund`: client only. Required header: `Idempotency-Key: <8–100 letters/digits/underscores/hyphens>`, normally a UUID.

```json
{"freelancerId":3,"budget":"125.50"}
```

The client is taken from the selected actor, not trusted from the body. An optional `clientId` must match that actor. Budget must be greater than zero, up to two decimal places, maximum 9,999,999.99 INR. Funding calls the migrated PostgreSQL stored procedure; an audit trigger records the deduction. The server rechecks worker existence, availability and current balance inside an atomic transaction.

Response:

```json
{
  "data":{"id":161,"client_id":1,"freelancer_id":3,"budget":125.5,"status":"FUNDED","created_at":"..."},
  "balanceBefore":1000,
  "balanceAfter":874.5,
  "audit":{"id":193,"client_id":1,"amount_changed":-125.5,"action_type":"ESCROW_HOLD","balance_after":874.5,"timestamp":"..."},
  "mode":"postgres-mongo"
}
```

Reusing a successful key with the same actor and payload returns the original contract and audit entry without another deduction. A different payload/actor using that key gets 409. Retry an uncertain request with its original key; inspect contracts before starting a new funding request. Failures roll back the transaction.

## Contract status

`PATCH /contracts/:id/status` with `{ "status": "IN_PROGRESS" }` or `{ "status": "COMPLETED" }`.

Only owning client or assigned freelancer. Allowed: FUNDED → IN_PROGRESS → COMPLETED. Returns `{data:updatedContract,mode}`. No reverse transitions, reassignment, refunds or cancellation. The database unique index rejects starting a second active contract for the worker; API returns a friendly 409. The materialized earnings view is refreshed explicitly through the analytics refresh endpoint, so completion may leave the cached lifetime summary stale until refresh.

## Audit

`GET /clients/:id/audit?from=2026-10-01&to=2026-10-12&page=1&limit=10`

Client may inspect only self; admin any client; freelancer forbidden. Dates are inclusive, validated real YYYY-MM-DD dates with from ≤ to. Paginated entries have id/client_id/timestamp/action_type/amount_changed/balance_after. Stored balance-after includes history before the selected filter; the UI must not start a new running total from zero.

## Analytics

- `GET /analytics/lifetime-earnings?freelancerId=3`: selected worker summary `{data:[{freelancer_id,name,completed,total}],lastRefreshed,mode}`. Defaults to own worker for freelancer, otherwise worker 1.
- `GET /analytics/revenue?freelancerId=3`: `{data:[{date,revenue,moving_average}],measure,mode}`.
- `GET /analytics/rankings?freelancerId=3&page=1&limit=10`: paginated dense ranking across workers with revenue; freelancer sees only their own rank. `measure` explains ranking semantics. Client/admin see platform ranks. freelancerId identifies the selected context, not a client/admin ranking filter.

Freelancers cannot request another worker's analytics. Creation-date attribution; seven-calendar-day range over recorded revenue days; workers without revenue have empty series/rank and zero lifetime totals. The materialized snapshot is refreshed by `POST /analytics/lifetime-earnings/refresh`; GET does not mutate. The refresh uses PostgreSQL REFRESH MATERIALIZED VIEW CONCURRENTLY and returns its successful refresh timestamp. All demo roles may refresh derived analytics; admin remains unable to fund or change contracts.

## Nearby workers

`GET /workers/nearby?lat=17.385&lng=78.4867`: client/admin only. Both coordinates required; latitude [-90,90], longitude [-180,180]. Returns `{data:[worker fields + distance_meters + location_updated_at],mode}`.

Workers within 5000 metres, sorted nearest first, available only, one result per worker (their current ping), fresh within two hours. The default backend executes a single MongoDB `$geoNear` over current pings, then joins PostgreSQL freelancer IDs/availability. The optional SQLite fallback uses haversine distance. No implicit location is supplied; first choose a job site.

## Reviews

- `GET /reviews/analytics?freelancerId=3`: rating_distribution, top_skill_tags, average_rating (null when empty), total_reviews, scope, mode. Without ID, client/admin see whole-platform aggregation; freelancer defaults to own profile. The default backend uses MongoDB `$facet` aggregation. The optional SQLite fallback aggregates in SQL.
- `GET /reviews?freelancerId=3&page=1&limit=10`: paginated review text, rating, tags and timestamp. Freelancer can inspect only self.

The frontend always selects a worker and labels its statistics accordingly. Review submission and portfolio editing are not part of this API.

### Nearby discovery update

`GET /workers/nearby?lat=...&lng=...&page=1&limit=10` now returns **all qualifying workers through pagination**, not a fixed top 20. Response includes data, total, page, limit, totalPages, origin and radius_meters (5000). Default limit is 100; maximum 100. The frontend uses browser geolocation, displays the list before the map and requests 10 results per page. `08_client_locations.sql` adds optional seeded client coordinates for an explicitly labelled demo-origin fallback. See backend/README.md for the Hyderabad distribution and reset log.

### Current worker-location writer

`POST /workers/:id/location` accepts `{ "lat": 17.45452, "lng": 78.35008 }`. Only the selected freelancer with that ID can write; clients/admin cannot. The API validates coordinates, reads SQL availability, clears the worker's previous `is_current` flag and inserts a new ping with `is_current: true` and a fresh timestamp, so ping history is kept. A unique partial index allows one current ping per worker; if two updates for the same worker race, one gets 409 and should retry. Polling discovery reads the partial geospatial current-ping index. The two-hour TTL applies to every ping.
