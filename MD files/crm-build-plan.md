# CRM module — technical build plan

**Status:** draft for technical review
**Date:** 3 August 2026
**Companion doc:** `crm-module-requirements-review.md` (functional requirements and roadmap)

---

## 0. Assumptions and unknowns

This plan is deliberately stack-agnostic in places. Three unknowns change specific
recommendations, and section 10 lists them as decisions to close before writing code:

1. **Language, framework and ORM** — determines the migration tooling, DI patterns, and job runner
2. **Database engine** — DDL below is PostgreSQL-flavoured; notes mark what changes on SQL Server
3. **Single-dealer install vs multi-tenant SaaS** — this is the one that is genuinely expensive to retrofit

Everything in sections 2 through 7 holds regardless.

---

## 1. Guiding constraints

Three constraints from the requirements work that should govern every technical decision:

**The serial number is the spine.** Not the contact record. If the schema does not make the
asset the centre of gravity, nothing else in the module works properly.

**Ten seconds to log a call on a phone.** This is a hard performance budget, not an
aspiration. It rules out chatty APIs, request-path syncs, and required-field creep. It
implies purpose-built read models for the rep-facing surfaces.

**Every new lead source must be additive.** The stated goal is a platform for future
additions. That means lead generation is a plugin point, not a series of hard-coded
features. Section 5 is the design for this and is the most important part of this document.

---

## 2. Architectural decisions

### 2.1 Modular monolith, not microservices

Seven modules sharing a single asset master, with cross-module workflows that must be
transactionally coherent (a won deal creates a make-ready work order, a haul job, a warranty
registration and a PM schedule). Distributed transactions across seven services to achieve
that is a self-inflicted wound.

**Decision:** one deployable application, one database, hard module boundaries enforced in
code. Each module exposes a narrow public interface; everything else is internal. Extract a
service later only if a specific module develops genuinely independent scaling needs.

Enforce boundaries mechanically rather than by convention — dependency-cruiser, ArchUnit,
.NET internals, ESLint import rules, whatever the stack offers. Boundaries that rely on
discipline do not survive deadline pressure.

### 2.2 The asset master is a shared kernel — CRM does not own it

The most important structural decision in this document.

A machine's life spans modules: it arrives as inventory, gets sold, gets serviced in the
shop, gets hauled, goes on rent, gets traded back, gets resold. Competitive units we never
owned also need records so reps can canvass them.

**Decision:** one `asset` table in a shared `equipment` context, referenced by every module.
Ownership and status are attributes, not separate tables per lifecycle stage.

CRM does **not** get its own machine table. It gets a satellite record holding sales-context
only — competitive flag, canvassing notes, trade cycle state — keyed to `asset_id`.

The failure mode this avoids: CRM builds a "customer equipment" table, service builds an
"equipment serviced" table, rental builds a "fleet unit" table, and within a year nobody can
answer "how many excavators are in this territory" without a reconciliation script.

### 2.3 Cross-module integration is event-driven, with an outbox

Direct service-to-service calls across seven modules produce a dependency graph nobody can
reason about. Events keep the coupling one-directional.

**Decision:** domain events written to an `outbox_event` table in the same transaction as the
state change, then dispatched by a background worker. Guarantees at-least-once delivery
without a message broker; add a broker later behind the same interface if throughput demands
it.

Handlers must be idempotent. Assume every event will be delivered twice at some point,
because it will.

Core events the CRM subscribes to:

| Event | Emitted by | CRM reaction |
|---|---|---|
| `WorkOrderLineDeclined` | shop, field | Candidate signal — declined work |
| `WorkOrderClosed` | shop, field | Update asset service spend; evaluate triggers |
| `MeterReadingRecorded` | shop, field, telematics | Evaluate trade cycle thresholds |
| `AssetOwnershipChanged` | sales, rental | Recalculate population; reset trade clock |
| `RentalAccrualUpdated` | rental | Candidate signal — RPO conversion |
| `PartsRequestUnfilled` | parts | Candidate signal — lost sale |
| `ContractApproachingExpiry` | contracts | Candidate signal — renewal |
| `TelematicsFaultRaised` | integrations | Candidate signal — service opportunity |

Events the CRM emits:

| Event | Consumed by |
|---|---|
| `OpportunityWon` | sales, shop (make-ready), transportation (haul), contracts (PM schedule) |
| `QuoteAccepted` | sales |
| `AppraisalRequested` | shop (recon estimate) |

### 2.4 Metadata-driven customisation, built early

This is what makes Salesforce extensible and what ERP vendors consistently skip. Retrofitting
it is brutal because every query, form and report has to be rewritten.

**Decision:** a `field_definition` table plus a `custom_fields jsonb` column on the major
entities. Not full EAV — that destroys query performance and readability. JSONB with a GIN
index gets most of the value at a fraction of the complexity.

