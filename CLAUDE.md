# Red Alerts - project context (CLAUDE.md)

Red Alerts is a live rocket/aircraft-alert system for Israel, modeled on the
Israel Home Front Command (Pikud HaOref / Oref) alert feed. The backend polls
Oref's public alerts endpoint continuously, stores each distinct alert in a
normalized MySQL schema, and pushes new alerts to every connected browser in
real time. The whole thing is intended to feel like a national defense alert
dashboard.

This file is durable context for working in the repo - keep it accurate when the
architecture changes.

---

## Frontend (NOT migrated yet)

The React client is **not** in this repo yet. When built, it should be:

- An **interactive map of Israel** that lights up affected cities/areas as alerts
  arrive in real time.
- A **timeline** of alerts so you can scrub through what happened and when.
- A **rich query/filter UI** to slice events across the dataset - by city, by
  category (rocket fire, hostile aircraft, etc.), by time window (e.g. last 24h),
  and so on, backed by the API endpoints below.
- Visually: a serious, high-signal "Israel defense / national alert system" feel.

It will be a static build hosted in S3 and served via CloudFront (the stack
already provisions the bucket + distribution + domain).

---

## High-level architecture

Two compute sides share ONE codebase (`Server/layer/python/codebase`) and ONE
private MySQL database:

```
            Oref alerts.json (polled every 1s)
                       |
                       v
        +------------------------------+
        |  WORKER  (ECS on EC2, always  |  writes  +-------------------+
        |  on). Poll -> dedupe ->       | -------> |  MySQL (private,  |
        |  persist -> publish.          |          |  in the VPC)      |
        +---------------+--------------+          +---------+---------+
                        | publish ONCE                       ^ reads
                        v                                     |
                 AWS IoT Core  "alerts" topic        +--------+--------+
                        |  (MQTT over WSS)            |  API LAMBDA     |
                        v                             |  (FastAPI via   |
                 Browsers (subscribe)  <---- HTTPS ---|  API Gateway)   |
                        ^                             +--------+--------+
                        |                                      ^
                 CloudFront + S3 (React client)  --- /api ---->+
```

### Worker side (real-time ingest) - `Server/app/worker/worker.py`

- Runs as an **always-on ECS service** on a single cheap ARM EC2 instance
  (`t4g.nano`, BRIDGE networking) inside the database's VPC (`lib/ecs_service.ts`).
- Loop, **once per second** (`POLL_INTERVAL_SECONDS=1`): fetch Oref alerts JSON ->
  `ingest_alert(raw)` groups it into the correct event (see "Event grouping") ->
  only when something new happens (new event, or an open event gained a city) does
  `publish_alert(event)` push the current event to IoT exactly once.
- It is the **only writer** to the database. It does **NOT** run migrations (see
  "Database migrations" - that is manual).
- It also runs a **separate background geocoder thread** (`GeoResolverThread`),
  independent of the 1s poll loop so geocoding never blocks ingest/publish. It
  drains the implicit "unresolved cities" queue (cities with `coordinates IS
  NULL`) at ~1 req/sec against free OSM Nominatim - resolving each Hebrew city
  name to points and storing them on the `City` row (see "City geocoding" under
  the data model). Gated by `GEOCODER_ENABLED` (set `false` for local dev, like
  `IOT_ENABLED`); throttle via `GEOCODER_INTERVAL_SECONDS`.
- Image is built/pushed out-of-band (`make push-docker prod`) and run by tag, so
  we control rollout/rollback.

### API (Lambda) side (read-only query) - `Server/resources/lambda/api`

- A **FastAPI app** run in Lambda via Mangum, fronted by an API Gateway HTTP API,
  fronted by CloudFront (`lib/lambda_service.ts`, `lib/apigateway_service.ts`,
  `lib/cloudfront_service.ts`).
- **Read-only**: it never writes; it serves the stored events. Endpoints:
  - `GET /api/alerts?limit=&city=&category=` - recent events, optional filter by
    city (name or UUID) or category (code or UUID).
  - `GET /api/alerts/last-24h?limit=` - every event from the last 24 hours.
  - health route under `routes/health.py`.
- The DB connection (SQLAlchemy engine) is created at module scope and reused
  across warm invocations so we don't exhaust DB connections.

### Why IoT, and how the connection works

The map needs **instant push** when an alert fires - polling the API from every
browser would be slow and hammer the backend. So:

- **Why:** AWS IoT Core gives us a managed pub/sub broker. The worker publishes
  each new alert **once** to a single broadcast topic (`alerts`); all subscribed
  browsers receive it simultaneously. It is a broadcast, not personalized.
