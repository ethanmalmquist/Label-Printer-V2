# CRM build plan — addendum: multi-tenancy and Node/TypeScript stack

**Status:** draft for technical review
**Date:** 3 August 2026
**Amends:** `crm-build-plan.md`
**Confirmed inputs:** Node + TypeScript · multi-tenant SaaS · partial ERP in progress

---

## 0. Read this first

Two things in the parent build plan are now **wrong** and must be corrected before any schema
work:

1. **Every unique constraint and primary key needs `tenant_id` in it.** The DDL in
   `crm-build-plan.md` §4 was written for a single-dealer install. As written, one dealer
   registering serial `A123` would block every other dealer from registering the same serial.
   Section 4 below gives the corrected patterns.

2. **The asset spine cannot be a single global table without tenant scoping.** The shared-kernel
   argument in the parent plan §2.2 still holds *within* a tenant. Across tenants it must be
   hard-isolated.

And one thing is now more urgent than any CRM work — section 1.

---

## 1. Do this before writing CRM code

> **Audit the tenancy pattern in the partial ERP. This week.**

There are three possible states, and they lead to very different plans:

**A. The existing modules are already tenant-scoped with a consistent pattern.**
Best case. Adopt the pattern exactly, even if you would have chosen differently. A second
tenancy pattern in the same codebase is worse than a suboptimal single one.

**B. The existing modules have no tenancy concept.**
This is the fork in the road, and CRM is the wrong place to discover it. Retrofitting tenancy
into parts inventory, work orders and equipment is a substantial project on its own, and it
touches every query in those modules. It needs to be scoped and scheduled as its own workstream
*before* CRM adds seven more tables and a signal engine to the surface area.

**C. Different modules did it differently.**
Worst case, and more common than people expect. Reconcile before proceeding, or the CRM
inherits the inconsistency permanently.

**Deliverable from the audit:** a short written record of which state you are in, the pattern in
use, and — if B or C — a decision on when reconciliation happens relative to CRM M0. Make it
ADR-0001.

Everything below assumes you land on the pooled model in section 2. If the existing ERP already
made a different choice, follow the existing choice and treat sections 2 through 4 as
background.

---

## 2. Tenancy model

### 2.1 The decision

Standard SaaS advice — shared schema, `tenant_id` on everything — comes from products with
thousands of small tenants. Your shape is different: relatively few tenants, very large data
volumes per tenant, and high isolation expectations from customers who compete with each other,
sometimes in the same OEM territory.

That pushes toward more isolation than the default advice. But schema-per-tenant and
database-per-tenant both carry costs that are punishing early: migration fan-out across hundreds
of schemas, connection pool multiplication, and a provisioning process that becomes a permanent
operational tax.

**Recommendation: pooled by default, with a designed path to silo.**

- Shared schema, `tenant_id` on every business table, PostgreSQL row-level security as the enforcement backstop
- Tenant-aware connection resolution from day one, so moving a specific tenant to a dedicated database is a configuration change rather than a rewrite
- The largest or most isolation-sensitive customers get promoted to dedicated databases when commercially justified

The load-bearing part is the second bullet. If every query resolves its connection through a
tenant-aware resolver, silo becomes an option later. If connections are a module-level singleton,
it never does.

### 2.2 Costs of pooled you should accept knowingly

| Cost | Mitigation |
|---|---|
| Single-tenant restore is hard | Nightly per-tenant logical export; test the restore path before you need it |
| Noisy neighbour | Per-tenant rate limiting in the job layer (§5.4); partitioning on the largest tables |
| A tenancy bug is a cross-tenant data leak | RLS as backstop (§3); tenancy tests in CI (§3.4) |
| OEM data-handling agreements may object to pooled storage | See §2.3 — commercial, not technical |

### 2.3 A commercial risk worth raising early

Dealers sign data-handling agreements with their OEMs. Some of those agreements constrain where
dealer and machine data may be stored and who may access it. A pooled multi-tenant database
holding two competing Caterpillar dealers' populations in the same tables may draw objections —
not necessarily from the dealers, but from the manufacturers.