```sql
create table field_definition (
  id              uuid primary key,
  entity_type     text not null,          -- 'opportunity' | 'account' | 'asset' | ...
  field_key       text not null,          -- snake_case, immutable once created
  label           text not null,
  data_type       text not null,          -- text|number|date|bool|select|multiselect|lookup
  options         jsonb,                  -- for select types
  lookup_entity   text,                   -- for lookup types
  is_required     boolean not null default false,
  validation      jsonb,
  display_order   int not null default 0,
  created_at      timestamptz not null default now(),
  archived_at     timestamptz,
  unique (entity_type, field_key)
);
```

Validate writes against the definitions in the application layer. Index specific hot custom
fields with expression indexes as they emerge; do not try to index everything up front.

On SQL Server, use `nvarchar(max)` with `JSON_VALUE` computed columns and index those.

### 2.5 Record-level security is a first-class concern

Equipment dealers are multi-branch, often multi-franchise, and territory-based visibility is
a real requirement, not a nice-to-have. Bolting this on later means auditing every query in
the codebase.

**Decision:** an access-scope resolver in the data access layer from day one. Every list
query goes through it. Model dimensions: branch, territory, franchise/OEM, team, ownership,
explicit share.

Consider PostgreSQL row-level security as a defence-in-depth backstop, but do not rely on it
as the only mechanism — it is hard to debug and hard to make performant on complex predicates.

### 2.6 Read models for rep-facing surfaces

The ten-second budget will not survive an ORM assembling a rep's work queue from eight joined
tables with security predicates layered on. The work queue, pipeline board and asset timeline
are read-heavy, latency-critical, and tolerate a few seconds of staleness.

**Decision:** materialised views or denormalised projection tables for these three surfaces,
refreshed on the relevant events. Keep writes going to the normalised tables.

Do not do this everywhere. Three surfaces, driven by measured need.

---

## 3. Workspace structure

Monorepo, one folder per bounded context. Adjust naming to stack idiom — the shape is what
matters.

```
/
├── .vscode/
│   ├── settings.json           # formatter, import rules, SQL dialect
│   ├── extensions.json         # recommended extension set
│   ├── launch.json             # api, worker, tests, attach-to-debug
│   └── tasks.json              # migrate, seed, lint, test, generate
├── .devcontainer/
│   └── devcontainer.json       # db + cache + mail catcher, pinned versions
├── docs/
│   ├── crm-module-requirements-review.md
│   ├── crm-build-plan.md
│   ├── adr/                    # architecture decision records, numbered
│   └── events.md               # event catalogue, treated as an API contract
├── migrations/
├── src/
│   ├── platform/               # cross-cutting, no domain knowledge
│   │   ├── auth/
│   │   ├── access-scope/       # §2.5 resolver
│   │   ├── metadata/           # §2.4 custom fields engine
│   │   ├── automation/         # rule engine
│   │   ├── events/             # outbox, dispatcher, bus interface
│   │   ├── jobs/               # scheduler, queue, retry
│   │   ├── audit/              # field history
│   │   └── integrations/
│   │       ├── mail/
│   │       │   ├── contracts/  # provider-agnostic interfaces
│   │       │   ├── graph/      # Microsoft 365 adapter
│   │       │   ├── gmail/      # Google Workspace adapter
│   │       │   ├── sync/       # delta sync workers
│   │       │   ├── matching/   # email → CRM record resolution
│   │       │   └── tracking/   # pixel + link rewrite
│   │       └── telematics/
│   ├── equipment/              # asset master — shared kernel (§2.2)
│   ├── crm/
│   │   ├── domain/             # entities, value objects, no I/O
│   │   ├── application/        # use cases, transaction boundaries
│   │   ├── sources/            # opportunity source rules (§5)
│   │   ├── infrastructure/     # repositories, projections
│   │   └── api/                # controllers, DTOs, validation
│   ├── sales/
│   ├── service-shop/
│   ├── service-field/
│   ├── rental/
│   ├── parts/
│   ├── transportation/
│   └── contracts/              # PM, warranty, FML, RPO
└── tests/
    ├── unit/
    ├── integration/            # real database, no mocks
    └── architecture/           # boundary enforcement (§2.1)
```

**VS Code specifics worth setting up on day one:**

- A `.code-workspace` file with multi-root folders so module boundaries are visible in the explorer
- Launch configs for API and worker as separate processes — the outbox dispatcher must be debuggable independently
- A devcontainer with pinned database version, so "works on my machine" stops being a category of bug
- `tasks.json` entries for migrate / seed / test, so nobody needs to remember CLI incantations
- An `adr/` folder used properly. Every decision in section 2 becomes an ADR. When someone asks in eight months why the asset table lives where it does, the answer is written down.

---

## 4. Core schema

PostgreSQL dialect. Only the tables where the design decision actually matters — the routine
ones follow obvious patterns.

### 4.1 The asset spine

