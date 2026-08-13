# CRM module — competitive benchmark and build plan

**Status:** draft for team review
**Date:** 3 August 2026

---

## How to read this document

This is a gap-analysis and sequencing proposal for the CRM module, benchmarked against
both mainstream CRM platforms and equipment dealer business systems.

**Sections 1–3** are the external benchmark: what the market considers baseline, and where
individual vendors differentiate. Use these to find omissions.

**Sections 4–7** are the proposal specific to our product. These contain the actual
recommendations and are where review effort is best spent.

**Section 8** lists open questions the team needs to resolve before phase 1 scoping.

Assessment columns are left blank deliberately. Suggested values: `Have` / `Partial` /
`Missing` / `N/A`.

> **Sourcing caveat.** This document was compiled without live web access, from knowledge
> current to roughly mid-2026. Vendor feature sets, tier gating, pricing and corporate
> ownership in this space change frequently — the dealer business system segment in
> particular has seen heavy M&A. Treat every vendor-specific claim as a starting point to
> verify, not as established fact. The structural recommendations in sections 4–7 are not
> sensitive to these details.

---

## 1. Benchmark set

### Mainstream CRM platforms — the UX and feature-breadth bar

| Platform | Why it's on the list |
|---|---|
| Salesforce Sales Cloud | Market leader; defines enterprise expectations |
| Microsoft Dynamics 365 Sales | Closest ERP-adjacent competitor |
| HubSpot Sales Hub | Sets the bar for usability and adoption |
| Zoho CRM | Sets the bar for breadth per dollar |
| Pipedrive | Sets the bar for simplicity |
| Freshsales | Strong SMB/mid-market; built-in telephony |
| monday CRM | Fastest-growing flexible//configurable CRM |
| Oracle NetSuite CRM | ERP-native — closest architectural analogue |
| SAP Sales Cloud | Enterprise ERP-native comparison |
| Odoo CRM | Open-source modular ERP+CRM; likely price competitor |

Also worth a look: SugarCRM, Creatio, Copper, Keap, Zendesk Sell.

### Dealer business systems — our actual functional competition

Given our module set, these are the systems prospects will compare us against. Verify
current ownership and product naming before citing any of them externally.

- VitalEdge / e-Emphasys
- CDK Global Heavy Equipment
- Charter ASPEN
- Karmak Fusion (truck)
- Procede Excede (truck)
- Ideal
- DIS
- Basis
- Rental-side: Texada, Wynne RentalMan, Point of Rental

**Key competitive insight:** many dealers running these systems bolt Salesforce or HubSpot
on top and pay to sync, because the built-in CRM is unusable for field sales. That
integration cost and data-latency pain is our opening.

---

## 2. Universal baseline — table stakes

Present in effectively all ten mainstream platforms. Absence here reads as an incomplete
product, not as a positioning choice.

### 2.1 Data model

| Capability | Assessment | Notes |
|---|---|---|
| Contact, account/company, lead objects with full activity timeline | | |
| Lead → contact/account/opportunity conversion flow | | |
| Account hierarchies (parent/child) with roll-up reporting | | |
| Custom fields **and** custom objects/modules | | |
| Duplicate detection and merge | | |
| CSV import with field mapping; export | | |
| Record ownership, teams, territories, record-level visibility | | |

### 2.2 Pipeline

| Capability | Assessment | Notes |
|---|---|---|
| Opportunity: amount, stage, expected close, probability, win/loss reason | | |
| Multiple pipelines with drag-and-drop kanban | | |
| Stage-gating (required fields/tasks before advancing) | | |
| Product catalogue and price books; quote line items | | |
| Weighted forecast **and** separate rep-committed forecast | | |

### 2.3 Activity and productivity

| Capability | Assessment | Notes |
|---|---|---|
| Bi-directional email sync (Outlook, Gmail) | | |
| Inbox sidebar plugin — rep never leaves their mail client | | |
| Email templates, open/click tracking, multi-step sequences | | |
| Calendar sync and public meeting-booking link | | |
| Tasks, reminders, call logging, click-to-call | | |
| Notes, file attachments, @mentions | | |

### 2.4 Automation

| Capability | Assessment | Notes |
|---|---|---|
| Trigger → condition → action workflow rules | | |
| Assignment/routing rules (round-robin, territory, load-balanced) | | |
| Lead scoring | | |
| Approval chains, SLA and escalation timers | | |
| Visual process builder (cf. Salesforce Flow, Zoho Blueprint, Dynamics BPF) | | |

### 2.5 Reporting

