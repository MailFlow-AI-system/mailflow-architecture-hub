# MailFlow Architecture Consolidation

Status: consolidated from the approved baseline; no architecture decision is reopened  
Consolidated on: 2026-08-20  
Normative source: `architectureBaseline.md`  
Normative source SHA-256: `4dfc6a5ea4fc217d8f6de83e033ad0d2375244aef1bd37d263520d8a479575fc`

## 1. Purpose and authority

This document is the navigation and decision-register layer for the MailFlow architecture. It gives the architecture website, implementation plans, ADRs, and client-document process a stable catalog of the accepted decisions without creating a second independent source of truth.

The authority order is:

1. A later explicitly approved ADR or architecture change.
2. `architectureBaseline.md`, including its detailed motivations, trade-offs, security controls, references, and re-evaluation criteria.
3. This consolidation, which summarizes and indexes that baseline.
4. Diagrams, website copy, implementation plans, and client-facing documents derived from these sources.

If this document and the baseline appear inconsistent, the baseline wins until both artifacts are deliberately synchronized. A decision is not changed by updating a diagram or implementation alone.

## 2. Architecture in one statement

MailFlow starts as a modular multi-tenant email system optimized for two developers and one to three pilot customers. Its Web application is independently deployed, while one Core backend image runs separate API and worker processes over PostgreSQL, pg-boss, R2, Resend, and ClamAV. It deliberately avoids an MVP event bus and premature microservices.

When Contact/Audience begins, the system crosses its first real distributed boundary: Audience becomes an independent service on VPS B, RabbitMQ and Redis enter, a thin Gateway appears, database ownership becomes service-local, asynchronous integration uses outbox/inbox patterns, and host communication uses WireGuard plus application-level workload authorization. Later contexts are extracted only when domain ownership, scale, reliability, release cadence, or operational evidence justifies them.

## 3. Non-negotiable architecture principles

| ID | Decision | Consolidated rule | Baseline authority |
|---|---|---|---|
| ARC-001 | Evolution over premature distribution | The MVP is modular; distributed services begin with Audience. | Sections 2 and 21 |
| ARC-002 | Vertical slices | Features are organized as vertical slices inside each bounded context. | Section 2 |
| ARC-003 | Clean-ish boundaries | Domain and application logic use explicit ports where they protect change, without imposing ceremonial layering everywhere. | Section 2 |
| ARC-004 | Multi-tenancy | Workspace and tenant are synonymous; every tenant-owned path is workspace-scoped and defense-in-depth protected. | Section 6 |
| ARC-005 | Event-driven activation | Event-driven architecture and the event bus begin only when the first independent business service creates a real distributed consistency problem. | Sections 2, 4, and 11 |
| ARC-006 | Database ownership | Every extracted service owns its logical database, role, migrations, policies, and recovery boundary. Cross-service database access is forbidden. | Section 6 |
| ARC-007 | Progressive polyrepos | Web and Core start in separate repositories; a new repository appears only with a real independent deployable. Turborepo is not selected. | Section 5 |
| ARC-008 | Thin edge | The Gateway/BFF authenticates, routes, and performs bounded presentation composition. It owns no domain rules, database, or producer events. | Sections 2 and 4 |
| ARC-009 | Minimal contracts | Events and commands carry only justified integration data. Domain entities and business rules are never shared as a common package. | Section 4 |
| ARC-010 | Explicit ownership | Each external provider, connection, datum, command, and side effect has exactly one domain owner. | Sections 3, 7, and 20 |
| ARC-011 | Evidence-based change | Conditional technologies have blocking spikes and documented fallbacks; material boundary changes require a new architecture decision. | Sections 20 and 21 |
| ARC-012 | Learning without false complexity | Distributed topology is introduced deliberately for real learning, but only at a phase where its mechanisms have an actual job. | Sections 1, 2, and 16 |

## 4. Product phases and topology

### Phase 0 — MVP email product

| Concern | Accepted shape |
|---|---|
| Product scope | Foundation, workspace signup/authentication, owner/admin/member invitations and management, Inbox, Email Viewer, Email Composer, and attachments. |
| Explicit exclusions | Teams UI, permission matrix, advanced email conveniences, scheduled send, reusable signatures, recipient suggestions, labels/categories, Gmail/Outlook synchronization, historical import, and customer-owned domains. |
| Web | One independently deployed TanStack Start candidate application on Cloudflare Workers with Static Assets. |
| Backend | One `mailflow-core` repository and image; separate Core API and Core worker processes. |
| Modules | Identity/Workspace and Mail are explicit modules with separate schema/migration ownership and no forbidden cross-boundary coupling. |
| Jobs | pg-boss in the same PostgreSQL transaction as domain state through the queue port. |
| Realtime | SSE invalidation, PostgreSQL `LISTEN/NOTIFY`, and TanStack Query refetch. |
| External systems | Neon PostgreSQL, Cloudflare R2, Resend, Infisical, and Grafana Cloud. |
| Compute | VPS A on OCI Always Free A1 when available; paid OCI is preferred after the pilot and DigitalOcean is the portable fallback. |
| Containers | Cloudflare Tunnel, Caddy, blue/green Core API slots, Core worker, ClamAV, and OpenTelemetry Collector. |
| Explicit absence | No RabbitMQ, Redis, internal event bus, or microservice estate. |

### Phase 1 — Audience extraction