```sql
create table asset (
  id                  uuid primary key,
  serial_number       text not null,
  make                text not null,
  model               text not null,
  model_year          int,
  product_family      text not null,
  category            text not null,         -- 'construction' | 'material_handling' | ...
  sold_by             text not null,         -- 'us' | 'competitor' | 'unknown'
  origin_deal_id      uuid,                  -- null for competitive units
  status              text not null,         -- 'inventory'|'sold'|'rental_fleet'|'on_rent'
                                             -- |'traded_in'|'wholesaled'|'scrapped'
  current_owner_id    uuid references account(id),
  current_site_id     uuid references site(id),
  branch_id           uuid not null references branch(id),
  franchise_id        uuid references franchise(id),
  warranty_end_date   date,
  finance_maturity    date,
  acquired_at         date,
  custom_fields       jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index asset_serial_make_uq on asset (upper(serial_number), upper(make));
create index asset_owner_idx  on asset (current_owner_id) where current_owner_id is not null;
create index asset_family_idx on asset (product_family, category);
create index asset_custom_idx on asset using gin (custom_fields);
```

Serial numbers are not globally unique across manufacturers, hence the composite unique
index. Case-insensitive because data entry will not be consistent.

### 4.2 Ownership as history, not state

```sql
create table asset_ownership (
  id            uuid primary key,
  asset_id      uuid not null references asset(id),
  account_id    uuid references account(id),   -- null when we hold it
  holding_type  text not null,                 -- 'dealer_stock'|'customer_owned'
                                               -- |'rental_fleet'|'customer_rented'|'wholesaled'
  site_id       uuid references site(id),
  effective_from date not null,
  effective_to   date,
  source_deal_id uuid,
  notes          text,
  created_at     timestamptz not null default now()
);

create index asset_ownership_asset_idx on asset_ownership (asset_id, effective_from desc);
create unique index asset_ownership_current_uq
  on asset_ownership (asset_id) where effective_to is null;
```

`asset.current_owner_id` is a denormalised convenience for query performance, maintained by
the application when a new ownership row is written. The history table is the source of truth.
Population reporting, share-of-park and trade cycle all read history.

### 4.3 Meter readings as a series

```sql
create table asset_meter_reading (
  id            bigserial primary key,
  asset_id      uuid not null references asset(id),
  reading_value numeric(12,1) not null,
  unit          text not null,                 -- 'hours' | 'miles' | 'km' | 'cycles'
  read_at       timestamptz not null,
  source        text not null,                 -- 'technician'|'telematics'|'self_reported'
                                               -- |'inspection'|'estimated'
  source_ref    text,
  is_rollover   boolean not null default false,
  is_suspect    boolean not null default false,
  created_at    timestamptz not null default now()
);

create index asset_meter_idx on asset_meter_reading (asset_id, read_at desc);
```

Never a single `hours` column on `asset`. Trade cycle prediction needs the trend, not the
current value.

`is_suspect` matters more than it looks: technicians fat-finger readings, meters get replaced,
and telematics units get swapped between machines. A single bad reading of 90,000 hours will
generate a spurious replacement opportunity and destroy rep trust in the queue. Flag readings
that imply an impossible rate of change and exclude them from trigger evaluation.

### 4.4 Asset relationships — batteries, chargers, attachments

```sql
create table asset_relationship (
  id             uuid primary key,
  parent_asset_id uuid not null references asset(id),
  child_asset_id  uuid not null references asset(id),
  relationship    text not null,   -- 'battery'|'charger'|'attachment'|'component'
  effective_from  date not null,
  effective_to    date,
  check (parent_asset_id <> child_asset_id)
);

create index asset_rel_parent_idx on asset_relationship (parent_asset_id) where effective_to is null;
create index asset_rel_child_idx  on asset_relationship (child_asset_id)  where effective_to is null;
```

Time-bounded because batteries move between trucks. This structure is what makes battery
replacement a forecastable pipeline instead of a buried parts line.

### 4.5 Opportunity

```sql
create table opportunity (
  id                uuid primary key,
  reference         text not null unique,
  account_id        uuid not null references account(id),
  primary_contact_id uuid references contact(id),
  asset_id          uuid references asset(id),        -- the machine in question, if any
  pipeline_id       uuid not null references pipeline(id),
  stage_id          uuid not null references pipeline_stage(id),
  owner_user_id     uuid not null references app_user(id),
  branch_id         uuid not null references branch(id),
  revenue_type      text not null,   -- 'whole_goods'|'rental'|'service'|'parts'|'contract'|'training'
  amount            numeric(14,2),
  currency          char(3) not null,
  estimated_margin  numeric(14,2),
  probability       int,
  expected_close    date,
  source_signal_id  uuid references opportunity_signal(id),
  origin            text not null,   -- 'manual'|'signal'|'inbound'|'oem_lead'|'campaign'
  status            text not null,   -- 'open'|'won'|'lost'|'abandoned'
  outcome_reason    text,
  next_activity_at  timestamptz,     -- drives the rotting mechanic, §6.2
  closed_at         timestamptz,
  custom_fields     jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index opp_owner_open_idx on opportunity (owner_user_id, status)
  where status = 'open';
create index opp_asset_idx on opportunity (asset_id) where asset_id is not null;
create index opp_rotting_idx on opportunity (next_activity_at)
  where status = 'open';
```