This is a commercial and contractual question rather than an engineering one, and it is worth
putting in front of whoever owns OEM relationships before the architecture sets. If the answer
is that certain customers or certain OEMs require physical separation, the silo escape hatch in
§2.1 stops being optional and becomes a launch requirement.

Expect SOC 2 to be demanded by enterprise dealers regardless. Pooled tenancy is compatible with
it, but the controls need documenting from the start rather than reconstructed during an audit.

---

## 3. Row-level security — implementation and footguns

RLS is the backstop, not the primary mechanism. Application-layer scoping is still required. RLS
exists so that a single forgotten `where tenant_id = ?` is an empty result set rather than a
breach.

### 3.1 Two database roles, not one

This is the detail most teams get wrong: **a table's owner bypasses RLS by default.** If the
application connects as the role that owns the tables, every policy you write is decorative.

```sql
-- migrations run as this role; owns the schema
create role app_migrator noinherit login password :'migrator_password';

-- the application connects as this role; RLS applies
create role app_runtime noinherit login password :'runtime_password';

grant usage on schema public to app_runtime;
```

Neither role may be `superuser` and neither may hold `BYPASSRLS`. Verify with a test, because a
managed-Postgres provider's default role often has more privilege than expected.

### 3.2 Policies

```sql
alter table asset enable row level security;
alter table asset force row level security;   -- applies to the owner too

create policy asset_tenant_isolation on asset
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on asset to app_runtime;
```

Three details that matter:

- `force row level security` — without it the owner still bypasses
- `current_setting(..., true)` — the second argument makes a missing setting return `NULL` rather than raising, so unset context yields zero rows and zero permitted inserts. Fail-closed.
- `nullif(..., '')` — an empty-string setting would otherwise raise on the `::uuid` cast

Generate these policies from the migration tooling rather than hand-writing per table. A table
that ships without a policy is a hole, so make policy presence a schema test (§3.4).

### 3.3 Setting tenant context safely under connection pooling

**The dangerous version:**

```sql
SET app.tenant_id = '...';   -- session-scoped
```

Session-scoped settings survive the connection's return to the pool. The next request — possibly
a different tenant — inherits it. With PgBouncer in transaction mode the behaviour is worse and
harder to reason about. This is the single highest-severity bug class in the design.

**The correct version** is transaction-local, using the third argument to `set_config`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';

export interface TenantContext {
  tenantId: string;
  userId: string;
  branchIds: readonly string[];
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentTenant(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant context. All data access must run inside runWithTenant().',
    );
  }
  return ctx;
}

/**
 * The only sanctioned entry point for data access.
 * Opens a transaction, pins tenant context to it, runs the callback.
 */
export async function tenantTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const { tenantId } = currentTenant();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${tenantId}, true)`,
    );
    return fn(tx);
  });
}
```

The `true` is transaction-local scope. It is one character and it is the difference between
correct isolation and a cross-tenant leak.

**Enforce that nobody bypasses it.** The raw `db` handle should not be importable from domain or
application code — export only `tenantTx` and keep the pool private to the module. Back it with
an ESLint `no-restricted-imports` rule so the bypass fails CI rather than review.

Note the failure mode: forgetting `tenantTx` produces *empty results*, not an error. Safe, but
confusing to debug. Worth a startup assertion in non-production that queries outside a tenant
transaction throw loudly.

### 3.4 Tenancy tests in CI

Three tests, non-negotiable, running against a real Postgres via Testcontainers:

1. **Isolation** — seed two tenants with overlapping natural keys, assert every list endpoint under tenant A returns zero of tenant B's rows
2. **Policy coverage** — query `pg_tables` and `pg_policies`, assert every business table has RLS enabled, forced, and at least one policy. Fails when someone adds a table and forgets.
3. **Role privilege** — assert `app_runtime` lacks `BYPASSRLS` and is not the table owner

Test 2 is the one that keeps working over time. The other two are point-in-time; that one catches
future omissions.

---

## 4. Corrected schema patterns

### 4.1 Tenant column and constraint rules

Applies to every business table:

- `tenant_id uuid not null references tenant(id)` — first column
- **Every unique index includes `tenant_id` as its leading column**
- Every foreign key target is in the same tenant. RLS does not enforce this; a check trigger or a composite FK including `tenant_id` does
- Composite primary keys of `(tenant_id, id)` on the tables you might partition later — partition keys must appear in every unique constraint, so this decision has to be made now

Corrected version of the parent plan's asset table:

```sql
create table asset (
  tenant_id           uuid not null references tenant(id),
  id                  uuid not null default gen_random_uuid(),
  serial_number       text not null,
  make                text not null,
  model               text not null,
  model_year          int,
  product_family      text not null,
  category            text not null,
  sold_by             text not null,
  origin_deal_id      uuid,
  status              text not null,
  current_owner_id    uuid,
  current_site_id     uuid,
  branch_id           uuid not null,
  franchise_id        uuid,
  warranty_end_date   date,
  finance_maturity    date,
  acquired_at         date,
  custom_fields       jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (tenant_id, id)
);

-- note the leading tenant_id — this is the correction
create unique index asset_serial_uq
  on asset (tenant_id, upper(serial_number), upper(make));

create index asset_owner_idx  on asset (tenant_id, current_owner_id)
  where current_owner_id is not null;
create index asset_family_idx on asset (tenant_id, product_family, category);
create index asset_custom_idx on asset using gin (custom_fields);
```

Apply the same correction to every unique index in the parent plan §4 and §5:

| Table | Parent plan constraint | Corrected |
|---|---|---|
| `asset` | `(upper(serial), upper(make))` | `(tenant_id, upper(serial), upper(make))` |
| `asset_ownership` | `(asset_id) where effective_to is null` | `(tenant_id, asset_id) where effective_to is null` |
| `opportunity` | `reference unique` | `(tenant_id, reference)` |
| `opportunity_signal` | `(source_key, dedup_key)` | `(tenant_id, source_key, dedup_key)` |
| `field_definition` | `(entity_type, field_key)` | `(tenant_id, entity_type, field_key)` |
| `source_rule_config` | `(source_key, branch_id)` | `(tenant_id, source_key, branch_id)` |
| `email_account` | `(user_id, provider, email_address)` | `(tenant_id, user_id, provider, email_address)` — but see §6.3 |
| `email_message` | `(email_account_id, provider_message_id)` | `(tenant_id, email_account_id, provider_message_id)` |

### 4.2 Platform tables sit outside RLS

The tenant registry, plan/entitlement data, and platform-operator accounts cannot be
tenant-scoped — something has to resolve which tenant a request belongs to before tenant context
exists.

Put them in a separate `platform` schema with no RLS, reachable only through a dedicated
repository module that the domain code cannot import. Keep the boundary mechanical, not
conventional.

### 4.3 Partitioning readiness

Three tables will get large enough to matter: `asset_meter_reading`, `email_message`, and
`activity`. Telematics alone can produce readings per machine per day across thousands of
machines per tenant.

Do not partition in M1. But make the schema partition-ready now, because retrofitting a partition
key into a primary key means rewriting the table:

- Composite PK leading with `tenant_id`
- For the time-series tables, consider `(tenant_id, id, read_at)` so range partitioning on time stays available
- Document the intended strategy in an ADR so the eventual migration is a planned step rather than an emergency

### 4.4 Drizzle column helpers

```ts
import { pgTable, uuid, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const tenantColumn = {
  tenantId: uuid('tenant_id').notNull(),
};

export const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const customFieldsColumn = {
  customFields: jsonb('custom_fields').notNull().default({}),
};
```

Spread these into every table definition. Uniform enough that a codegen check can assert every
business table includes `tenantColumn`.

---

## 5. Stack recommendations

Opinionated, with the tradeoff stated. Adopt whatever the partial ERP already uses in preference
to any of this — consistency beats optimality.

Verify current version and LTS status of everything here; my knowledge runs to roughly mid-2026
and this ecosystem moves quickly.

### 5.1 Framework — NestJS

Seven bounded contexts in one deployable is exactly what NestJS's module system is for, and the
DI container makes the application/infrastructure split in the parent plan §3 natural rather than
ceremonial.