| Concern | Accepted shape |
|---|---|
| Trigger | Contact/Audience implementation begins. |
| VPS A | Edge, thin Gateway, Identity/Workspace, Mail API/worker, ClamAV, Collector, and later independently deployed Billing containers. |
| VPS B | Independent Audience API/worker and Collector. Campaign and Content may later be placed here only through the documented capacity gate. |
| Transport | RabbitMQ for durable integration; Redis for explicitly ephemeral and rebuildable low-latency workloads. |
| Data | Separate logical Identity, Mail, Audience, and later Billing databases with distinct credentials and migrations. |
| Network | Same compute provider and US region, provider-private network, point-to-point WireGuard, provider and host firewalls, and app-level tokens. |
| Failure semantics | VPS B failure degrades Audience only; it does not make Mail unavailable and does not provide Core high availability. |
| Required proof | Contract compatibility, outbox/inbox, idempotency, distributed E2E, latency, partition, recovery, independent deploy, and observability tests. |

### Phase 2 — Progressive domain distribution

New services are placed on VPS A or VPS B only after a documented resource, latency, security, failure-domain, deployment, and cost review. Co-location never permits process, database, credential, migration, contract, or deployment coupling. If neither host has safe headroom, another host is provisioned.

Identity/Workspace may later be extracted; Core then becomes Mail. Campaign starts with Control and Execution modules in one deployable. Delivery is the future extraction of Campaign Execution, not an extra service created from day one. Content starts with Template Management and Email Document & Compiler modules in one service.

### Phase 3 — Automation Runtime activation

Automation Runtime starts on dedicated VPS C. A, B, and C form a direct WireGuard full mesh with no transit host. Runtime uses separate API, scheduler, and worker processes, its own database and identity, and direct authenticated access to owned dependencies. The complete A-B-C latency, capacity, routing, failure, and cost model is recalculated before activation; earlier A-B measurements are not extrapolated.

## 5. Bounded-context catalog

| ID | Context | Owns | Initial deployable and placement | Does not own |
|---|---|---|---|---|
| SVC-001 | Identity/Workspace | Better Auth integration, users, workspaces, memberships, invitations, teams, RBAC, tenancy context, session validation, and trust issuance | Core module on VPS A; extracted later only with evidence | Frontend, domain resources of other services, or cross-service business authorization decisions |
| SVC-002 | Mail | Mailboxes, inbound/outbound mail, threads, messages, drafts, attachments, inbox state, Resend adapter, delivery attempts, reconciliation, and provider policy | Core module/API/worker on VPS A; becomes Mail when Identity is extracted | Campaign orchestration, templates, or contact truth |
| SVC-003 | Audience | Contacts, lists, typed segment rules, tags, notes, deduplication, suppression audiences, imports/exports, snapshots, and audience health | First independent service; API/worker on VPS B | Campaign execution, provider sending, or direct access to Mail data |
| SVC-004 | Campaign | Control owns definitions and launch intent; Execution owns batches, recipients, throttling, semantic retries, progress, and telemetry | One service with isolated modules, initially eligible for VPS B after its gate | Resend credentials and technical provider reconciliation |
| SVC-005 | Delivery | Future independent form of Campaign Execution | Extracted only on scale, SLO, failure, database, or release evidence | Resend by default; provider ownership remains with Mail |
| SVC-006 | Content | Templates, reusable blocks, `EmailDocument`, variables, versions, compilation, validation, brand/localization assets, and immutable render artifacts | One API/compiler-worker service, initially eligible for VPS B after its gate | Puck runtime types, React elements, campaign execution, or provider delivery |
| SVC-007 | Workflow | Graph drafts, revisions, validation, publication, immutable versions, runtime-plan compilation, templates, and control-plane state | Independent API/worker service; placement evaluated before implementation, with VPS B only if it passes capacity/isolation gates | Workflow instance execution, delays, retries, provider actions, or contact journeys |
| SVC-008 | Automation Runtime | Triggers, instances, transitions, delays, branching, joins, concurrency, retries, recovery, DLQ, action orchestration, and journey state | Dedicated VPS C; API, scheduler, and worker processes | Visual graph authoring or another service's provider/domain rules |
| SVC-009 | Analytics | Immutable analytical ingestion, projections, KPIs, funnels, cohorts, reporting, and exports | Independent service when analytics scope begins; physical placement remains gate-driven | Direct operational database reads or UI rendering configuration |
| SVC-010 | AI | Generation, RAG, knowledge ingestion, provider/model routing, brand voice, usage, evaluations, and AI audit | One late-stage TypeScript service with specialized internal orchestrators; placement remains gate-driven | Source-domain databases, autonomous consequential authority, or unrestricted model selection |
| SVC-011 | Billing | Stripe integration, plan versions, subscription projection, entitlements, quotas, trials, invoices, and lifecycle policy | Independent API/worker service co-located on VPS A initially | Product-domain authorization enforcement or direct payment-card storage |
| SVC-012 | Audit | Product audit decisions and future central projections | Append-only records begin locally; central projection is event-fed later | Operational log storage or tenant-content observability |

## 6. Communication and consistency register

| ID | Decision | Accepted rule |
|---|---|---|
| COM-001 | API protocol | REST/JSON with producer-owned OpenAPI; every API begins at `/api/v1`. |
| COM-002 | Versioning | Breaking changes introduce a coexisting major version and migration window. |
| COM-003 | Browser ingress | Browser traffic enters the Gateway after it exists. Direct service calls remain internal. |
| COM-004 | Synchronous depth | After ingress, the owning service may make at most one justified downstream synchronous call. Zero is preferred. |
| COM-005 | Composition | Gateway may perform bounded parallel presentation composition; sequential multi-service chains are prohibited. |
| COM-006 | Long work | Variable or recoverable work returns `queued`/`processing` and runs as a job, choreography, or service-owned saga. |
| COM-007 | Deadlines | Ordinary interactive requests have a two-second failure boundary; downstream deadlines are shorter than the remaining upstream budget. |
| COM-008 | Events | Immutable past-tense facts; minimal payload; correlation, causation, version, identifiers, and timestamps. |
| COM-009 | Commands | Addressed requests to a specific consumer; durable commands do not contain expiring auth tokens. |
| COM-010 | Delivery semantics | At least once, idempotent consumers, transactional outboxes, inbox/deduplication, DLQs, and reconciliation. |
| COM-011 | Coordination | Choreography for independent reactions; a service-owned saga for stateful multi-step outcomes and compensation. |
| COM-012 | Local projections | Stable remote facts are projected locally; services do not reproduce joins through synchronous calls. |
| COM-013 | Contract ownership | Producer publishes OpenAPI, AsyncAPI, or event schemas; consumers generate clients or validate from those artifacts. |
| COM-014 | Shared packages | Only technical envelope primitives may be shared. Cross-service domain entities and business rules are forbidden. |
| COM-015 | RabbitMQ payload security | Broker credentials and ACLs authenticate routes; durable messages carry stable authorization IDs/generations and current domain checks, never bearer tokens. |