`asset_id` on the opportunity is what makes this a dealer CRM rather than a generic one. Most
opportunities are about a specific machine.

---

## 5. The opportunity source engine

The centrepiece. This is what turns "a CRM with some lead features" into a platform where
adding a new lead source is a class and a registration rather than a schema migration and a
new screen.

### 5.1 The pattern

Every lead generator — declined work, trade cycle thresholds, RPO accrual, contract renewals,
telematics faults, parts lost sales, battery age, training expiry — reduces to the same shape:

> Something observable in the data suggests a machine or account is worth a conversation, with
> an estimated value and a reason.

So: sources emit **signals** into a common table. Signals are triaged into opportunities.
Adding a source never touches the triage UI, the routing logic, or the reporting.

```sql
create table opportunity_signal (
  id              uuid primary key,
  source_key      text not null,      -- 'declined_work'|'trade_cycle'|'rpo_conversion'
                                      -- |'contract_renewal'|'telematics_fault'
                                      -- |'parts_lost_sale'|'battery_age'|'training_expiry'
  dedup_key       text not null,      -- source-defined; see §5.3
  asset_id        uuid references asset(id),
  account_id      uuid references account(id),
  branch_id       uuid not null references branch(id),
  suggested_owner_id uuid references app_user(id),
  estimated_value numeric(14,2),
  currency        char(3) not null,
  reason_code     text not null,
  reason_detail   text,
  evidence        jsonb not null,     -- work order line ids, meter readings, accrual figures
  confidence      numeric(3,2) not null,   -- 0.00–1.00
  priority_score  numeric(10,2),      -- computed; drives queue ordering
  detected_at     timestamptz not null default now(),
  expires_at      timestamptz,
  status          text not null default 'new',
                  -- 'new'|'promoted'|'dismissed'|'expired'|'superseded'
  dismissed_reason text,
  actioned_by     uuid references app_user(id),
  actioned_at     timestamptz,
  opportunity_id  uuid references opportunity(id),
  created_at      timestamptz not null default now()
);

create unique index opp_signal_dedup_uq
  on opportunity_signal (source_key, dedup_key)
  where status in ('new', 'promoted');

create index opp_signal_queue_idx
  on opportunity_signal (branch_id, suggested_owner_id, priority_score desc)
  where status = 'new';
```

### 5.2 Source rule interface

Pseudocode — translate to the chosen stack.

```
interface OpportunitySourceRule {
  key: string
  displayName: string
  trigger: 'event' | 'schedule'
  subscribesTo?: EventType[]
  schedule?: CronExpression

  evaluate(context): AsyncIterable<SignalCandidate>
}

interface SignalCandidate {
  dedupKey: string
  assetId?: string
  accountId: string
  estimatedValue?: Money
  reasonCode: string
  reasonDetail?: string
  evidence: Record<string, unknown>
  confidence: number
  expiresAt?: Date
}
```

Registration is a list. Adding the battery-age source is one file plus one line.

Configuration lives in the database, not in code — thresholds, whether a source is enabled per
branch, minimum value floors. Dealers will want to tune these without a deploy.

```sql
create table source_rule_config (
  id           uuid primary key,
  source_key   text not null,
  branch_id    uuid references branch(id),   -- null = global default
  is_enabled   boolean not null default true,
  parameters   jsonb not null default '{}',  -- thresholds, floors, windows
  unique (source_key, branch_id)
);
```

### 5.3 Deduplication

The mechanism that keeps the queue trustworthy. Get this wrong and a rep opens the queue to
find forty entries for the same excavator.

Dedup key conventions per source:

| Source | Dedup key |
|---|---|
| Declined work | `work_order_line:{id}` — one signal per declined line |
| Trade cycle | `asset:{id}:threshold:{threshold_key}` — re-fires only on a new threshold |
| RPO conversion | `rental_agreement:{id}` |
| Contract renewal | `contract:{id}:cycle:{expiry_year}` |
| Telematics fault | `asset:{id}:fault:{code}:{window_start}` — windowed, not per occurrence |
| Parts lost sale | `account:{id}:part:{number}:{iso_week}` — weekly aggregation |
| Battery age | `asset:{id}:battery:{child_asset_id}` |
| Training expiry | `account:{id}:cert_cycle:{expiry_year}` |

Note the windowing on telematics and parts. Raw events are far too noisy to become signals
one-to-one. Aggregate before emitting.

### 5.4 Priority scoring