**Tradeoff:** heavier and more abstracted than Fastify, and decorator-based DI divides opinion.
If the existing ERP is plain Fastify or Express, staying there and imposing structure manually is
the better call.

**Either way:** NestJS modules do *not* enforce boundaries — you can import across them freely.
Add `dependency-cruiser` or `eslint-plugin-boundaries` regardless. Module boundaries that depend
on discipline do not survive a deadline.

### 5.2 ORM — Drizzle

The queries in this domain get genuinely hard: share-of-park aggregations, population reports,
priority scoring, trade cycle threshold evaluation across a meter time series. Those want SQL,
not a query builder fighting you.

Drizzle keeps you in SQL with real type inference, and raw escape hatches are first-class rather
than an admission of defeat. Its schema-as-TypeScript also makes the tenant-column assertions in
§4.4 mechanical.

**Tradeoff:** Prisma has better documentation, a larger community, and is easier to hire for. If
the team is junior or the existing ERP already uses Prisma, that argument may outweigh the SQL
control — but check Prisma's current RLS and session-variable story carefully before committing,
because interactive transactions and connection pooling interact with §3.3 in ways that need
verifying rather than assuming.

**MikroORM** deserves a mention: its global filters are genuinely well-suited to tenant scoping
and would give you defence-in-depth above RLS. Worth 30 minutes of evaluation if nobody has
strong feelings.

### 5.3 Rest of the stack

| Concern | Recommendation | Note |
|---|---|---|
| Runtime | Current Node LTS | Verify which line is LTS at start of work |
| Monorepo | pnpm workspaces + Turborepo | Nx if you want NestJS generators |
| Validation | Zod | At every boundary, including event payloads |
| Internal API | tRPC | Only if the frontend is TypeScript |
| Public API | REST + OpenAPI | Non-negotiable for an ERP; dealers and OEMs will integrate |
| Testing | Vitest + Testcontainers | Real Postgres for integration tests, no mocks |
| Auth | WorkOS, Auth0, or Keycloak | See below |

**On auth: do not build it.** Multi-tenant SaaS selling to dealerships means enterprise SSO —
SAML and SCIM provisioning — is a sales requirement, not a feature. Building it consumes months
and produces something worse than the hosted options. Buy it, and make sure whatever you pick
models organisations natively so it maps onto your tenants.

### 5.4 Jobs — and the multi-tenant wrinkle

Both **BullMQ** (Redis) and **pg-boss** (Postgres) are reasonable. pg-boss means one fewer piece
of infrastructure, which is worth real money at your stage. BullMQ has more headroom for the
email sync volume in §6.

The multi-tenant problem either way: **one tenant with 400 mailboxes can starve everyone else.**
Open-source BullMQ rate-limits per queue, not per tenant group — per-tenant fairness needs
building.

Simplest workable approach: a dispatcher that round-robins across tenants with pending work and
enforces a per-tenant concurrency cap held in `tenant` configuration. Not elegant, but it
prevents the failure mode where a large customer's nightly sync makes the product look broken for
everyone else.

Design this in M0. It is much harder to add once workers are in production.

---

## 6. Multi-tenant email integration — what gets harder

Amends the parent plan §7. The provider abstraction, matching engine, and tracking caveats all
stand. These are the multi-tenant deltas.

### 6.1 Microsoft 365

- Register the Azure AD app as **multi-tenant**; authenticate against `/organizations`, not a specific tenant
- Each customer's admin grants consent to your app in their directory. Build the consent flow into onboarding — it is a per-customer procurement step and it will otherwise land on support
- Store the customer's Azure `tid` and validate the `tid` claim on every token. A token from tenant X must never resolve to your tenant Y
- **Webhook tenant resolution:** encode your tenant id in the subscription's `clientState`, validate it on every notification, and never trust the notification body alone to identify the tenant

### 6.2 Google Workspace

- One GCP project, one published OAuth consent screen, **per-user OAuth** rather than domain-wide delegation. Domain-wide delegation would let a service account impersonate every user in a customer domain — operationally simpler, considerably worse blast radius, and a harder security conversation with customers
- One Pub/Sub topic and subscription for all tenants
- **The CASA assessment covers your application, not each customer** — so it is a single cost, but still a months-long gate. Start it at the beginning of M5, per the parent plan