Provisional first-distribution targets are: Identity Redis session validation p95 ≤ 75 ms, PostgreSQL fallback p95 ≤ 150 ms, A-B internal transport overhead p95 ≤ 100 ms, per-attempt internal timeout 250 ms, common external reads p95 ≤ 400 ms, common writes p95 ≤ 500 ms, async acceptance p95 ≤ 300 ms, and common endpoint p99 ≤ 1 second. These are engineering targets, not customer SLAs, and are revised only from recorded telemetry.

## 7. Tenancy, membership, and authorization register

| ID | Decision | Accepted rule |
|---|---|---|
| TEN-001 | Tenant key | `workspace_id NOT NULL` on every tenant-owned table. |
| TEN-002 | Relational isolation | Composite tenant-aware constraints and indexes prevent cross-workspace references, not merely `WHERE workspace_id = ...`. |
| TEN-003 | Database policy | PostgreSQL RLS plus `FORCE ROW LEVEL SECURITY`; application role is neither superuser nor `BYPASSRLS`. |
| TEN-004 | Transaction context | A verified membership-derived workspace context is installed with `SET LOCAL app.workspace_id`. |
| TEN-005 | Defense in depth | Application queries still scope by workspace; RLS is a second barrier. Automated tests attack cross-tenant reads and writes. |
| TEN-006 | Service data isolation | No cross-service joins, foreign keys, credentials, migrations, or transactions. Logical databases may share a physical paid cluster initially. |
| TEN-007 | Membership | Workspace membership is mandatory and sufficient. A member may have zero teams. |
| TEN-008 | Teams | Teams are optional authorization scopes; a user may belong to several teams. They never become tenants or replace membership. |
| TEN-009 | Roles | Exactly one owner; admins have almost all management rights but cannot manage admins or replace the owner; ordinary members receive granted operational capabilities. |
| TEN-010 | Permissions | Named capabilities, default deny, workspace/team resource scope, additive resource grants, no initial explicit deny or arbitrary global per-user override. |
| TEN-011 | Platform administration | Separate internal realm for operational health, recovery, abuse, domain, and billing status. No impersonation, tenant-dashboard browsing, or email-content access. |
| TEN-012 | Reactivation | During grace, restore the same workspace; after purge, create an empty workspace with a new UUID linked to the tombstone. Deleted content is never restored. |

## 8. Authentication and distributed trust register

| ID | Decision | Accepted rule |
|---|---|---|
| AUTH-001 | Browser session | Revocable opaque session ID in `HttpOnly`, `Secure` cookie; PostgreSQL canonical store; CSRF, rotation, session/device management. |
| AUTH-002 | MFA | Owner/admin: password plus mandatory TOTP. Member: password plus email OTP on first/new device with a 30-day trusted-device policy. |
| AUTH-003 | Library boundary | Better Auth is provisional and owns identity/session/MFA records only. MailFlow owns workspace, membership, teams, invitations, RBAC, and authorization. Organization plugin is not used. |
| AUTH-004 | Atomic signup | Same-transaction integration if proven; otherwise idempotent pending identity, transactional workspace/owner creation, activation, retry, and compensation. |
| AUTH-005 | Session ingress | MVP uses an in-process check. Distributed Gateway calls Identity once per authenticated external request; downstream services do not repeat it. |
| AUTH-006 | Session cache | Redis read-through cache remains inside Identity; PostgreSQL is canonical. Revocation invalidates cache; Redis loss falls back safely. |
| AUTH-007 | Routing | Signup only on the public landing page; MVP workspace path is `app.mailflow.com/w/{slug}`; future custom domains use central `auth.mailflow.com` authorization-code exchange. |
| AUTH-008 | Workload identity | Short-lived, audience-bound service token distinct from user delegation. Initial lifetime five minutes; proactive renewal near one minute remaining. |
| AUTH-009 | Delegation | Separate audience-bound user/workspace assertion, maximum two minutes or one request chain. Browser cookie/token is never a service credential. |
| AUTH-010 | Local validation | Every target validates signature, issuer, audience, type, time, algorithm, key ID, subject, scopes, and replay-relevant ID locally on every call. |
| AUTH-011 | Key ownership | Identity holds private signing keys and publishes public JWKS. Validators cache only public keys, refresh on schedule/unknown `kid`, and fail closed. |
| AUTH-012 | Authorization decision | Target combines verified claims with local projections, resource data, state, and invariants. Token validity is not permission. |
| AUTH-013 | Critical revalidation | Ownership transfer, admin management, purge, sensitive export, billing/security recovery, and similar actions may call Identity canonically. |
| AUTH-014 | Durable authorization | Jobs/events persist stable execution authorization identity and authorization generation, not expiring tokens; workers mint fresh workload credentials for later calls. |
| AUTH-015 | Host vs workload trust | WireGuard authenticates hosts and encrypts links; audience-bound app tokens and target authorization remain mandatory. |
| AUTH-016 | Connections | Each integration belongs to one workspace and one owning service; grants may target roles, teams, or members, while secrets never enter workflow definitions or shared packages. |
| AUTH-017 | Automation principal | Published workflows receive durable revocable execution authorization. Author departure does not silently stop an approved automation; explicit pause/revoke controls do. |