Reps will not work a queue ordered by date. Score it.

```
priority = (estimated_value_normalised × w1)
         + (confidence × w2)
         + (account_relationship_strength × w3)
         + (recency_decay × w4)
         + (source_weight × w5)
```

Keep the weights in `source_rule_config` and expect to tune them for six months. Log the
score components on the signal so the ordering is explainable when a sales manager challenges
it — and they will.

### 5.5 Phase 1 sources

Build these three first:

1. **`declined_work`** — event-driven on `WorkOrderLineDeclined`. Highest ROI, simplest logic, value already known from the estimate.
2. **`contract_renewal`** — scheduled daily. PM, extended warranty, FML approaching expiry.
3. **`tech_lead`** — manual, technician-initiated from the mobile work order. Not a rule, but it writes to the same signal table so it inherits triage, routing and reporting for free.

That last point is the payoff of the design: the manual path and the automated paths converge
on one queue.

---

## 6. What to emulate, concretely

### 6.1 From Salesforce

| Feature | What to copy | What to skip |
|---|---|---|
| Metadata layer | Custom fields and objects as data, not migrations (§2.4) | Full EAV; a metadata-driven UI renderer for everything |
| Sharing model | Role hierarchy, territory-based visibility, explicit shares (§2.5) | The full criteria-based sharing rule engine |
| Field history | Per-field audit on configurable fields | Auditing everything by default — it will dwarf the transactional data |
| Flow | A declarative trigger→condition→action engine | A visual builder in v1. Ship YAML or JSON rules first, build the canvas later |
| Approvals | Multi-step approval on discount and over-allowance | Generic approvals on everything |

The lesson from Salesforce is not any single feature — it is that **configuration beats code
for the things dealers vary on**. Discount thresholds, stage definitions, required fields,
trigger parameters. Every one of those in the database.

### 6.2 From Pipedrive

The single best idea in Pipedrive is **rotting deals**, and it costs almost nothing to build.

Every open opportunity must have a scheduled next activity. If `next_activity_at` is null or
in the past beyond a per-stage tolerance, the deal is visibly rotting on the board. That one
mechanic does more for pipeline hygiene than any amount of reporting.

```sql
create table pipeline_stage (
  id              uuid primary key,
  pipeline_id     uuid not null references pipeline(id),
  name            text not null,
  display_order   int not null,
  probability     int,
  rot_after_days  int,             -- the Pipedrive mechanic
  required_fields jsonb not null default '[]',
  entry_criteria  jsonb,           -- stage-gating
  is_won          boolean not null default false,
  is_lost         boolean not null default false
);
```

Also worth copying: minimal required fields on create, and the pipeline board as the primary
interface rather than a list view. Speed is a feature. Pipedrive wins deals against
Salesforce on nothing but responsiveness and low friction.

What to skip: their reporting depth is thin, and their data model is too flat for our needs.

### 6.3 From Dynamics 365

Two things.

**Sales Accelerator — the prioritised work queue.** A rep opens the system and sees a single
ordered list of what to do next, not a search screen. This is exactly what section 5 produces,
and it is the correct primary surface for the declined-work pipeline. Build the queue as the
CRM home screen for reps.

**Business Process Flows — stage-gated guided process as configuration.** Each stage declares
required fields and required completed activities before advancement. Already provisioned for
in `pipeline_stage.entry_criteria` and `required_fields`.

Also worth studying: their relationship-health scoring derived from actual email traffic. Do
not build it in phase 1, but the email sync in section 7 is the prerequisite, so keep the data
shape in mind.

What to skip: the configuration surface area. Dynamics is enormously configurable and
correspondingly hard to implement. Pick the two mechanics above.

---

## 7. Email integration architecture

Requested explicitly, and the design deserves care because it is the feature most likely to
determine adoption. Reps live in their mail client.

### 7.1 Scope

Three capabilities, in build order:

1. **Sync and display** — messages related to a CRM record visible on that record's timeline
2. **Send from the ERP** — compose and reply from within the CRM, appearing in the user's own Sent folder and threading correctly
3. **Tracking** — opens and clicks, with the caveats in §7.6

### 7.2 Provider abstraction

Write the interface once, implement twice. Never let Graph or Gmail types leak past the
adapter — the moment a `Message` object from either SDK appears in domain code, the second
provider becomes a rewrite.

```
interface MailProvider {
  authorizeUrl(state): string
  exchangeCode(code): Promise<TokenSet>
  refresh(tokens): Promise<TokenSet>

  listDelta(account, cursor): Promise<{ messages: MailMessage[], cursor: string }>
  getMessage(account, providerId): Promise<MailMessage>
  send(account, draft): Promise<{ providerId, threadId, internetMessageId }>
  createReply(account, providerId, body): Promise<{ providerId, threadId }>

  startWatch(account, callbackUrl): Promise<WatchSubscription>
  renewWatch(account, subscription): Promise<WatchSubscription>
  stopWatch(account, subscription): Promise<void>
}
```