### 6.3 The Gmail notification ambiguity

A Gmail `watch` notification payload identifies the mailbox by **email address and history id
only**. There is no field you control to carry your tenant id.

So resolving a notification to an `email_account` row requires a lookup by email address across
all tenants. If the same address is connected in two tenants, the notification is ambiguous.

**Resolution:** enforce a globally unique constraint on connected email addresses across all
tenants, separate from the per-tenant constraint in §4.1:

```sql
create unique index email_account_global_uq
  on email_account (lower(email_address))
  where sync_status <> 'disconnected';
```

Then document the consequence: a person cannot connect the same mailbox to two tenants
simultaneously. In practice this is almost always fine — but it will eventually surface with a
consultant or a shared service address, so the error message should explain it rather than just
failing.

### 6.4 Shared rate limits are a shared failure

Graph throttles largely per-mailbox, but app-level limits exist. Gmail meters quota units per
project as well as per user. Either way, **your rate limit ceiling is shared across all
tenants**, so one customer's backfill degrades service for everyone.

Requirements:

- Per-tenant token buckets in the sync workers, not just global backoff
- Per-tenant quota accounting recorded and visible in operations dashboards
- Initial-backfill jobs at lower priority than incremental delta sync, so onboarding a large customer never delays live sync for existing ones

That last point is easy to miss and produces a bad first week for every new customer.

### 6.5 Token encryption per tenant

The parent plan §7.7 specified envelope encryption with a KMS-held key. Multi-tenant raises the
stakes: one key for all tenants means one compromise exposes every mailbox.

Use per-tenant data encryption keys wrapped by a KMS master key. `key_version` on the row already
supports rotation; add `tenant_id` to the key derivation.

---

## 7. Revised M0

The parent plan's M0 was written without tenancy. It grows:

- Repo, workspace, devcontainer, CI *(unchanged)*
- Migration tooling with **automatic RLS policy generation** per table
- **Two-role database setup** (§3.1) including a privilege assertion test
- **Tenant context plumbing:** AsyncLocalStorage, `tenantTx`, lint rule preventing raw pool access (§3.3)
- **Tenant-aware connection resolver** — the silo escape hatch from §2.1
- **`platform` schema** with the tenant registry, isolated from domain imports (§4.2)
- **Tenant provisioning workflow**, tested — creating a tenant seeds default pipelines, stages, source configs and field definitions
- **The three tenancy tests** in CI (§3.4)
- **Per-tenant fairness in the job dispatcher** (§5.4)
- Auth integration with the chosen provider, organisations mapped to tenants
- Access-scope resolver, outbox and dispatcher, architecture boundary tests *(unchanged)*

**Done when:** a request under tenant A cannot observe tenant B's data through any endpoint;
removing a `where tenant_id` clause from a repository yields an empty result rather than a leak;
adding a table without an RLS policy fails CI; and provisioning a tenant from scratch produces a
usable, correctly seeded workspace.

That is a bigger M0 than the parent plan implied — realistically several weeks rather than two or
three. It is also the least negotiable milestone in the entire project. Every week saved here is
paid back with interest the first time a tenancy bug reaches production.

---

## 8. Immediate next actions

1. **Audit the partial ERP's tenancy pattern** (§1). Everything else waits on the answer.
2. Write ADR-0001 recording the tenancy decision and the pooled-with-silo-escape rationale.
3. Raise the OEM data-handling question (§2.3) with whoever owns manufacturer relationships.
4. Confirm framework and ORM against what the existing ERP uses.
5. Decide the auth provider — it gates M0 and has a procurement lead time.

Once 1 and 4 are settled I can generate the working scaffold: the `platform` schema and tenant
registry, the RLS-generating migration helper, `tenantTx` with its lint rule and tenancy tests,
Drizzle schemas for the asset spine and CRM core with corrected constraints, the source rule
registry, and the `MailProvider` interface with a Graph implementation.