- **Worker -> IoT (publish):** `codebase/iot/publish.py` resolves the account's
  IoT data endpoint and calls `publish(topic="alerts", qos=1, payload=event)`.
  The worker's ECS task role grants `iot:Publish` on that topic
  (`lib/iam_service.ts`). Set `IOT_ENABLED=false` to skip publishing locally.
- **Browser -> IoT (subscribe):** browsers have no AWS credentials, so they get
  **temporary** ones from a **Cognito unauthenticated identity pool**
  (`lib/cognito_service.ts`) and connect with **MQTT over WebSocket Secure
  (WSS), signed with SigV4**. The Cognito unauth role is granted only
  `iot:Connect` / `iot:Subscribe` / `iot:Receive` on the `alerts` topic and is
  explicitly **denied `iot:Publish`** (`lib/iot_service.ts`). Topics are implicit
  in IoT Core, so authorization is expressed as IAM statements, not an IoT policy.

### Shared code layers

- `Server/layer/python/codebase` - the shared business code (models, controllers,
  DB engine, Oref client, IoT publish). The API Lambda gets it as a Lambda layer
  ("backend-code-layer"); the worker `COPY`s the same folder into its image.
- `Server/resources/dependencies_layers/common-layer/requirements.txt` - the
  third-party Python deps bundled as the Lambda "common-layer". The worker has its
  own `Server/app/worker/requirements.txt`.

---

## Data model - `Server/layer/python/codebase/models` (see `models/SCHEMA.md`)

Normalized, with **our own UUID (`CHAR(36)`) primary keys** everywhere - we never
use an id received from Oref as a primary key.

- **`Event`** (`events`) - one row per **logical episode** (NOT per raw Oref id).
  Holds `oref_id` (the id that opened it), `received_at` (episode start),
  `last_seen_at` (last update - drives grouping), and FKs `category_id`,
  `title_id`, `description_id`. Linked to many cities via `event_cities`.
- **`EventOrefId`** (`event_oref_ids`) - every raw Oref id absorbed into an event;
  the `oref_id` PK guarantees each poll is processed exactly once.
- **`City`** (`cities`) - unique city name (so we can query "all events for city
  X"), plus a nullable `coordinates` JSON column holding geocoded points (see
  "City geocoding").
- **`Category`** (`categories`) - unique Oref category `code` (+ optional label).
- **`Title`** (`titles`) - the alert title text, stored once. Unique key is a
  sha-256 `content_hash` of the text (avoids a long-text index).
- **`Description`** (`descriptions`) - the long instruction text, stored once,
  also keyed by `content_hash`.
- **`event_cities`** - many-to-many join (composite PK `event_id`+`city_id`,
  `ON DELETE CASCADE`).

Each model is **Active-Record-style**: `get_or_create()` (idempotent lookups),
query helpers (`recent`, `by_city`, `by_category`, `in_last_hours`), and
`to_dict()`. Controllers in `codebase/controllers` wrap these for the API and
worker.

### Event grouping (`Event.ingest`)

Oref re-issues the **same episode** with a new `id` every few seconds (adding/
removing cities), so the id is useless for dedupe. `Event.ingest` groups alerts
into episodes instead:

- An event is **open** if it is the most recent event of its category whose
  `last_seen_at` is within `EVENT_MERGE_WINDOW_SECONDS` (default `120`) of now.
- Same id seen again -> no-op (`event_oref_ids` PK). No open event -> **new event**
  (`created`). Open event + a new city -> **append** it, slide `last_seen_at`
  (`updated`). Open event + only repeats/removed cities -> cities are **kept**,
  nothing emitted (`unchanged`). Same category after the window lapsed -> **new
  event** (the time gap separates two same-category episodes).
- Trade-off: two distinct same-category episodes overlapping within the window
  merge into one. Tune the window env var. Full rules table in `models/SCHEMA.md`.

To wipe all data (keep schema/migration): `resources/sql/reset_database.sql`.

### City geocoding (`coordinates` + the geocoder thread)

Cities are stored by NAME only; coordinates are resolved lazily and for free via
OSM **Nominatim** (`codebase/geo/nominatim.py`, Hebrew-aware). The single
nullable `City.coordinates` JSON column **is the queue** and encodes the whole
state - no status column:

- `NULL` -> never looked up = enqueued (a new city inserts with NULL).
- `[]` -> looked up, no match -> won't retry, renders nothing.
- one point `[[lng,lat]]` -> a map **marker** (tiny locality).
- many points `[[lng,lat], ...]` -> polygon ring -> a map **area**.
- transient lookup error -> left `NULL` so a later pass retries it.