`MailMessage` is our own normalised type: internet message id, thread id, participants,
subject, body (html and text), sent/received timestamps, direction, attachment metadata.

### 7.3 Microsoft 365 specifics

- **Auth:** OAuth 2.0 authorization code flow with PKCE via MSAL. Scopes: `Mail.Read` or `Mail.ReadWrite`, `Mail.Send`, `offline_access`, `User.Read`. Calendar later adds `Calendars.ReadWrite`.
- **Sync:** delta query on the mail folder (`/me/mailFolders/inbox/messages/delta`), persisting the delta token as the cursor. Delta gives you creates, updates and deletes without polling everything.
- **Push:** change notification subscriptions to a webhook endpoint. Subscription lifetime for mail resources is short — roughly three days — so a renewal job is mandatory, not optional. **Verify the current maximum expiry against Microsoft's docs; this limit has changed before.** Validate the `clientState` on every notification.
- **Send:** `POST /me/sendMail`, or `createReply` then `send` to thread correctly.
- **Admin consent:** tenant-wide deployment needs admin consent. Expect this to be a procurement conversation at every customer, and build the consent flow into onboarding rather than treating it as support's problem.
- **Throttling:** expect HTTP 429 with `Retry-After`. Honour it. Graph throttles per-mailbox and per-app.

### 7.4 Google Workspace specifics

- **Auth:** OAuth 2.0 with offline access for refresh tokens. Scopes: `gmail.readonly` or `gmail.modify` for sync, `gmail.send` for sending, `gmail.settings.basic` if you need signature access.
- **Sync:** `users.history.list` against a stored `historyId` cursor. Full sync only on first connect or when the history id expires.
- **Push:** `users.watch()` publishing to a Cloud Pub/Sub topic, which forwards to your endpoint. **The watch expires in seven days and must be renewed.** No renewal job means silent sync failure — build monitoring that alerts on a stale cursor, not just on errors.
- **Send:** `users.messages.send` with a base64url-encoded RFC 2822 message. Set `threadId` and the `In-Reply-To` and `References` headers to thread correctly.

**The gate that surprises people:** Google classifies Gmail read scopes as *restricted*, which
requires passing an independent CASA security assessment before production verification, with
annual re-assessment and real cost. This is a months-long process, not a form.

**Plan for it in phase 2, not the week before launch.** If the timeline is tight, ship
Microsoft 365 first — its consent model is far less gated — and treat Google as a follow-on.
Verify current Google policy directly; their scope classifications and verification
requirements change, and I may be describing a superseded process.

### 7.5 Matching emails to records

Resolution order, first match wins:

1. **Explicit reference** — a token in a BCC dropbox address (`crm+{opportunity_ref}@ourdomain`) or a tracked reply address. Most reliable. Worth building.
2. **Thread continuity** — the thread id already maps to a record from a prior message.
3. **Participant match** — sender or recipient address matches a contact. Ambiguous when a contact relates to several open opportunities: attach to the account timeline and let the rep assign, rather than guessing.
4. **Domain match** — sender domain matches an account, no known contact. Creates a suggested contact rather than an automatic link.

Never silently attach on a weak match. Wrong attachments erode trust faster than missing ones,
and reps who stop trusting the timeline stop using it.

```sql
create table email_account (
  id                uuid primary key,
  user_id           uuid not null references app_user(id),
  provider          text not null,          -- 'microsoft' | 'google'
  email_address     text not null,
  external_id       text not null,
  tokens_encrypted  bytea not null,         -- envelope-encrypted, see §7.7
  key_version       int not null,
  sync_cursor       text,
  watch_subscription_id text,
  watch_expires_at  timestamptz,
  last_synced_at    timestamptz,
  sync_status       text not null default 'pending',
  sync_error        text,
  share_default     text not null default 'private',  -- 'private' | 'team'
  created_at        timestamptz not null default now(),
  unique (user_id, provider, email_address)
);

create table email_message (
  id                  uuid primary key,
  email_account_id    uuid not null references email_account(id),
  provider_message_id text not null,
  internet_message_id text,
  thread_id           text,
  direction           text not null,        -- 'inbound' | 'outbound'
  subject             text,
  from_address        text not null,
  to_addresses        text[] not null default '{}',
  cc_addresses        text[] not null default '{}',
  body_html           text,
  body_text           text,
  has_attachments     boolean not null default false,
  sent_at             timestamptz,
  received_at         timestamptz,
  visibility          text not null default 'private',
  is_personal         boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (email_account_id, provider_message_id)
);

create index email_thread_idx on email_message (thread_id) where thread_id is not null;

create table email_link (
  id            uuid primary key,
  message_id    uuid not null references email_message(id) on delete cascade,
  entity_type   text not null,     -- 'account'|'contact'|'opportunity'|'asset'|'work_order'
  entity_id     uuid not null,
  match_method  text not null,     -- 'explicit'|'thread'|'participant'|'domain'|'manual'
  confidence    numeric(3,2) not null,
  created_at    timestamptz not null default now(),
  unique (message_id, entity_type, entity_id)
);

create index email_link_entity_idx on email_link (entity_type, entity_id);
```