| Capability | Assessment | Notes |
|---|---|---|
| Self-service report builder; configurable dashboards | | |
| Funnel/conversion, activity, forecast accuracy, cycle-length reports | | |
| Quota and attainment tracking | | |
| Scheduled email delivery of reports | | |

### 2.6 Platform

| Capability | Assessment | Notes |
|---|---|---|
| REST API, webhooks, integrations directory | | |
| Native iOS and Android apps | | |
| RBAC, audit trail, field-level history | | |
| Multi-currency, multi-language, multi-timezone | | |
| Sandbox environment | | |

### 2.7 AI — now baseline, not differentiation

All ten ship some version of the following. Shipping these does not differentiate us;
*not* shipping them is now a visible gap.

- Email drafting
- Call transcription and summarisation
- Record and meeting summaries
- Deal risk scoring and next-step suggestions
- Natural-language querying of CRM data

Vendor brand names for reference: Agentforce (Salesforce), Copilot (Microsoft), Zia (Zoho),
Freddy (Freshworks), Breeze (HubSpot).

---

## 3. Vendor standout features

Not shared across the set. Useful for spotting ideas we haven't considered.

| Vendor | Distinctive capability |
|---|---|
| Salesforce | Agentforce autonomous agents; CPQ/Revenue Cloud; Data Cloud CDP; Territory Management 2.0; largest app marketplace |
| Dynamics 365 | Deep Teams/M365 embedding; Sales Accelerator work queue; relationship health scored from actual Exchange traffic; Power Platform extensibility |
| HubSpot | Genuinely unified marketing + CMS + CRM; free tier driving land-and-expand; playbooks |
| Zoho | Canvas (per-team drag-and-drop record layouts); CommandCenter journey orchestration; gamification; Zoho One bundling |
| Pipedrive | Activity-based selling as design philosophy — the pipeline *is* the product |
| Freshsales | Built-in cloud telephony, no third-party dialer |
| monday CRM | Board flexibility letting non-sales teams work in the same system |
| NetSuite | Real-time inventory in the quote; order-to-cash in one database; PRM; incentive compensation |
| SAP | Guided selling; sales performance management; retail-execution visit planning |
| Odoo | Open source; on-prem option; pick-your-modules pricing |

### Common buyer complaints — positioning opportunities

The loudest recurring grievances in CRM buyer reviews:

1. **Add-on gating** — AI and advanced features locked to top tiers
2. **Migration pain** — getting data in and out
3. **Seat-price surprises** — opaque pricing at renewal

Transparent pricing is a legitimate competitive wedge.

---

## 4. The core architectural decision

> **In a generic CRM the centre of gravity is the contact record. In ours it is the serial
> number.**

Equipment sales reps do not manage contacts. They manage **population** — every machine in
their territory, who owns it, what it is worth, how many hours are on it, and when it will
be replaced.

Get the equipment object right and the rest of the CRM hangs off it correctly. Get it wrong
and we have built a worse Pipedrive with an ERP attached.

Our defensible advantage is that we hold hour meters, warranty dates, finance maturity,
service history and actual cost data in one database. No dealer running Salesforce on top of
a separate business system can assemble that cleanly. Every recommendation below flows from
this.

### 4.1 Minimal machine object — phase 1 spec

Fields to get right now, because they are expensive to retrofit later.

| Field / structure | Requirement | Rationale |
|---|---|---|
| Serial number | Primary business key | Spine of the whole module |
| Make, model, model year, product family | Required | Segmentation, share-of-park |
| Sold by | Enum: us / competitor / unknown | Enables competitive canvassing |
| Current owner | FK to customer | — |
| Current site | FK to location | Machine-move tracking |
| **Ownership history** | Separate table, not a mutable owner field | Trade cycle, resale chain, provenance |
| **Meter readings** | Time series with source (tech / telematics / self-reported) | Single `hours` column makes trend analysis impossible |
| **Parent/child asset link** | Self-referential FK | Battery, charger, attachments as own serialized records |
| Warranty end date | | Trigger source |
| PM plan / contract ID | FK | Renewal pipeline |
| Finance or lease maturity | | Trigger source |
| Rolling service and parts spend | Derived | Repair-vs-replace analysis |
| Cost per hour | Derived | Primary proposal metric |

**On parent/child:** with material handling in scope, electric truck batteries and chargers
are separately serialized, separately warranted and separately replaced. Battery replacement
is one of the most predictable high-margin recurring sales in the business. Most dealer
systems bury it as a parts line, so nobody can build a pipeline from it. This is a
low-effort, high-return modelling decision.