## 9. Mail-domain decisions

| ID | Decision | Accepted rule |
|---|---|---|
| MAIL-001 | Product inbox | MailFlow owns an organizational inbox; it does not synchronize Gmail or Outlook and does not operate a mail server. |
| MAIL-002 | MVP addressing | One MailFlow-owned Resend account and shared MailFlow domain. Each workspace receives one immutable globally unique slug-derived address such as `acme@inbox.mailflow.com`. A stable `Mailbox` plus address history prevents the visible address from becoming the identity key. |
| MAIL-003 | Future domains | Customer custom domains are future workspace capabilities and their infrastructure cost is recovered through Billing. |
| MAIL-004 | Provider ownership | Mail is the sole Resend owner for personal and campaign delivery, credentials, webhooks, quotas, retries, reconciliation, and delivery truth. |
| MAIL-005 | Inbound | Verify and idempotently persist webhook metadata, then fetch the provider message and temporary attachment URLs asynchronously. |
| MAIL-006 | Immutable evidence | Store provider JSON snapshot and attachment bytes in object storage; store normalized searchable fields in PostgreSQL. Raw MIME is not promised. |
| MAIL-007 | Provider continuity | Resend is an accepted MVP single point of failure. Port abstraction, explicit degraded states, bounded retries, circuit breaker, idempotency, and reconciliation constrain it. |
| MAIL-008 | Unknown outcomes | After Resend's finite idempotency window, unresolved delivery becomes `delivery_unknown`; a new attempt requires explicit user action and warning. |
| MAIL-009 | Pilot controls | Platform activation, configurable workspace/global quotas, suppression, kill switches, and sender-health review protect the shared domain. Planning starts at 20 outbound messages/workspace/day, five/minute/workspace, and a global ceiling of 80% of the current provider daily limit; all values are configuration and must be reverified before launch. |
| MAIL-010 | Threading | RFC message identifiers and reply references; subject-only grouping is forbidden. |
| MAIL-011 | Inbox state | Read/favorite are per-user; archive/trash are shared mailbox state; future labels/assignment are workspace/team state; drafts are author-owned. |
| MAIL-012 | Deletion | Trash retains 30 days. Authorized permanent purge requires warning and removes content, storage, search, and embeddings while retaining a minimal tombstone. |
| MAIL-013 | Search | MVP PostgreSQL lexical search over normalized metadata/body; no attachment-content or semantic search. |
| MAIL-014 | Drafts | PostgreSQL canonical autosave, roughly two-second debounce, optimistic version, Jotai local editor state, optional limited IndexedDB crash recovery. |
| MAIL-015 | Send lifecycle | Sending freezes an immutable snapshot and immediately shows `queued`; provider processing remains at least once and reconciled. |
| MAIL-016 | Attachment upload | Browser uses short-lived presigned `PUT` to private S3-compatible storage; backend owns key and validates completion/checksum/size. |
| MAIL-017 | Attachment limits | MVP: 10 MB per file, 20 MB per email, and 10 files. No database blobs. |
| MAIL-018 | Malware | Local isolated ClamAV, fail closed, bounded archive expansion, quarantine and purge, stored scanner evidence, no claim of perfect safety. |
| MAIL-019 | Rendering | Server sanitization, sandboxed iframe, restrictive CSP, remote images blocked by default, CID assets converted to authorized private assets. |

## 10. Data lifecycle, privacy, and sensitive credentials

| ID | Decision | Accepted rule |
|---|---|---|
| DATA-001 | Data visibility | MailFlow processes server-readable plaintext for product functions and is not zero knowledge. Encryption, access minimization, and redacted telemetry are mandatory. |
| DATA-002 | Cancellation | Workspace becomes read-only for 30 days; export/reactivation remain available while sending and mutations stop. Inbound mail is preserved. |
| DATA-003 | Purge | Idempotent cross-system deletion saga starts after grace or explicit early confirmation and removes operational data within 30 days. |
| DATA-004 | Backups | Encrypted backups expire under 30-day retention; deletion ledger is reapplied before any restore serves traffic. Worst-case normal-cancellation expiry is 90 days. |
| DATA-005 | Export | Asynchronous encrypted ZIP of documented JSON/CSV, normalized email, configuration, and attachments through a short-lived signed URL. |
| DATA-006 | Retention | Operational logs 30 days, security events 180 days, workspace audit 12 months; statutory billing retention requires legal/accounting review. |
| DATA-007 | LGPD roles | Customer is controller for organizational content; MailFlow is operator for it and controller for its own account/security/billing/abuse purposes. |
| DATA-008 | Legal review | DPA, privacy notice, retention, lawful bases, international transfers, and contracts require legal review; architecture is not legal advice. |
| DATA-009 | Platform secrets | Infisical owns deployment/runtime secrets. Domain code stays provider-neutral and browser configuration is never treated as secret. |
| DATA-010 | Tenant credentials | External customer credentials live encrypted in the owning service database behind a provider-neutral `CredentialCipher` and managed-KMS envelope boundary. |
| DATA-011 | Secret exclusion | Plaintext credentials are prohibited from RabbitMQ, Redis, workflow definitions, telemetry, browser payloads, and shared packages. |

## 11. Domain-specific technology decisions

### Audience and campaigns