`controllers/geocoding_controller.py` drains it: `resolve_next_unresolved()`
picks the oldest `coordinates IS NULL` city, re-checks it still lacks points,
calls Nominatim (~1 req/sec, throttled by the worker thread), and stores the
result. `resolve_unresolved_batch()` is the reusable seam for a future bulk
import. The worker runs this on a **separate thread** (see "Worker side"); the
API never blocks - it just inserts cities (auto-enqueued) and serves whatever is
resolved.

`Event.to_dict()` carries a distinct per-city `coordinates: [{id, name, points}]`
array (cities are already deduped), so each event's points reach the client over
both the API and the IoT broadcast. The frontend draws a marker for a single
point and a filled area for many (`Client/src/lib/geo`, `components/map`).

---

## Database schema sync - MANUAL, never automatic

There are **no migration files**. The models in
`Server/layer/python/codebase/models` are the single source of truth, and
`sync_database()` (`models/sync.py`) makes the DB match them - the Sequelize
`sync({ alter: true })` equivalent. It diffs `Base.metadata` against the live
schema (reusing Alembic's autogenerate engine in memory) and applies the
difference in place: create tables, add columns, add/drop indexes/constraints.

The whole workflow is one step:

```
make sync prod local      # diff models -> DB, apply (through the SSM tunnel)
```

**This is the only way the schema changes** - the worker does NOT sync on
deploy/boot. Run it yourself after editing a model.

Caveats (same shape as Sequelize `alter:true`):

- **Additive by default**: it creates/alters but never DROPs a table/column you
  removed from the models (the drop is logged + skipped). Use
  `sync_database(allow_drops=True)` for the destructive variant.
- **Renames = drop + add** (potential data loss) - do those by hand.
- New `NOT NULL` columns need a default (or `nullable=True`) or they fail on
  existing rows. Needs DDL privileges (`CREATE`/`ALTER`/`INDEX`).
- Wipe all data but keep the schema: `Server/resources/sql/reset_database.sql`.

---

## Pushing a new version (nothing is automatic / CI-driven yet)

Everything is driven from `Server/` via the Makefile. **Currently prod-only**: the
deploy + sync targets are gated so you can't accidentally touch dev/qa (see the
"TEMPORARY: production-only" block in the `Makefile`; uncomment two `$(error ...)`
lines to re-enable dev/qa). You ship the three pieces independently, in this order
when they change:

1. **Worker image (Docker -> ECR):**
   ```
   make push-docker prod
   ```
   Builds the ARM64 image and pushes both the git-sha tag and `latest` to ECR
   (keeps the last 5 images).

2. **Infrastructure + worker rollout (CDK):**
   ```
   make deploy prod         # cdk deploy (always targets the CLOUD database)
   # or, image + deploy in one shot referencing that exact tag:
   make release prod        # = push-docker then deploy
   ```
   The CDK stack pins the worker to the just-pushed image tag, so deploying rolls
   ECS forward to the new build. Account-specific secrets (DB URL, cert ARN, VPC,
   domain, optional `WAF_WEB_ACL_ARN`) are passed as CDK context at deploy time, never committed
   (`bin/red-alerts.ts`, `constants.ts`).

3. **Database schema (manual, when models changed):**
   ```
   make sync prod local     # alembic upgrade head, via the SSM tunnel
   ```
   Do this deliberately - it is decoupled from deploy on purpose.

4. **Frontend (once it exists):** build the React app, `aws s3 sync` to the client
   bucket, then invalidate the CloudFront distribution. (Stack outputs print the
   bucket name + distribution id.)

First-time only: `make bootstrap prod` (one-time CDK bootstrap per account/region).

---

## Local development

```
make setup                 # build .venv + install deps
make serve dev local       # run worker + API locally against the LOCAL (tunnel) DB
make serve dev             # ... against the cloud dev DB
make serve dev ONLY=api    # only the API   (ONLY=worker for only the poller)
```

DB selection is explicit: add the word `local` after the env to use that env's
LOCAL db (`DATABASE_URL_LOCAL`, typically an SSM tunnel on `localhost:3307`);
without it you get the cloud db (`DATABASE_URL_CLOUD`). It depends ONLY on the
`local` keyword, never on which URL variables happen to be set. Per-env config
lives in gitignored `Server/.env.<env>` files (and GitHub secrets/vars in CI).

Run `make` (or `make help`) in `Server/` for the full target list.