**Privacy is not optional here.** Syncing a rep's mailbox means ingesting their personal
correspondence. Default `visibility` to private, give users a way to mark threads personal and
exclude them, and never surface a mailbox's contents to a manager without an explicit,
auditable sharing decision. In several jurisdictions this is a legal requirement rather than a
courtesy, and it warrants a conversation with counsel before launch rather than after.

### 7.6 Tracking — and an honest assessment

Mechanically straightforward:

- **Opens:** a 1×1 transparent image with a signed token, served by a tracking endpoint that records the fetch
- **Clicks:** rewrite outbound links through a redirect endpoint carrying the same token

```sql
create table email_tracking_event (
  id            bigserial primary key,
  message_id    uuid not null references email_message(id) on delete cascade,
  event_type    text not null,        -- 'open' | 'click'
  link_url      text,
  occurred_at   timestamptz not null default now(),
  user_agent    text,
  ip_hash       text,                 -- hashed, not stored raw
  is_probable_proxy boolean not null default false,
  is_self       boolean not null default false
);
```

**Open tracking data is substantially unreliable, and the team should know this before
building product decisions on it.** Specifically:

- Gmail proxies and caches images, so an "open" may register when Google fetches the image rather than when a human reads it
- Apple Mail Privacy Protection pre-fetches images, generating opens that did not happen
- Corporate security scanners fetch every link and image in inbound mail, producing both false opens and false clicks
- Plain-text readers and image-blocking clients produce false negatives
- The sender's own client loading the message registers a self-open

Mitigations: suppress events matching the sender's own session, flag known proxy user agents,
and — most importantly — **present opens as a weak signal in the UI, not as a fact.** "Possibly
opened" rather than "opened 3 times". Click tracking is meaningfully more reliable than open
tracking; weight it accordingly.

There is also a compliance dimension. Tracking pixels are treated as a form of tracking
technology under GDPR and ePrivacy in the EU and UK, and the lawful basis for using them
without recipient consent is contested. This is a question for counsel, not for engineering,
and it should be resolved before the feature ships to European customers. At minimum, make
tracking configurable per user and per message, and disclose it.

### 7.7 Operational requirements

- **Token storage:** envelope encryption with a KMS-held key, `key_version` on the row to support rotation. Never plaintext, never in application config.
- **Sync runs in workers, never the request path.** A mailbox with 50,000 messages will time out any HTTP handler.
- **Backoff and retry** with jitter. Both providers throttle.
- **Monitoring on staleness, not just errors.** The characteristic failure is a watch subscription silently expiring and sync stopping without an exception. Alert on `last_synced_at` age and on `watch_expires_at` approaching.
- **Reconciliation job.** A nightly delta-independent check catches gaps that push notifications missed.

---

## 8. Build sequence

Milestones sized at roughly two to three weeks each. Definition of done is deliberately
demanding — "the code exists" is not done.

### M0 — Foundations

Platform scaffolding with no domain features. Boring and non-negotiable.

- Repo, workspace, devcontainer, CI
- Migration tooling, seed data, integration test harness against a real database
- Auth and `app_user`
- Access-scope resolver skeleton (§2.5)
- Outbox table and dispatcher with an idempotent handler test
- Architecture boundary tests (§2.1)
- Audit and field history

**Done when:** a trivial entity can be created through the API, emits an event, the event is
dispatched once and only once under a forced double-delivery test, and a cross-module import
violation fails CI.

### M1 — Asset spine

- `asset`, `asset_ownership`, `asset_meter_reading`, `asset_relationship`
- Ownership transition service maintaining the denormalised current owner
- Meter reading ingestion with the suspect-reading detector (§4.3)
- Asset timeline read model
- Import tooling for existing population data

**Done when:** a machine can be created, sold, serviced, traded and resold, and the ownership
history reconstructs correctly at any date. Include a test for the meter rollover case.

### M2 — CRM core

- `account`, `contact`, `site`, `pipeline`, `pipeline_stage`, `opportunity`, `activity`
- Pipeline board with drag-and-drop
- Rotting mechanic (§6.2)
- Stage-gating from `entry_criteria` and `required_fields`
- Metadata layer (§2.4) and custom fields on account, contact, opportunity, asset
- Activity logging with a measured ten-second mobile path

**Done when:** the ten-second budget is verified on a real device on a throttled connection,
not asserted.

### M3 — Signal engine and phase 1 sources