- Audience uses TypeScript, Node.js 24, Hono, Zod/OpenAPI, PostgreSQL, Drizzle, RabbitMQ, R2, Pino, and OpenTelemetry.
- Segment definitions are a versioned typed rule AST compiled to parameterized SQL. PostgreSQL search, `pg_trgm`, set-oriented SQL, keyset pagination, and evidence-based indexes precede any dedicated search engine.
- Bulk operations are asynchronous. Redis may accelerate rebuildable state but is not Audience truth.
- Campaign begins as one deployable with isolated Control and Execution modules. It uses the default TypeScript/Node/Hono/PostgreSQL/Drizzle/RabbitMQ/Redis-observability stack, with Redis limited to appropriate ephemeral controls.
- Audience produces immutable destination-bound snapshots. RabbitMQ carries only a minimal ready fact; Campaign asynchronously retrieves bounded pages, verifies count/checksum/schema, and stores its minimal execution copy.
- Scheduled launches pin definition/template/personalization versions but resolve eligible recipients at execution time. Current suppression, unsubscribe, consent, deletion, safety, entitlement, and reputation controls remain dynamic overrides.
- Campaign sends versioned commands to Mail. Mail alone calls Resend and returns canonical technical delivery results.

### Content and visual email building

- Content uses TypeScript, Node.js 24, Hono, Zod/OpenAPI, PostgreSQL, Drizzle, R2, RabbitMQ, Pino, and OpenTelemetry; API and compiler worker share one image but are separate processes.
- `EmailDocument` is the canonical versioned, data-only document. Puck, React, JSX, raw MJML, and compiler types are adapters and never persisted as the product contract.
- Authoritative pipeline: validate/normalize `EmailDocument`, map to allowlisted MJML, compile, post-process/sanitize, emit HTML/plain-text immutable artifacts.
- MJML is selected over React Email because its constrained email layout model is closer to the customer-authored block document, not because only MJML can render server-side.
- React Email remains the fallback after a representative compatibility/complexity spike and may separately serve developer-authored platform emails.
- Puck is a conditional frontend-only visual editor. It owns transient canvas interaction, while server drafts, revisions, permissions, publication, preview, and rendering remain MailFlow-owned. Raw dnd-kit is the principal fallback.
- Tiptap is embedded only in rich-text blocks with a restricted schema.

### Workflow and Automation Runtime

- React Flow is the Workflow Builder canvas adapter only. MailFlow owns the versioned workflow definition, validation, history, publication, and runtime representation.
- Workflow uses TypeScript, Node.js 24, Hono, Zod/OpenAPI, PostgreSQL, Drizzle, RabbitMQ, Pino, and OpenTelemetry with separate API and worker processes.
- Publication is asynchronous: immutable artifact creation emits `WorkflowVersionPublished`; Runtime fetches, verifies, stores, and acknowledges with `WorkflowVersionIngested` or rejects with a typed fact. UI remains `publishing` until matching Runtime acknowledgement.
- Published and active versions are distinct. Existing instances remain pinned; cutover affects only new instances after the plan is durably accepted.
- Automation Runtime is a MailFlow-owned durable interpreter over PostgreSQL and RabbitMQ. It begins in TypeScript/Node.js because orchestration is primarily I/O-bound and the two-person team reuses its contracts and operations.
- Runtime state, leases, transitions, action operations, checkpoints, joins, delays, and capacity reservations are canonical in PostgreSQL. Redis accelerates only reconstructable rate and coordination state.
- Side effects use stable operation IDs, typed command/result contracts, idempotent owners, explicit unknown outcomes, and reconciliation. Runtime never embeds another service's business rule or provider SDK.
- Scheduler fairness is workspace-first with bounded dispatch quanta, aging, protected control lanes, and no plan-paid starvation before Billing and capacity evidence define a safe policy.
- Go is the preferred candidate for measured high-throughput/resource-sensitive specialized workers; Python for ML/scientific nodes. Temporal, Restate, and DBOS remain engine alternatives if custom-runtime correctness cost becomes disproportionate.

### Analytics

- Analytics consumes immutable events and owns analytical projections; it never queries operational databases directly.
- ClickHouse is selected conditionally for columnar event-scale analytics, subject to a mandatory representative comparison with TimescaleDB.
- Tenant isolation, deletion/reconciliation, recovery, contractual controls, and total operational cost are blocking gates. Any security/isolation failure selects TimescaleDB even if ClickHouse is faster.
- BigQuery remains a later serverless alternative when its operational and query-cost profile fits better.
- Apache ECharts is the browser visualization library behind a MailFlow React adapter. APIs return metric semantics, never ECharts options or executable formatter code.
- Business-critical charts require accessible summaries and tables; server aggregation/downsampling precedes browser rendering.

### AI and RAG

- AI is intentionally late and consumes stable service APIs/events; it never compensates for unfinished domains or reads their databases.
- Vercel AI SDK is the TypeScript integration/orchestration layer. OpenRouter is the primary generation and embedding gateway behind AI-owned ports and capability contracts.
- Clients request versioned capabilities, not arbitrary models. The capability registry owns approved aliases, providers, prompts, schemas, tools, budgets, privacy, fallback, and evaluation.
- Start with deterministic or minimally autonomous workflows. Consequential actions remain typed proposals reauthorized and approved by ordinary application commands.
- Customer content requires ZDR, provider allowlists, disabled prompt logging, reviewed DPA/subprocessors, minimum authorized context, and no unrestricted free models.
- PostgreSQL plus `pgvector` in the AI-owned database is the initial vector store. Start exact, add HNSW only from evidence, combine lexical and semantic retrieval when evaluation proves value.
- Every chunk/embedding carries workspace, source/version, access scope, classification, hashes, and model/chunking versions. RLS scopes tenant search; source authorization is revalidated before prompt assembly.
- Pinecone, Weaviate, Qdrant, and larger distributed engines are future candidates, selected only from tenant-isolation, recall, latency, deletion, scale, privacy, cost, and reversible-migration evidence.

### Billing