**On ownership history as a table:** new sale → trade → recon → used sale → wholesale is a
chain, not a state. Territory population reporting, share-of-park and trade cycle triggers
all depend on being able to reconstruct it.

---

## 5. CRM ↔ module integration requirements

Organised by the module the CRM reads from or writes to. This is where an ERP-native CRM
beats a bolted-on one, and it should be the centre of our sales story.

### 5.1 Equipment inventory

- Rep-facing availability: on hand, on order with OEM ETA, in transit, at other branches, on rent, on demo, aged
- Reserve/hold a unit against a quote
- Inter-branch transfer request initiated from inside the opportunity
- Aged inventory alerts with floor plan carrying cost per day — turns stale units into a rep work queue
- Demo scheduling with demo-to-close conversion tracking

### 5.2 Shop and field service

- **Declined and deferred work as pipeline.** Technician recommends repairs, customer defers. That is a qualified opportunity with a known value. See §6.1 — highest-ROI item in this document.
- **Technician-generated leads.** Action on the mobile work order creating an attributed, spiff-able lead.
- PM and extended service agreements as a recurring-revenue pipeline with renewal queue
- Telematics-driven leads: fault codes, service due, high idle, low utilisation
- Open recall and PIP campaigns targeted by serial number
- Repair-vs-replace analysis using our own cost-per-hour history
- **Component rebuild and exchange** — undercarriage, certified rebuild, engine exchange. Construction-side pipeline driven by hour thresholds. Same trigger engine as trade cycle, different outcome.

### 5.3 Rental

- **RPO accrual visible to the rep with a live convert-now calculation**
- **Rental-to-sale ladder.** Repeat rental spend on the same machine class is the clearest buy signal available. Surface cumulative rental spend against purchase cost as a one-click proposal.
- Rental availability calendar and utilisation
- Repeat-rental pattern detection as an opportunity trigger
- Off-rent inspection damage becomes a repair quote, not a write-off argument
- Cross-rent and re-rent tracking

### 5.4 Parts

- **Lost sales capture** — every unfilled counter request is both a lead and a market signal
- Reorder cadence modelling with proactive campaigns
- Consumables and wear-parts subscription programmes

### 5.5 Transportation

- Delivery and pickup slots visible inside the quote, so the rep can commit to a date credibly
- Haul cost pulled into deal gross rather than estimated
- Sold unit auto-generates the chain: make-ready work order → haul job → warranty registration → PM schedule → trade cycle clock start. One chain, no re-keying.

### 5.6 Sales / deal desk (whole goods)

This is where generic CRMs fail hardest and where we can be materially better.

- Configurator: base machine, attachments, factory- vs dealer-installed options
- Trade-in appraisal workflow: walk-around inspection with photos, recon estimate pulled from shop service, book value, allowance vs ACV with over-allowance visible
- **True deal gross:** freight, PDI/make-ready, recon, floor plan interest, holdback, OEM rebates and co-op, over-allowance
- Finance and lease quoting: payment, term, residual; credit app submission to captive finance
- OEM programme eligibility with expiry dates — reps lose deals to expired programmes routinely
- Multi-unit, multi-trade deals as a single structure, not five opportunities

### 5.7 Contract types to model as distinct objects

- **PM agreement** — scheduled maintenance only
- **Extended warranty** — coverage, no scheduled work
- **Full maintenance lease (FML)** — we own the asset and bundle all service. Behaves nothing like a PM agreement in renewal, margin, or termination. Common in material handling. Model separately from day one.
- **RPO / rent-to-own** — accrual toward purchase

---

## 6. Rarely built, high value

Ranked roughly by return on build effort. These are the differentiators.

### 6.1 Declined work pipeline

Highest-ROI item in this document. Near-zero customer acquisition cost, high margin,
customer is already in our building, opportunity value already known from the estimate.
Systematically worked by almost nobody in the industry.

### 6.2 OSHA operator certification training

Three-year renewal cycle, near-zero delivery cost, legal requirement for forklift
customers. Practically nobody has it in a CRM renewal queue. Cheap to build, easy to sell.

### 6.3 Fleet cost benchmarking for mixed-make fleets

A customer with forty trucks across three sites, half competitor-supplied, is our best
proposal opportunity — and we have the service history to prove cost-per-hour on the ones
we maintain.

### 6.4 Share-of-park dashboards

By territory, product family and rep. The number dealer principals actually run the
business on.

### 6.5 Remaining items