- `opportunity_signal`, `source_rule_config`, rule registry, priority scoring
- `declined_work` source, event-driven
- `contract_renewal` source, scheduled
- `tech_lead` manual source from the mobile work order
- Triage queue as the rep home screen (§6.3)
- Routing, aging and accountability reporting — **ships here, not later**

**Done when:** a declined work order line produces exactly one correctly valued signal in the
right rep's queue, dedup holds under replayed events, and a signal aging past threshold appears
on a manager's exception report.

### M4 — Contracts and renewals

- `contract` with PM, extended warranty, FML and RPO as distinct types
- Renewal pipeline and expiry evaluation
- Training certification tracking with the three-year cycle

### M5 — Email, Microsoft 365 first

- Provider abstraction and Graph adapter
- OAuth, token vault, consent onboarding flow
- Delta sync workers, watch subscription and renewal job, staleness monitoring
- Matching engine (§7.5) with BCC dropbox
- Timeline display on account, contact and opportunity
- Send and reply from within the CRM

**Done when:** a reply sent from the CRM appears correctly threaded in the user's Sent folder in
Outlook, and killing the worker mid-sync then restarting produces no duplicates and no gaps.

### M6 — Email, Google Workspace

- Gmail adapter behind the same interface
- Pub/Sub push and seven-day watch renewal
- **CASA assessment initiated at the start of M5, not here** (§7.4)

### M7 — Tracking, templates, sequences

- Pixel and link rewriting with proxy and self-open suppression
- Per-user and per-message tracking toggles
- Templates with merge fields
- Multi-step sequences

### M8+ — Per the functional roadmap

Population intelligence, then trade cycle, then deal desk. Sequencing and rationale in
`crm-module-requirements-review.md` §7.

**Note on M5 placement.** Email is at M5 rather than later because the functional review
identified the inbox sidebar as the most common ERP-CRM omission and the leading cause of rep
non-adoption. If the schedule slips, slipping email is the option most likely to cost adoption.
Consider pulling it earlier rather than later.

---

## 9. Things that will bite

Ordered by how much they will hurt.

1. **Multi-tenancy decided late.** If there is any chance this becomes SaaS for multiple dealers, decide now. Retrofitting tenant isolation across seven modules is a rewrite, not a refactor.

2. **Signal queue with no owner.** The functional review flagged this and it is worth repeating in an engineering document: build the routing and accountability reporting in M3 alongside the capture. A queue nobody owns grows to four thousand items and gets ignored, and the feature is then permanently discredited internally.

3. **Meter reading data quality.** Bad readings generate spurious replacement opportunities. One absurd proposal in front of a customer and the rep never trusts the queue again. The suspect-reading detector is not a nice-to-have.

4. **Serial number matching.** Dealers will hand you spreadsheets with inconsistent casing, transposed characters, OEM prefixes included or omitted, and the same machine entered twice. Build normalisation and a merge tool during M1 import, not after go-live.

5. **Google CASA timeline.** Start the assessment months before you need it.

6. **Watch subscription expiry.** Silent sync death is the characteristic email integration failure. Monitor staleness.

7. **Custom field explosion.** Give dealers unlimited custom fields and one will create three hundred. Cap per entity, require a label and description, and report on unused fields.

8. **The ten-second budget eroding.** It will not be broken in one commit. It dies to fifteen well-intentioned required fields. Make it an automated performance test in CI that fails the build.

9. **Event handler non-idempotency.** Everything works until the first redelivery in production. Force double delivery in the test suite.

10. **Mailbox privacy.** Ingesting personal correspondence without clear defaults and controls is both a trust problem and, in some jurisdictions, a legal one. Resolve with counsel before M5 ships, not after a customer raises it.

---

## 10. Decisions needed before writing code

| # | Decision | Why it blocks |
|---|---|---|
| 1 | Language, framework, ORM | Migration tooling, DI, job runner, most of the scaffolding |
| 2 | Database engine | DDL dialect, JSON strategy, RLS availability |
| 3 | **Single-dealer install or multi-tenant SaaS** | Most expensive item to retrofit. Decide first. |
| 4 | Greenfield, or extending an existing ERP codebase | Determines whether M0 is real work or mostly adoption of existing platform pieces |
| 5 | Existing auth and user model to reuse, or new | M0 scope |
| 6 | Job queue and scheduler already in the stack? | M0 scope |
| 7 | Web-only, or native mobile alongside | The ten-second budget is far harder to hit on mobile web offline |
| 8 | Target deployment — cloud, on-prem, or both | On-prem makes KMS, Pub/Sub and webhook ingress materially harder |
| 9 | Which module ships to production first | Determines whether CRM can assume the asset master already exists |
| 10 | Telematics providers for phase 2 | Affects the integration abstraction shape, cheap to accommodate early |

Once 1 through 4 are settled I can generate the actual scaffolding — migrations, module
skeletons, the source rule registry, the mail provider interface with a Graph implementation,
and the VS Code workspace configuration — in the real stack rather than pseudocode.