- Billing uses TypeScript, Node.js, Hono, PostgreSQL, Drizzle, OpenAPI, OpenTelemetry, and the official Stripe SDK behind a Billing-owned adapter.
- Stripe Checkout and Customer Portal own payment collection and common financial self-service. MailFlow never stores payment-card/bank details.
- Stripe webhooks are raw-body verified, idempotently persisted, processed asynchronously, and reconciled without relying on event order or browser redirects.
- Billing owns immutable plan versions and local entitlement snapshots. Target services enforce consumed projections locally; Stripe is never queried on ordinary product requests.
- Paid entitlement never bypasses security, abuse, suppression, provider, reputation, or infrastructure safety limits.

## 12. Approved stack register

| Layer | Selected choice | Status and boundary |
|---|---|---|
| Default backend language | TypeScript | Confirmed; polyglot services/workers must earn their operational cost. |
| Backend runtime | Node.js 24 LTS | Confirmed; Bun is a future measured runtime spike, not production default. |
| HTTP | Hono | Confirmed for small portable REST/OpenAPI services. |
| Validation/contracts | Zod and `@hono/zod-openapi` | Confirmed; runtime validation remains mandatory across all boundaries. |
| Operational database | PostgreSQL | Confirmed, with service-owned logical databases and RLS. |
| ORM/migrations | Drizzle ORM/Kit with `pg` | Confirmed; reviewed SQL migrations, no production `drizzle-kit push`. |
| MVP jobs | pg-boss | Confirmed until Audience extraction. |
| Distributed broker | RabbitMQ | Confirmed at Audience extraction; `amqplib` selected behind an adapter with recovery spike. |
| Ephemeral distributed state | Redis | Confirmed at Audience extraction only for explicit cache/rate/realtime/presence uses; `node-redis` selected. |
| Web framework | TanStack Start | Preferred, conditional on Cloudflare/session/SSR/productivity spike; React Router with Vite fallback. |
| UI | React and TypeScript | Confirmed. |
| Server state | TanStack Query | Confirmed. |
| Complex local state | Jotai | Confirmed for editor/unsaved UI state, never canonical server state. |
| Forms | React Hook Form plus Zod | Confirmed; Base UI fields use `Controller` where needed. |
| Components | shadcn/ui with Base UI | Confirmed; not Radix and not Uber Base Web. |
| Styling | Tailwind CSS, tokens, CSS variables | Confirmed. |
| Rich text | Tiptap OSS | Confirmed with restricted schema; no paid Cloud dependency. |
| Visual email editor | Puck | Conditional frontend adapter; raw dnd-kit fallback. |
| Email compiler | MJML | Conditional preferred compiler; allowlisted React Email adapter fallback. |
| Workflow canvas | React Flow | Confirmed as presentation adapter only. |
| Analytics charts | Apache ECharts | Confirmed with accessibility/performance re-evaluation gates. |
| AI integration | Vercel AI SDK | Confirmed inside AI-owned ports. |
| AI/model gateway | OpenRouter | Confirmed with adapter/privacy/availability gates. |
| Initial vector store | PostgreSQL plus pgvector | Confirmed in AI-owned database. |
| Analytical store | ClickHouse | Conditional on mandatory TimescaleDB comparison and tenant-security gates. |
| Email provider | Resend | Confirmed sole Mail-owned MVP provider. |
| Payments | Stripe | Confirmed sole Billing-owned initial provider. |
| Object storage | Cloudflare R2 | Confirmed behind S3-compatible port; MinIO locally. |
| Attachment scanning | ClamAV | Confirmed local MVP scanner behind a replaceable port. |
| Secrets | Infisical Cloud | Confirmed source of truth; paid transition occurs at the first independently permissioned runtime after Audience or another documented trigger. |
| Telemetry | OpenTelemetry, Pino, Collector, Grafana Cloud, Faro | Confirmed initial observability stack. |
| Infrastructure | OpenTofu, cloud-init, Ansible, Docker Compose, GitHub Actions | Confirmed with non-overlapping ownership. |
| Compute | OCI preferred; DigitalOcean fallback | OCI Free only for controlled pilot; paid compute required from explicit dependency/SLO/resource triggers. |

## 13. Infrastructure and operational register