| Item | Notes |
|---|---|
| OEM lead ingestion with response-time SLA tracking | Manufacturers push leads and score dealers on response speed |
| Serial plate OCR in the mobile app | Plus geo-tagged competitive machine sightings |
| Offline-capable mobile | Reps work jobsites with no signal |
| Customer portal | Own fleet, machine health, service history, PMs due, open quotes |
| Multi-franchise separation | Reporting, programmes and warranty kept distinct per OEM |
| Commission and incentive comp | On blended gross across whole goods, parts and service |
| Forecast snapshots | Week-over-week change with reason codes |
| Project/bid board lead feeds | Construction-side prospecting |
| Consent and preference management | GDPR/CCPA with audit trail |
| Migration tooling from Salesforce and HubSpot | We are always replacing something |

---

## 7. Phased roadmap

Sequencing reflects the team's stated priority order, with one adjustment noted below.

### Sequencing note

Service-to-sales lead capture was ranked first, and the installed base spine second. The
first depends on the second: a technician flagging a machine as finished only becomes a
workable opportunity if there is a machine record holding hours, ownership and service spend
to justify the proposal. Without it we get free-text notes in a queue nobody works.

**Resolution — split the spine rather than reorder priorities.** The minimal machine object
(§4.1) ships as a phase-1 prerequisite. The population intelligence layer — share-of-park,
territory canvassing, competitive units — moves to phase 2.

The stated ranking is otherwise sound and worth defending: with material handling in the
mix, service and parts are the profit pool and whole goods is close to a loss leader.
Ranking the deal desk last feels backwards and is correct.

### Phase 1 — service to sales

- Minimal machine object per §4.1
- Declined work lines from shop and field work orders → opportunities with estimated value attached
- "Create lead" action on the mobile work order, attributed to the technician
- Contract renewal queue: PM, extended warranty, FML
- **Follow-up queue with routing, aging and accountability reporting** — ships in the same release, not later

### Phase 2 — population intelligence

- Ownership chain
- Competitive unit canvassing
- Share-of-park by territory and product family
- Telematics ingestion with fault-code severity routing

### Phase 3 — trade cycle

- Threshold engine: hours, warranty, lease maturity, repair-cost-to-value ratio
- Repair-vs-replace from our own cost-per-hour history
- Auto-assembled proposals: trade value, comparable new unit, payment delta, cost-per-hour trend

### Phase 4 — deal desk

- Configurator
- Trade appraisal with recon estimate from shop
- True deal gross including freight, PDI, floor plan, OEM programmes
- Finance and lease quoting

---

## 8. Risks and open questions

### 8.1 Risks

**Phase-1 queue ownership.** Declined work capture only pays off if someone owns the queue.
Dealers who build the feature and assign it to nobody get a list that grows to four thousand
items and gets ignored. Routing, aging and accountability reporting must ship with the
capture, not after it.

**ERP UX leaking into the CRM.** Dealer systems are notorious for interfaces descended from
green-screen conventions, which field reps refuse to use — precisely why so many dealers pay
to bolt Salesforce on top. **If a rep cannot log a call in under ten seconds on a phone,
nothing else in this document matters.** Recommend a hard click-count and page-speed budget
as an acceptance criterion for every phase-1 screen.

**Email as a first-class citizen.** Reps live in Outlook. An inbox sidebar with sync,
templates, tracking and sequences is the single most common ERP-CRM omission and the most
common reason reps refuse to adopt. It is in §2.3 as table stakes and should not slip.

**Scope creep into marketing automation.** Recommend we integrate rather than rebuild, and
compete on installed-base data instead.

### 8.2 Open questions for the team

1. Where does phase 1 sit relative to the other six modules on the overall release plan?
2. Who owns the declined-work queue in the target operating model — branch service manager, inside sales, or the rep?
3. Do we build the inbox sidebar in phase 1 or accept adoption risk until later?
4. Which telematics providers do we support first, and is that a phase 2 or phase 3 commitment?
5. Are we targeting our existing ERP base, or competing for net-new CRM deals? This changes migration tooling priority substantially.
6. Multi-franchise separation — needed at launch, or deferrable?
7. What is our position on AI features given they are now baseline? Build, integrate, or defer with a stated gap?

---

## 9. Verification checklist before external use

- [ ] Confirm current ownership and product naming for all dealer business systems in §1
- [ ] Confirm current AI feature availability and tier gating for the ten platforms in §2.7
- [ ] Confirm vendor standout features in §3 are still shipping and still exclusive
- [ ] Pull current pricing for the platforms we position against
- [ ] Validate §6 differentiators against at least three dealer prospects before committing build effort