| ID | Decision | Accepted rule |
|---|---|---|
| OPS-001 | Frontend edge | Cloudflare owns DNS, TLS, CDN/WAF, Workers with Static Assets, and R2. Cloudflare Pages is not selected. |
| OPS-002 | Storage environments | Separate private R2 buckets by environment, tenant-prefixed keys, least privilege, short presigned operations, and real R2 compatibility tests. R2 location hints are not strict data residency; contractual residency may select regional S3. |
| OPS-003 | Database production | Neon Launch paid in US East, scale-to-zero disabled, direct TLS, deliberate pools, provider PITR ≥ 7 days, daily logical backups to R2 retained 30 days. |
| OPS-004 | Database free tier | Neon Free only for disposable development/demos; it does not meet continuous jobs and recovery goals for production. |
| OPS-005 | Compute pilot | OCI Always Free A1 Ashburn when capacity exists, with non-contractual availability. Paid OCI preferred afterward; DigitalOcean portable fallback. |
| OPS-006 | Host portability | Multi-architecture GHCR images, external durable state, Cloudflare origin routing, Compose per host, OpenTofu/Ansible, deployment locks. |
| OPS-007 | IaC ownership | OpenTofu: cloud resources; cloud-init: first boot; Ansible: repeatable host config; Compose: container topology; Actions: orchestration. |
| OPS-008 | OpenTofu state | Dedicated private R2 bucket, per-environment state/credentials, client-side AES-GCM, native lockfile, CI concurrency, encrypted timestamped snapshots, recovery spike. |
| OPS-009 | MVP ingress | Outbound-only Cloudflare Tunnel, public origin ports closed, Caddy internal blue/green proxy. |
| OPS-010 | Deployment | Build once, immutable SHA image, expand migration, inactive color health/smoke, switch/drain, worker grace, later contract cleanup. |
| OPS-011 | Health | Liveness is process only; readiness covers initialization/PostgreSQL. Provider failures degrade capabilities rather than restart the entire API. |
| OPS-012 | CI/CD | Trunk-based `main`, PR validation, automatic homologation after merge, smoke/E2E, then promotion of the same artifact to production. |
| OPS-013 | Environments | Development, isolated homologation/staging, and production. Local external dependencies use containers/fakes; homologation proves managed-provider behavior. |
| OPS-014 | Secrets identities | MVP uses one project with development/staging/production and `/core`, `/web`, `/shared`; human, CI OIDC, and per-runtime machine identities remain distinct. At Audience extraction, Free-plan project membership splits Core and Audience, and VPS A/B never share credentials. |
| OPS-015 | Observability | OpenTelemetry from MVP, host-local Collectors after extraction, Pino JSON logs, Grafana Cloud, Faro, privacy/cardinality controls. |
| OPS-016 | Initial SLO | 99.5% monthly target, HTTP p95 < 500 ms, inbound visible ≤ 60 s, outbound processing starts ≤ 30 s under normal conditions; aspirational on free compute. |
| OPS-017 | Recovery | RPO 15 minutes, RTO 4 hours, encrypted backups, and periodic restore drills. |
| OPS-018 | Geography | US East logical region, English launch UI, i18n from the start, UTC storage and user-timezone rendering. |
| OPS-019 | Identifiers | UUIDv7 where sortable global identity helps; preserve correlation/causation and external idempotency keys. |

## 14. Testing quality gates

| Layer | Choice and invariant |
|---|---|
| Unit/application | Vitest for TypeScript domain, application, frontend, worker, retry, idempotency, and invariant tests. |
| React behavior | React Testing Library plus `user-event`, centered on user-observable accessible behavior. |
| Frontend HTTP | MSW at the network boundary; fixtures remain contract-validated. |
| Integration infrastructure | Testcontainers with real PostgreSQL and, after extraction, real RabbitMQ and Redis. |
| Browser E2E | Playwright; Chromium on PRs, cross-browser in homologation/scheduled gates. |
| Tenancy | Real migrations, restricted application role, RLS and deliberate cross-workspace attack tests. |
| Contracts | OpenAPI/event schema compatibility and breaking-change detection in CI. |
| Distributed | Outbox-to-broker-to-consumer-to-own-database-to-query E2E, duplicates, out-of-order events, DLQ, restart, reconnect, partition, and reconciliation. |
| Email provider | Domain fake, MSW Resend adapter tests, and a small safe-address real contract suite in homologation. No Mailpit/MailHog because SMTP is not the product path. |
| Risk policy | No universal coverage percentage replaces assertions for tenancy, authorization, idempotency, retries, delivery uncertainty, autosave conflicts, purge, restore/deletion, and lease recovery. |
| QA identity | Dedicated QA users/workspaces; no customer credentials or production tenant data. |

## 15. Decision gates and fallbacks

### Blocking implementation spikes

| ID | Preferred choice | Mandatory proof | Accepted fallback |
|---|---|---|---|
| GATE-001 | Better Auth | Transaction/pending signup, session, MFA, recovery, and schema integration | Replace or adapt the auth library without transferring MailFlow authorization ownership |
| GATE-002 | TanStack Start | Cloudflare deployment, session bootstrap, SSR/prerender, security headers, and productivity | React Router with Vite |
| GATE-003 | Puck | Lossless `EmailDocument`, email nesting, accessibility, performance, Base UI, upgrades, preview mapping | Bounded raw dnd-kit or another isolated editor adapter |
| GATE-004 | MJML | Representative client output, accessibility, deterministic artifacts, compile cost, custom-block effort | Allowlisted React Email adapter behind the same compiler port |
| GATE-005 | ClickHouse | Tenant isolation, performance vs TimescaleDB, deletion/reconciliation, cost, recovery, contract controls | TimescaleDB; security failure overrides speed |
| GATE-006 | OpenRouter AI SDK adapter | Compatibility, structured output/tools, privacy/routing, errors, and contract tests | AI SDK OpenAI-compatible adapter, official SDK, or direct provider adapter |
| GATE-007 | `amqplib` | TLS, reconnect, topology/channel/consumer recovery, confirms, outbox republish, graceful shutdown | Add `amqp-connection-manager` only inside the infrastructure adapter |
| GATE-008 | R2 OpenTofu state | Conditional locking, encryption, recovery snapshots, RPO, and concurrency | Managed backend or versioned object store |
| GATE-009 | Token implementation | Algorithms, exchange, signing, JWKS, rotation, revocation, outage, and library compatibility | Replace implementation while retaining the trust model |

### Evidence-triggered re-evaluation

The following are deliberate gates, not scheduled migrations:

- Free to paid compute: daily customer dependency, contractual SLO, capacity/reclaim events, or sustained pressure.
- Logical to physical database separation: independent scale, blast radius, compliance, noisy neighbor, or recovery needs.
- PostgreSQL search/vector to specialized storage: measured relevance, latency, scale, isolation, or maintenance failure.
- pgvector to dedicated vector database: filtered recall/SLO, index/maintenance pressure, ingestion interference, horizontal scale, or better measured total cost/reliability.
- Resend free/shared domain to paid/custom domains: quota, reputation, or a customer purchase.
- Pilot quotas to plan policy: Plans & Billing implementation, while safety ceilings remain independent.
- ClamAV to managed scanning: throughput, latency, operational, signature, or compliance pressure.
- Node.js to Bun: proven compatibility, stability, observability, and meaningful cost/performance gain.
- TypeScript to Python/Go: workload evidence exceeds the polyglot operational cost.
- Free to paid RabbitMQ/Redis: active dependency, contractual availability, incidents, projected hard-limit use, unsafe fallback, or business impact.
- WireGuard to workload-aware transport: dynamic/many hosts, regions/providers, certificate identity, policy, compliance, or static-key operational failure.
- Infisical paid/alternative: first independently permissioned runtime after Audience, sixth identity, direct homolog runtime, path RBAC, version/PITR, audit, or availability requirements.
- Observability expansion: Grafana/Faro triage, retention, ingestion, export, or contractual on-call requirements no longer fit.
- Another provider/service placement: only after its documented latency, cost, capacity, failure-domain, and security gate.

## 16. Deliberate deferrals

- Exact AI generation model/provider allowlists.
- Exact embedding provider/model, dimensions, and evaluation winner.
- Dedicated vector database product.
- Physical host placement for later services not already assigned to Audience/VPS B, Billing/VPS A, or Runtime/VPS C.
- Exact managed KMS vendor, region, SDK, and operational policy before the first workspace-owned external credential integration. The envelope-encryption boundary itself is already fixed.
- Future custom-domain onboarding and pricing details beyond Billing cost recovery.
- Historical `.mbox`/`.eml` import.
- Advanced collaborative editing semantics such as CRDT/OT.

## 17. Baseline coverage manifest

This manifest makes omission detectable. Every normative baseline section has an explicit consolidation destination.

| Baseline section | Consolidation coverage |
|---|---|
| 1. Product and delivery strategy | Sections 2 and 4 |
| 2. Architectural evolution | Sections 2–4 |
| 3. Service boundaries | Section 5 |
| 4. Communication and contracts | Section 6 |
| 5. Repositories | ARC-007 and Phase 0 |
| 6. Tenancy, data ownership, authorization | Section 7 |
| 7. Authentication and service identity | Sections 8 and 10 |
| 8. Email provider, addressing, routing | Section 9 |
| 9. Composer, drafts, delivery | MAIL-014 and MAIL-015 |
| 10. Attachments and email-content security | MAIL-016 through MAIL-019 |
| 11. MVP asynchronous processing and realtime | Phases 0–1, Sections 6 and 12 |
| 12. Data lifecycle and privacy | Section 10 |
| 13. AI, analytics, content, workflow, automation | Section 11 and corresponding gates |
| 14. Backend stack and Billing | Sections 5, 11, and 12 |
| 15. Frontend stack | Section 12 and GATE-002/GATE-003 |
| 16. Infrastructure | Sections 4, 12, and 13 |
| 17. Delivery, testing, operations | Sections 13 and 14 |
| 18. Geography and localization | OPS-018 |
| 19. Identifiers and lifecycle conventions | OPS-019 plus COM-008/COM-010 |
| 20. Architecture decision status | Sections 1, 15, and 16 |
| 21. Decision gates | Section 15 |
| 22. Documentation still to produce | Section 18 |

## 18. Required derived artifacts

The architecture repository must derive and maintain:

- A dedicated Astro and TypeScript application managed with Bun, static-first and ready for owner-managed Vercel deployment. It lives in its own child directory under the MailFlow workspace and preserves the normative baseline under `docs/architecture/`.
- Repository-level source-of-truth rules, a stable decision catalog, a baseline coverage manifest, and automated drift checks. UI, code, and persisted documentation are written in English.
- Context, container, component, deployment, data-flow, trust-boundary, provider-ownership, and evolution diagrams.
- Separate visual modes for the modular MVP, first distributed topology, and three-host Automation topology.
- A distributed authentication diagram that distinguishes private signing keys, public JWKS caching, workload identity, delegated identity, local validation, authorization projections, critical live revalidation, and durable RabbitMQ authorization evidence.
- A communication diagram contrasting a shallow synchronous path and bounded parallel Gateway composition with a prohibited sequential chain and its asynchronous/projection alternatives.
- A provider diagram showing Mail as sole Resend owner and Campaign/Delivery communicating through contracts.
- A credential diagram separating Infisical platform secrets from encrypted tenant integration credentials and excluding plaintext from all unsafe transports/stores.
- Per-service stack cards containing responsibility, fit, trade-offs, alternatives, and evidence-triggered re-evaluation.
- ADRs for material choices and future approved changes.
- Implementation epics/stories, including strangler extraction and refactoring sprints.
- A non-technical client Word document under `docs/client/`, excluded from the rendered/public application, limited to the MVP and its delivery expectations. Its schedule ranges explicitly include study, experimentation, understanding, and validation time proportional to complexity, and it remains suitable for manual PDF export.

## 19. Change-control protocol

Every architecture change must:

1. Identify the affected decision IDs and baseline sections.
2. Record the reason and evidence, not only the new technology or diagram.
3. Classify the change as clarification, fallback activation, evidence-based re-evaluation, or material architecture revision.
4. Update the normative baseline first or in the same change.
5. Update this consolidation, diagrams, descriptive pages, stack cards, implementation plans, and affected client commitments.
6. Re-run coverage/drift checks before merge.

Fallback activation at a documented blocking gate does not automatically reopen service ownership, tenancy, trust, or communication boundaries. Any change to those boundaries requires a new explicit architecture decision.

## Listening

This consolidation introduces stable decision identifiers and a section-to-section coverage manifest so the architecture website can remain navigable and detect drift without duplicating the entire normative baseline. The rejected alternative was to rewrite the full baseline as another comprehensive narrative; that would create two competing authorities and make future synchronization less reliable. Detailed motivations, references, operational procedures, and edge cases intentionally remain in `architectureBaseline.md`, while this document provides the compact map used by derived artifacts.
