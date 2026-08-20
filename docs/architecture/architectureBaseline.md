# MailFlow Architecture Baseline

Status: architecture approved, closed, and consolidated; derivative artifact production in progress  
Last updated: 2026-08-20  
Purpose: canonical input for the architecture website, implementation plans, ADRs, and the non-technical client document.

This document records the approved architecture, confirmed stacks, mandatory implementation-validation gates, and deliberate deferrals. A validation spike may activate an already documented fallback, but it does not reopen the accepted boundaries unless its evidence requires a new explicit architecture decision.

## 1. Product and delivery strategy

MailFlow is a multi-tenant SaaS for organizational email, followed by audience management, marketing campaigns, reusable content, workflow automation, analytics, AI-assisted work, and billing. It is being built by two developers, with one to three initial MVP customers. Production usefulness and deliberate architectural learning are both project goals.

### MVP scope

The MVP includes:

- Project Setup & Foundation.
- Inbox.
- Email Viewer.
- Email Composer.
- Workspace member invitations and member management.
- Workspace roles: owner, admin, and member.
- Email attachments.

The MVP excludes:

- Teams as a user-facing feature, while preserving the future team model.
- Permission-matrix administration.
- Workspace preferences and several advanced inbox/composer conveniences.
- Reusable signatures, scheduled send, recipient suggestions, draft version history, keyboard shortcuts, labels, and categories.
- Gmail and Outlook synchronization.
- Historical email import.
- Customer-owned email domains.

Historical `.mbox` or `.eml` import may be added later. Its absence is an explicit MVP trade-off.

## 2. Architectural evolution

### MVP shape

The MVP is a modular system, not a premature microservice estate:

- One independently deployed web application.
- One Core backend repository and deployable image.
- Separate API and worker processes built from the same backend repository and image.
- PostgreSQL as the canonical database and durable job queue substrate.
- Cloud object storage for provider snapshots and attachments.
- No internal event-driven architecture or event bus in the MVP.

The worker is not a microservice. It is an asynchronous execution process for the same Mail domain and shares its code, schema, business rules, and database.

### Target distributed shape

Event-driven architecture begins when Contact/Audience becomes the first extracted business service. At that point MailFlow introduces:

- RabbitMQ for durable integration events, asynchronous commands, routing, retries, and dead-letter queues.
- Redis for workloads that need ephemeral low-latency state, such as distributed rate limiting, cache, presence, and realtime fan-out.
- Transactional outboxes and idempotent consumers.
- Service-owned databases, credentials, migrations, and authorization boundaries.
- An API Gateway/BFF that remains thin and owns no business domain.
- A second VPS dedicated to the Audience API and worker. The Core/Gateway/Mail/Identity workload remains on VPS A, while Audience becomes the first independently hosted business service on VPS B.
- VPS A and VPS B use the same selected compute provider and US region, with provider-private networking and separate fault domains where available. OCI is the preferred path through VCN/NSGs; DigitalOcean is the portable fallback through VPC/cloud firewalls. Audience extraction begins with a point-to-point WireGuard tunnel between VPS A and VPS B. Automation Runtime activation evolves this into a direct A-B-C full mesh, while workload/delegation tokens continue to protect service traffic.

RabbitMQ and Redis are not MVP dependencies. Running them early would increase memory, I/O, deployment, monitoring, and failure-handling work without supplying a needed distributed capability. RabbitMQ on the same single VPS would not provide high availability, and reliable quorum deployment requires multiple nodes.

### Strangler sequence

1. Start with Identity/Workspace and Mail as modules inside Core, with separate schemas/migrations and explicit module interfaces.
2. At Contact/Audience scope, add the thin Gateway, extract Audience with its own logical database and credentials onto VPS B, and introduce RabbitMQ, Redis, WireGuard host networking, and outbox delivery. VPS A retains Gateway, Identity/Workspace, Mail, Mail worker, and ClamAV.
3. Extract Identity/Workspace when independent ownership or scaling warrants it; Core then becomes the Mail service.
4. Continue extracting only when a real domain boundary, load profile, reliability need, or team ownership justifies it.

Vertical slices organize features inside each bounded context. Clean-ish architecture keeps domain/application code behind explicit ports without imposing ceremony everywhere. Module boundaries must forbid cross-schema joins, foreign keys, and transactions so extraction is mechanical rather than a rewrite.

## 3. Service boundaries

Planned bounded contexts are:

- **Identity/Workspace**: authentication integration, users, workspaces, membership, invitations, teams, RBAC, and tenancy context. It is not the frontend and is broader than authentication.
- **Mail**: mailboxes, inbound and outbound email, threads, messages, drafts, attachment orchestration, and per-user/shared inbox state.
- **Audience**: contacts, lists, segments, deduplication, suppression audiences, and audience health.
- **Campaign**: begins as one deployable bounded context with isolated Campaign Control and Campaign Execution modules. Control owns definitions, audience selection, configuration, schedules, goals, drafts, versions, validation, and launch intent. Execution owns batches, recipient execution state, campaign-level throttling, semantic retry decisions, progress, and delivery telemetry. Mail remains the sole owner of Resend provider access and technical delivery reconciliation.
- **Delivery**: a future extraction target for the Campaign Execution module, not an additional initial service. It is extracted only when its scale, failure, release, database, or SLO profile justifies an independent deployable. It retains campaign orchestration and calls Mail through the existing contracts; it does not own Resend by default.
- **Content**: templates, reusable blocks, visual-builder documents, variables, compilation, validation, brand assets, localization, and version history.
- **Workflow**: automation control plane: graph authoring, validation, drafts, publication, versioning, and templates.
- **Automation Runtime**: data plane: triggers, workflow instances, nodes, delays, branching, concurrency, retries, recovery, and DLQ behavior.
- **Analytics**: event-fed analytical projections, reporting, KPIs, funnels, cohorts, and exports. It does not query operational service databases directly.
- **AI**: AI generation and RAG orchestration, knowledge ingestion, provider management, usage, brand voice, and AI audit data. It fetches authorized source data through service APIs and events rather than reading their databases.
- **Billing**: Stripe integration, subscriptions, invoices, entitlements, usage, trials, and lifecycle actions.
- **Audit**: initially local append-only audit records with a future central projection fed by service events.

Workflow and Automation Runtime are separate because they have different consistency, availability, and scaling profiles, not because Workflow is merely a frontend. The single MailFlow web application supplies the UI for both.

## 4. Communication and contracts

### Synchronous communication

- External and internal application APIs use REST/JSON with OpenAPI.
- Every API is versioned, beginning at `/api/v1`.
- Breaking changes introduce a coexisting major version and a migration window.
- Browser traffic enters through the Gateway after it exists.
- Direct service-to-service calls are allowed for justified internal workflows and do not loop through the Gateway.
- The Gateway does not access domain databases, implement domain rules, or publish domain events on behalf of services.

Interactive synchronous-depth policy:

- After authenticated ingress, the Gateway calls the service that owns the requested capability. That owning service may make at most one justified downstream synchronous service call in the interactive path.
- The mandatory Gateway-to-Identity opaque-session validation is an ingress trust step. Any later critical live Identity revalidation counts as the owning service's one downstream synchronous dependency.
- A sequence such as `Gateway -> Mail -> Audience -> Campaign -> Content` is prohibited even when every individual call is fast in local development or the modular MVP. Sequential latency, timeout probability, and cascading-failure risk multiply once Audience moves to VPS B and later services receive independent hosts.
- When one response needs independent data from several domains, the Gateway may perform bounded parallel API composition after authentication. It returns only the composition required by that user-facing use case and does not become a general data-joining domain.
- The primary service must not call another service merely to reproduce a join. Stable remote facts needed on frequent paths are consumed through events into minimal local projections with freshness and reconciliation controls.
- A process requiring multiple dependent steps, durable recovery, compensation, or a variable-duration external provider uses an outbox plus choreography, a service-owned saga, or a durable job rather than holding an interactive request chain open.
- Long or variable work returns an accepted domain state such as `queued` or `processing` and exposes progress through the accepted realtime/query mechanisms. Resend delivery, bulk work, imports/exports, campaign execution, AI generation beyond an explicit interactive budget, and automation execution are evaluated under this rule.
- A synchronous exception must document why current data and immediate completion are required, its owner, deadline, degraded behavior, idempotency/retry semantics, and trace evidence. More than one downstream synchronous dependency requires an explicit architecture decision, not an incidental client call.
- Calls are deadline-aware and propagate correlation, causation, trace, workspace, workload identity, and delegated actor context. The downstream deadline is shorter than the remaining upstream request budget.
- Automatic retries never multiply a non-idempotent call chain. Safe/idempotent reads may receive a bounded retry only when the remaining end-to-end deadline permits it.

This is a maximum, not a target: the preferred owning-service request has no downstream dependency. The rule is enforced through design review, generated service clients, distributed traces/service maps, integration tests for degraded dependencies, and latency-budget alerts.

#### Provisional distributed latency budgets

These are engineering targets for the first two-VPS topology, not contractual customer SLAs:

- Identity session validation from its Redis cache: p95 at or below 75 ms.
- Identity session validation with canonical PostgreSQL fallback: p95 at or below 150 ms.
- A synchronous internal call between VPS A and VPS B, excluding material domain work: p95 at or below 100 ms.
- Per-attempt internal-call timeout: 250 ms and always shorter than the remaining upstream deadline.
- Common external read: p95 at or below 400 ms.
- Common synchronous external write: p95 at or below 500 ms.
- Acceptance of an asynchronous operation into `queued` or `processing`: p95 at or below 300 ms.
- Common external endpoint: p99 at or below one second.
- Maximum ordinary interactive request deadline: two seconds.

The two-second deadline is a failure boundary, not a permission to wait before responding. Provider calls and variable-duration work such as Resend delivery, attachment processing, campaigns, AI generation, and automation execution return a durable asynchronous state when they cannot reliably complete inside their explicit interactive budget. Retries must fit inside the original deadline and remain limited to safe or idempotent operations.

OpenTelemetry records warm and cold p50/p95/p99 values separately across Gateway, Identity, Redis/PostgreSQL fallback, WireGuard, target service, and target database. Homologation load and fault tests validate the targets before Audience production extraction. Revise the numbers from representative evidence when a target is either routinely missed despite ordinary tuning or so loose that it fails to detect a user-visible regression; record every revision rather than silently normalizing degraded performance.

Automation Runtime activation on VPS C triggers a new three-host baseline. The A-B measurements remain historical evidence, not a valid proxy for every path. Homologation and production telemetry measure A-B, A-C, and B-C independently under representative warm, cold, idle, concurrent, degraded, and recovery conditions. The review includes p50/p95/p99 request latency, connection establishment, DNS and WireGuard overhead, throughput, packet loss, timeout and circuit-breaker behavior, host and service resource contention, and complete user-facing or asynchronous-path latency. A-B is measured again because added services and traffic can invalidate its earlier headroom even when its physical route has not changed.

The same stage refreshes the cost model using then-current provider prices and measured traffic. It records VPS C compute and storage, backup, monitoring and log ingestion, secret and deployment operations, managed database/broker/cache connections and traffic, and any applicable private, cross-zone, public, or provider egress charges for each path. The number of WireGuard peer relationships is an operational-complexity input; billable cost depends on the actual infrastructure and traffic path and must not be inferred from tunnel count alone. Existing interactive deadlines and synchronous-depth limits remain constraints. They are changed only through an explicit evidence-backed architecture decision, not merely because the topology gained another host.

### Asynchronous communication

- Events are immutable past-tense facts; commands request a specific recipient to attempt an outcome.
- Event payloads contain the smallest justified integration data, identifiers, version, timestamps, correlation, and causation metadata.
- Services build local projections instead of reaching into another service's database.
- Independent reactions use choreography. A service-owned saga coordinates multi-step processes that require state, compensation, or a defined outcome.
- Consumers are idempotent and delivery is treated as at least once.
- Reconciliation repairs missed or inconsistent derived state.

### Contract ownership

- Each producer owns and publishes generated OpenAPI, AsyncAPI, or event-schema artifacts.
- Consumers generate typed clients or validate messages from those artifacts.
- A small shared package may contain only technical envelope primitives such as identifiers, correlation metadata, and pagination.
- There is no shared package containing cross-service domain entities or business rules.

## 5. Repositories

Use progressive polyrepos:

- `mailflow-web` for the web application.
- `mailflow-core` for the MVP API and worker.
- A new repository is created only when a bounded context becomes a real independent deployable service.

Turborepo is not part of the architecture. The API and worker remain in the same backend repository because they share one bounded context and are released from the same codebase.

## 6. Tenancy, data ownership, and authorization

Workspace and tenant mean the same thing.

### PostgreSQL tenancy rules

- Every tenant-owned table has `workspace_id NOT NULL`.
- Tenant relationships use composite constraints that include `workspace_id` where needed to prevent cross-tenant references.
- Tenant-leading indexes support both isolation predicates and access paths.
- PostgreSQL Row-Level Security and `FORCE ROW LEVEL SECURITY` provide defense in depth.
- The application database role has neither superuser nor `BYPASSRLS` privileges.
- Each transaction applies a verified workspace context with `SET LOCAL app.workspace_id`.
- The workspace context comes from authenticated membership, never directly from an untrusted input.
- Automated isolation tests attempt cross-workspace reads and writes.
- Global tables require an explicit justification.

Application queries still include explicit workspace scoping. RLS is a second barrier, not a replacement for correct queries.

### Database per service

Each extracted service owns a logical database, database credentials, migrations, and RLS policies. It prohibits cross-service database access, joins, foreign keys, and transactions.

Database per service does not require a separate paid physical cluster for every service. Early services may use isolated logical databases inside the same paid Neon project/cluster. Physical separation is triggered by load, blast radius, compliance, availability, or operational autonomy. Free databases are limited to disposable development or demos, not production service fragmentation.

### Membership and teams

- Workspace membership is mandatory and sufficient for belonging to a workspace.
- Team membership is optional and never replaces workspace membership.
- A member may belong to zero, one, or multiple teams.
- Team scope can grant access to resources without weakening the tenant boundary.
- The future model includes `teams`, `team_memberships`, and resource access such as `mailbox_team_access`.

### Roles and permissions

- Exactly one workspace owner exists at a time. The operational role may be named `workspace_super_admin`, but its product meaning is owner.
- Admins have almost all workspace administration permissions but cannot manage other admins or replace the owner.
- Members receive ordinary email capabilities.
- Only the owner manages admins.
- Permission checks use named capabilities, default deny, and workspace or team resource scope.
- Teams may receive capability bundles. There is no explicit deny and no arbitrary per-user override of global role capabilities in the initial model. A resource contract may still support an additive, workspace-scoped grant to an individual member, such as access to a mailbox or provider connection; this does not mutate the member's global role.
- A member may read, reply, compose, archive, mark read/unread, and favorite according to granted access, but cannot delete/purge or administer the workspace by default.

### Platform administration

`platform_admin` is a separate internal MailFlow realm, hosted separately (planned `admin.mailflow.com`). It supports operational health, domain/billing status, recovery, abuse handling, and audited reactivation at any time. During grace it restores the retained workspace; after purge it creates an empty workspace with a new UUID and never restores deleted content.

Platform administrators cannot impersonate tenant users, browse tenant dashboards, or read email content. Production database operations use separate audited access, sanitized observability, and read-only privileges where possible. This operational access is not exposed as a product feature.

## 7. Authentication and service identity

### Browser authentication

- Browser sessions use revocable opaque session identifiers in `HttpOnly`, `Secure` cookies backed by PostgreSQL.
- Apply CSRF protection, session rotation, device/session management, and no long-lived browser JWT in local storage.
- Owner and admin accounts use password plus mandatory TOTP.
- Members use password plus email OTP on first or new devices, with a 30-day trusted-device policy.
- Password reset, MFA recovery, and active-session revocation are included.
- Social login, magic links as the primary method, and passkeys are outside the MVP.

Better Auth is the provisional authentication library, subject to a blocking integration spike. Better Auth owns User, Account, Session, verification, and MFA records. MailFlow owns Workspace, Membership, Teams, Invitations, RBAC, and all authorization decisions. The Better Auth Organization plugin is not used.

Signup appears atomic to the user. If Better Auth cannot participate in the same database transaction, signup uses an idempotent pending-user flow: create or reserve identity, transactionally create workspace and owner membership, then activate identity/session only after success, with retry and compensation for partial failures.

### Gateway session validation after service extraction

The opaque browser session is validated exactly once at the authenticated ingress of each external request. Because an opaque identifier cannot be verified cryptographically by the Gateway, the Gateway calls the Identity/Workspace boundary rather than reading Identity storage, importing Better Auth internals, or duplicating session state.

- In the MVP this is an in-process module call inside Core and adds no network hop.
- When the Gateway and Identity boundary become separate deployables, the Gateway makes one internal session-validation call per authenticated external request. Downstream services do not repeat that session lookup; they receive audience-bound workload and delegation assertions and validate them locally as defined below.
- Identity owns a bounded read-through session cache in Redis after Redis enters with Audience extraction. PostgreSQL remains the canonical session, membership, and authorization store.
- A cache hit may avoid PostgreSQL but never bypass expiry, suspension, device/session revocation, membership state, or authorization-version checks required by the endpoint policy.
- Sign-out, session revocation, password/security recovery, account suspension, and relevant membership changes invalidate the Identity-owned cache immediately and publish the required revocation/version signal.
- If Redis is unavailable, Identity falls back to PostgreSQL and records degraded-cache telemetry. Redis loss must not authenticate an unknown or revoked session and must not make cached authorization more permissive.
- High-impact operations may require a canonical PostgreSQL check even when a cache entry exists. The operation classification is shared with the critical revalidation policy below.
- The Gateway does not initially cache the resolved session, membership, or permission decision across external requests. It keeps the verified context only for the current request chain.
- Public/unauthenticated routes do not call session validation merely to preserve a uniform pipeline.

This deliberately accepts one Identity hop per authenticated external request after extraction. It keeps session and revocation ownership centralized while avoiding an Identity call for every downstream service hop. A Gateway-local signed session assertion or bounded cache is reconsidered only when traces show the Identity hop materially misses an agreed latency or availability SLO and a revocation-safe design is proven.

The validation endpoint has an explicit deadline, low-cardinality outcome metrics, distributed tracing, and no automatic retry for an ambiguous state-changing browser request. Identity unavailability fails authenticated ingress closed; it does not fall back to trusting an unverified cookie or stale Gateway state.

### Routing

- Signup occurs only on the public landing experience.
- The MVP workspace route is `app.mailflow.com/w/{slug}/...`.
- The workspace dashboard exposes sign-in but not sign-up.
- After signup and workspace creation, the user is redirected to workspace sign-in in the MVP.
- A workspace resolver abstraction prevents path routing from becoming a domain assumption.
- Future workspace subdomains and customer custom domains use a central `auth.mailflow.com` authorization-code exchange because cookies do not safely span unrelated customer domains.

### Service-to-service authentication

- Services use short-lived, audience-bound workload identity tokens.
- Delegated user/workspace context is a distinct signed claim set and is not confused with service identity.
- Browser access tokens are never forwarded as service credentials.
- Direct internal calls do not need to pass through the Gateway.

MailFlow uses hybrid decentralized authorization after service extraction:

- The Identity/Workspace Service is the trust issuer and source of truth for identities, sessions, memberships, teams, roles, capabilities, and authorization versions. Better Auth does not become the cross-service authorization engine.
- The Gateway validates the opaque browser session through the Identity boundary and obtains a short-lived signed delegation assertion for the intended backend audience. It does not forward the browser cookie or turn it into a reusable service credential.
- Every calling workload authenticates as itself with a separate short-lived token. A delegated call therefore preserves both identities: the calling service and the user/workspace actor on whose behalf it is acting.
- The target service validates token signature and registered claims locally using cached public verification keys. Validation checks at least issuer, audience, subject, token type, issue/not-before/expiry time, key identifier, allowed algorithm, technical scope, and token identifier where replay controls require it.
- Local cryptographic validation occurs on every request. No central network call is required for an already issued token; only public verification keys are cached.
- The target service makes the final authorization decision by combining verified delegation claims with its service-owned resource data, local authorization projection, current resource state, and domain invariants. A valid token is authentication evidence, not automatic permission.
- Identity publishes minimal membership, team, capability, authorization-version, suspension, and revocation changes. Services consume only the projection needed for their resources and deny by default while a required projection is missing or invalid.
- High-impact operations may synchronously revalidate current authorization with Identity. These include ownership transfer, admin management, permanent purge, sensitive export, billing/entitlement administration, security recovery, and other operations whose revocation window is unacceptable.

Key distribution and rotation:

- The issuer signs with an asymmetric private key kept in its trust boundary and publishes only public verification keys through a versioned JWKS endpoint.
- Validators cache the JWKS, select the key by `kid`, and refresh periodically or when an unknown `kid` appears. They do not call Identity merely to validate a known token.
- Rotation publishes a new public key before it begins signing, retains the previous verification key until every token it signed has expired plus clock-skew allowance, and removes it only after that overlap.
- If JWKS refresh fails, validators may continue using an unexpired cached known key. An unknown key, invalid signature, disallowed algorithm, wrong audience/issuer/type, or expired token fails closed.
- Private signing keys never enter ordinary service images, shared packages, frontend code, or logs. Each service receives only its own credential for obtaining a workload token and the public keys needed for validation.

Token renewal and revocation:

- Callers cache one workload token per intended audience and renew shortly before expiry. A target receiving an expired token returns an authentication failure; the caller, not the target, obtains a replacement from the issuer and may retry only when the original operation is safe or idempotent.
- The initial workload-token lifetime is five minutes, with proactive renewal when approximately one minute remains.
- Delegated user/workspace assertions are valid for at most two minutes or one synchronous request chain, whichever boundary is reached first. They are audience-bound and cannot become general browser or background-job credentials.
- Validators permit at most 30 seconds of clock skew for `iat`, `nbf`, and `exp`. There is no post-expiration grace period.
- Short expiry bounds stolen-token and stale-permission exposure but does not replace revocation. Suspension/removal events, authorization versions, and a bounded revocation mechanism handle changes that cannot wait for natural expiry.
- A token minted before a membership or capability change may be rejected when its `authorization_version` is older than the target's local projection. Critical commands revalidate synchronously when projection freshness cannot meet their risk requirement.
- Durable jobs, commands, and integration events never persist or replay an expiring workload, delegated-user, or automation token. They record stable non-secret authorization evidence: initiating actor where applicable, producer service, workspace, `execution_authorization_id`, authorization generation/version, approved capability or binding, correlation/causation, command identity, and idempotency key. RabbitMQ authenticates publishing and consuming connections separately and enforces which service identity may write or read each route. The consumer trusts that broker-enforced transport boundary—not an unverifiable token inside the payload—then combines it with its durable local authorization projection and current domain state. A worker uses a fresh workload token only for a later synchronous call and revalidates current authorization before a high-impact side effect when policy requires it.
- A caller may retry after authentication renewal only when the request is naturally safe or protected by an accepted idempotency contract. Token expiration never justifies blindly repeating a non-idempotent side effect.
- The initial lifetimes, renewal margin, and skew remain configurable and must pass security, revocation, outage, and load tests. The token-exchange endpoint, signing algorithm, and implementation library remain a security spike.

This model avoids central authorization on every domain request, which would add latency and make Identity an availability bottleneck. It accepts eventual propagation for ordinary low-risk permissions and constrains that trade-off through short lifetimes, versioned projections, immediate revocation signals, and synchronous checks for critical operations.

Transport identity evolves independently. The MVP uses private container networking, closed public service ports, TLS where traffic leaves the host, and application-level workload tokens. Audience extraction triggers multi-host networking: VPS A and VPS B communicate over a WireGuard tunnel carried by the selected provider's same-region private network. Automation Runtime activation adds VPS C and converts the static topology to a direct A-B-C full mesh; no host is a transit gateway for another pair. Provider firewalls—OCI NSGs on the preferred path or DigitalOcean cloud firewalls on the fallback—and host firewalls restrict peers and ports in both stages, while application-level workload/delegation tokens remain mandatory. WireGuard authenticates and encrypts hosts, not application services, so it does not replace audience-bound tokens or target-service authorization. Evaluate application mTLS/SPIFFE or a service mesh later when host count, dynamic scheduling, multiple regions/providers, compliance, or policy/audit requirements outweigh their operational cost.

### Connection ownership and execution authorization

- MailFlow does not introduce a generic Integration or Connections Service initially. Each bounded context owns the connection resources, credential access, provider adapter, authorization, quota, idempotency, reconciliation, webhook handling, and audit semantics required by its capability: Mail owns Resend, AI owns OpenRouter, Billing owns Stripe, and future owners follow the same rule.
- If one provider supports capabilities in several contexts, architecture assigns one explicit domain owner and the other services use its versioned API, command, result, and event contracts. They do not copy its credential, call the provider with a shared key, or create parallel mutable records for the same external authority.
- A dedicated integration service is extracted only when the integration has an independently coherent domain and lifecycle rather than merely shared HTTP-client code. Evidence includes multiple capability owners needing the same external account, independent credential/consent and webhook lifecycle, distinct security or compliance controls, independent scaling/availability, or excessive coupling to the current owner. Extraction preserves opaque IDs and versioned contracts through the strangler approach.
- A central credential vault disguised as a business service, a provider-proxy that understands no domain policy, and a shared SDK containing provider credentials or business behavior are rejected. Small generated clients and data-only contracts may be shared; provider policy and secret resolution may not.
- Every connection is owned by exactly one workspace and carries a non-null `workspace_id`; it is never owned by its creator, a team, or an individual member. The creating member remains an audited actor, not a permanent authority whose departure can orphan or transfer the integration.
- Authorization grants may expose distinct connection capabilities to workspace roles, teams, and individual members within the same workspace. These are resource-level grants under the connection contract, not arbitrary global role overrides. They support members with no team, membership in several teams, and reuse by multiple teams without copying credentials. A team scopes authorization only and never becomes a tenant or data-ownership boundary.
- Connection permissions distinguish at least viewing safe metadata, selecting/using, running a constrained connection test, rotating/reconnecting, revoking/deleting, and managing grants. High-impact management rights are not implied by ordinary workflow-authoring or connection-use permission.
- Grant rows and referenced roles, teams, members, and connections are constrained relationally to the same `workspace_id`, protected by the owning database's RLS and service authorization, and tested against cross-workspace identifier substitution. The browser receives only authorized, non-secret connection projections.
- A workflow node stores only an opaque, stable, workspace-scoped `connection_id`, or another typed resource-binding identifier when its pinned capability contract requires one. It never stores a provider token, API key, OAuth refresh token, password, encrypted secret value, or credential-store location.
- A platform-owned capability may expose no customer-selectable connection. For example, the initial Mail capability uses MailFlow's own Resend account and domain under platform policy; the published node therefore binds to that capability without inventing a per-workspace credential record.
- Publication pins the connection identity, capability owner, and exact node/contract versions, but not the current secret value or credential revision. Workflow may validate that the binding exists, belongs to the workspace, is compatible, and is selectable by the author through a safe owner-service projection or API. This authoring check is not execution authorization.
- Successful publication creates or references a durable, revocable, workspace-owned execution authorization scoped to the exact immutable workflow version, approved capabilities, and resource bindings. It records the publishing actor and authorization evidence for audit, but it is neither the actor's session nor a reusable provider or service token.
- Runtime executes the published version as the workspace automation principal. Removal of the author, expiration of the author's session, or later loss of the author's editing permission blocks new authoring and publication but does not implicitly revoke an already approved active automation.
- Stopping existing authority is an explicit, audited workspace operation: pause or disable the workflow, revoke its execution authorization, revoke the referenced connection, or apply a platform safety control. Current workspace state, connection state, entitlements, quotas, and owner-service safety policy remain execution-time checks and can still suspend or reject an action.
- This prevents employee offboarding from silently breaking organization-owned operations while preserving an immediate administrative kill path. Tests cover author removal, role/team changes, session expiry, explicit workflow-authorization revocation, connection revocation, and races with queued or in-flight actions.

Synchronous and durable execution paths authenticate differently:

- A synchronous Runtime-to-owner REST call presents Runtime's short-lived audience-bound workload token and a separate short-lived audience-bound automation assertion. Identity/Workspace is the sole cryptographic issuer and publishes one JWKS trust surface. The owner validates both locally, then combines the claims with its authorization projection, connection state, entitlement, quota, and domain safety policy.
- Runtime caches synchronous assertions by execution authorization and target audience and renews them before expiry. An Identity outage permits only already-issued unexpired assertions and fails closed when renewal is necessary; no service may self-sign a substitute.
- A durable RabbitMQ command contains no expiring workload, delegated-user, or automation token. It carries the producer-service identity as non-secret metadata, stable `execution_authorization_id`, authorization generation, workspace, immutable workflow/version, approved capability or binding, operation identity, and correlation/causation metadata required by the owner. The broker route/ACL, not that self-declared metadata alone, determines which producer is trusted to publish it.
- RabbitMQ authenticates Runtime through its own service credential and TLS connection. Per-service virtual-host, exchange, routing-key, queue, configure/write/read permissions limit what each producer and consumer can publish, bind, or consume. Broker authentication identifies the producer boundary but does not grant the domain effect.
- The owner consumes the command idempotently and validates its authorization generation against a durable local projection plus current resource and policy state. A missing, stale, revoked, or incompatible projection fails closed with a typed result. Redis may accelerate reads but is never the only copy or revocation channel.
- Workflow publishes authorization creation, state, generation, pause/disable, and revocation changes through its transactional outbox and durable RabbitMQ contracts. Owners consume them idempotently. Consumer lag, projection age, desired versus applied revocation state, affected workflows, and oldest unacknowledged event are observable; projections beyond the capability's accepted risk window stop new dispatches.
- Revocation prevents new owner-service acceptance after the local projection applies; a synchronous assertion also stops at expiry if that occurs first. Commands already rejected remain idempotently rejected. Commands already accepted or possibly delivered to a provider follow their existing in-flight and unknown-outcome reconciliation rules instead of being represented as revoked before effect.
- Contract and fault tests cover duplicated, reordered, delayed, and missing revocation events; stale and future authorization generations; synchronous assertion expiry and renewal; broker or Redis outage; service restart and projection rebuild; clock skew; cross-audience replay; unauthorized routing keys; and races at every owner acceptance checkpoint.

Connection resolution and lifecycle:

- Runtime transports only the opaque binding in the typed action command. It never resolves the credential, reads an integration credential store, receives provider secrets, calls Infisical for a tenant credential, or invokes the external provider using the owner's identity.
- At action time, the capability-owning service revalidates workspace ownership, connection state, capability compatibility, entitlement, safety policy, and execution authority. It then resolves the current valid credential internally and calls the provider. A connection therefore remains a domain resource owned by the service that understands its provider, policy, and lifecycle.
- Rotating a credential does not require workflow republication because the stable connection identity remains unchanged. Revocation, deletion, expiry, or policy suspension prevents future undispatched use and returns a typed configuration or policy outcome; the owner never silently falls back to another connection or platform credential.
- A credential rotation may retain the same `connection_id` only when the capability owner verifies that the external provider account or principal identity is unchanged. The connection keeps an immutable external-principal binding while its secret credential revisions may change.
- A technical retry for the same `action_operation_id` may use a newer credential revision only under that same connection and external principal. The owner preserves the original idempotency and reconciliation identity, records the credential revision used by each attempt, and never turns credential rotation into a new business attempt.
- Selecting another provider account or external principal creates a new `connection_id`. Drafts must bind to it explicitly and existing published workflows require a reviewed republication; the platform never mutates the old connection to redirect queued, delayed, retrying, or already accepted operations.
- Revocation blocks an operation whose provider side effect has not been dispatched. Once a provider may have accepted the operation, revocation cannot pretend to undo it: the owner follows the accepted unknown-outcome and reconciliation policy without issuing the effect against another account. If reconciliation is impossible without valid access, the operation remains visibly unresolved and requires the applicable recovery path.
- Deleting a connection first makes it non-dispatchable through an atomic owner-service state transition. New commands fail with a typed unavailable-binding outcome; delayed or running instances suspend at a safe durable checkpoint when they reach the affected action, and no platform or workspace default is substituted.
- Deletion immediately removes the active ability to authenticate: the owner attempts provider-side revocation where supported, invalidates caches, removes active credential material, and uses cryptographic erasure when the approved store supports a per-credential or per-workspace encryption key. A deleted connection cannot be reactivated with its old secret; reconnecting creates a new `connection_id` and requires explicit draft binding and republication.
- Physical copies already captured in encrypted backups expire under the backup-retention policy. MailFlow must not promise instantaneous byte-level erasure from every backup; destroying the applicable encryption key makes retained ciphertext unusable when the selected credential-store design provides that guarantee.
- Deletion leaves only a non-secret tombstone for the approved audit and execution-history retention period. It may preserve the connection ID, workspace and capability owner, provider type, redacted or hashed external-principal identity, state transitions, actor, reason, and timestamps, but no credential, reusable token, full provider identifier without demonstrated need, or secret-store locator.
- Published graphs and historical executions are not rewritten when a connection is deleted. New publication fails validation until the draft is corrected; retained execution records continue referencing the tombstone so operators can explain the suspension or historical effect. At retention expiry, tombstone fields are deleted or irreversibly anonymized according to the data-classification and legal policy while minimum non-identifying execution integrity may remain.
- Execution and audit records may contain the `connection_id`, capability owner, non-secret credential revision or fingerprint, external provider-account identity, resolution time, and policy decision needed for diagnosis and reconciliation. They never contain the secret value or reusable provider token.

Domain ownership keeps provider policy beside the capability that understands its consequences and avoids creating an early god service. The accepted indirection permits safe credential rotation and keeps Runtime provider-neutral without weakening the owning service's execution-time authorization. Separating credential revision from external-principal identity also prevents a retry intended for account A from producing an effect in account B. A non-secret tombstone preserves historical explainability without preserving access.

Primary references:

- [OAuth 2.0 Token Exchange and audience-restricted delegation](https://www.rfc-editor.org/rfc/rfc8693.html)
- [JSON Web Token registered claims](https://www.rfc-editor.org/rfc/rfc7519.html)
- [JSON Web Key Sets](https://www.rfc-editor.org/rfc/rfc7517.html)
- [OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
- [OAuth mutual-TLS client authentication and certificate-bound tokens](https://www.rfc-editor.org/rfc/rfc8705.html)
- [SPIFFE Workload API](https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_api/)

## 8. Email provider, addressing, and routing

MailFlow does not build an SMTP server and does not synchronize Gmail or Outlook. Resend is the single inbound and outbound provider for the controlled MVP.

### MVP domain model

- One MailFlow-owned domain is configured in the central Resend account.
- Each workspace receives one immutable, globally unique address derived from its slug, for example `acme@inbox.mailflow.com`.
- A stable `Mailbox` entity and separate `mailbox_addresses` history prevent the visible address from becoming the identity key.
- Changing the MVP address is not supported.
- The slug-based address is an MVP routing choice, not the future custom-domain model.

The pilot intentionally uses the Resend free plan while its limits remain sufficient for controlled customer testing. As verified during planning, that plan was treated as one custom domain, 100 emails per day, and 3,000 per month, with both inbound and outbound consumption considered. Limits and pricing must be reverified before implementation or launch.

### Future custom domains

- Customer-owned email subdomains are a paid workspace add-on.
- The customer owns and configures DNS; MailFlow guides verification and operates the central provider integration.
- The related infrastructure/provider cost is recovered through workspace billing.
- Multiple workspace mailboxes and team-scoped mailbox access may be added at that stage.

### Shared-domain reputation and abuse controls

The MVP protects the shared MailFlow domain with the following controls:

- Outbound delivery is disabled until a platform administrator manually activates the workspace.
- Real external recipients are allowed; recipient-by-recipient verification would make organizational communication unusable.
- Configurable per-workspace and global quotas protect both provider capacity and shared sender reputation.
- The initial planning baseline is 20 outbound emails per workspace per day, a global safety ceiling at 80% of the provider's current daily allowance, and five outbound emails per minute per workspace. These values are configuration, not hardcoded product rules.
- Hard bounces and complaints automatically add the affected address to a suppression list.
- Global and per-workspace kill switches stop delivery without requiring a deployment.
- Quota increases require manual operational review during the controlled pilot.

Provider limits and the initial numbers must be revalidated immediately before launch. When Plans & Billing is implemented, quotas and rate limits become explicit entitlement and risk policies based on workspace plan, verified sending domain, usage history, and sender health. Billing entitlement alone must not bypass reputation or abuse controls.

### Receiving

- Resend webhooks are authenticated and persisted idempotently before asynchronous processing.
- The receiving webhook supplies notification/metadata; a worker fetches the current message content, headers, and temporary attachment URLs through the provider API.
- The MVP does not promise raw MIME because the selected provider interface does not expose a guaranteed raw `.eml` artifact.
- MailFlow stores an immutable JSON snapshot of the provider response in object storage, normalized searchable fields in PostgreSQL, and original attachment bytes in object storage.
- Provider webhooks and API retrieval are abstracted behind ports so another provider can be introduced later if required.

### Provider continuity

Resend is an explicitly accepted single point of failure for MVP email transport. The Free plan does not provide the contractual availability needed to derive a MailFlow email-transport SLA, and MailFlow does not operate a second live provider in the MVP.

- The Mail application depends on an internal `EmailProvider` port; Resend SDK types and semantics do not enter the domain model.
- Mail is the sole owner of the central Resend account, credentials, provider adapter, webhook interpretation, provider quota/reputation enforcement, technical delivery retries, idempotency, unknown-outcome reconciliation, and canonical delivery result. Organizational sends and later campaign sends enter Mail through separate versioned commands but use the same provider ownership boundary.
- MailFlow identifiers remain canonical. Provider name, provider message identifier, provider attempt, and immutable response snapshot are stored as integration metadata.
- User-visible delivery states distinguish `queued`, `provider_degraded`, `sent`, `delivery_unknown`, and `failed`.
- Timeouts, `429` responses, and transient `5xx` failures use bounded retries, backoff with jitter, and a circuit breaker.
- Definitive validation/configuration failures, disabled domains/accounts, and exhausted quotas do not retry blindly.
- Each outbound attempt uses the Resend idempotency key. Because Resend documents a 24-hour key lifetime, MailFlow never relies on it as the permanent delivery ledger.
- If an uncertain attempt remains unresolved after the 24-hour provider-idempotency window, it becomes `delivery_unknown`; a new attempt requires an explicit user operation and warning instead of an automatic resend that could duplicate mail.
- Periodic reconciliation lists recent sent and received messages from the provider and compares them with MailFlow delivery and inbound records.
- Inbound webhooks are verified, deduplicated by provider event identifier, accepted out of order, and reconciled. Resend's documented webhook storage/retry behavior improves recovery but does not replace MailFlow persistence.
- Provider degradation generates operational alerts and a user-facing status indication; the UI never represents an unconfirmed message as sent.

A second provider is reconsidered when contractual availability, custom domains, sustained volume, or measurable outage impact justifies it. Outbound portability is substantially easier than inbound failover. Inbound continuity needs a separate design for MX routing, provider retention, attachment/message normalization, reputation, testing, and DNS cutover.

Primary references:

- [Resend pricing and plan capabilities](https://resend.com/pricing)
- [Resend Terms of Service](https://resend.com/legal/terms-of-service)
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend webhook delivery guarantees and retries](https://resend.com/docs/webhooks/introduction)
- [Resend inbound storage and recovery behavior](https://resend.com/docs/dashboard/receiving/introduction)

### Threading and inbox state

- Threads use RFC message identifiers and reply references; subject-only grouping is forbidden.
- Read/unread and favorite state are per user.
- Archive and trash are shared mailbox state.
- Future labels and assignment are shared workspace/team state.
- Drafts are author-owned.
- Trash is retained for 30 days and then purged.
- A user with purge capability may permanently delete an item from trash after an explicit warning.
- Purge removes message content, snapshots, attachments, search data, and future embeddings, while retaining a minimal tombstone for idempotency and audit.
- A newly received provider event can resurrect an item from a tombstone when the external message genuinely reappears.

### Search

The MVP uses PostgreSQL lexical search over normalized email metadata and body text. It excludes attachment-content search and semantic/vector search. Future RAG and semantic retrieval are separate capabilities.

## 9. Composer, drafts, and delivery

- PostgreSQL is the canonical draft store.
- Draft autosave runs approximately two seconds after meaningful changes.
- Optimistic concurrency uses a draft version to prevent silent overwrites.
- Jotai holds complex local editing state and unsaved changes; it is not the source of truth.
- Optional limited IndexedDB recovery may protect against a browser crash, but default persistent client state is avoided.
- Sending creates an immutable send snapshot.
- The UI immediately displays `queued`, then refetches as the worker progresses.
- Provider calls are at least once and therefore require an idempotency key, delivery-attempt records, retry policy, and reconciliation even when the queue advertises exactly-once job execution.

## 10. Attachments and email-content security

### Upload path

- The browser uploads directly to private S3-compatible storage through a short-lived presigned `PUT` URL.
- The backend chooses the object key and records a pending upload.
- Completion verifies object existence, declared and actual size, content metadata, and checksum before associating it with a draft.
- MVP limits: 10 MB per file, 20 MB total per email, and 10 attachments.
- Database blobs are prohibited.

### Malware scanning

- The MVP runs ClamAV in a local container on the backend VPS.
- `clamd` is reachable only on the internal container network and signatures are refreshed with `freshclam`.
- Attachments remain unavailable while pending, infected, or unscannable.
- Scanning fails closed, retries transient failures, quarantines unsafe objects briefly, then purges them.
- Archive expansion, recursion, decompression ratio, file-count, and time limits protect against archive bombs.
- Store the scanner result, signature version, object hash, and timestamp for audit.
- The product must never claim that scanning makes a file completely safe.
- A managed scanner can replace ClamAV later behind the same scanning port.

### Email rendering

- Server-side sanitization precedes display.
- HTML renders in a sandboxed iframe with a restrictive CSP.
- Remote images are blocked by default.
- Inline CID content is converted to authenticated private assets.
- Sensitive content, attachment names, addresses, and bodies are excluded from application logs.

## 11. MVP asynchronous processing and realtime updates

### Durable jobs

The MVP uses pg-boss through an internal job-queue port:

- The application transaction commits domain state and enqueues the job in the same PostgreSQL transaction through the Drizzle transaction adapter.
- Jobs use bounded retries, exponential backoff with jitter, priority, heartbeats/expiry, dead-letter handling, and controlled redrive.
- Worker handlers are idempotent.
- Provider-side effects remain at least once and require reconciliation.

RabbitMQ later replaces integration transport; it does not invalidate the internal application ports or job semantics.

### Realtime UI

- The API emits Server-Sent Events for one-way UI invalidation.
- PostgreSQL `LISTEN/NOTIFY` wakes API instances in the MVP.
- SSE carries lightweight change notifications; TanStack Query refetches authoritative state.
- Redis becomes the fan-out substrate when multiple API instances or realtime scale justify it.

### RabbitMQ and Redis environment topology after extraction

RabbitMQ and Redis enter together when Audience becomes the first independently deployed business service. They are not MVP dependencies.

The accepted staged topology is:

- Local development runs pinned RabbitMQ and Redis containers through Docker Compose.
- Integration suites run disposable real brokers through Testcontainers.
- Homologation initially uses separate CloudAMQP Free and Redis Cloud Free resources to validate external TLS, credentials, latency, quotas, reconnection, and provider behavior.
- The personal production pilot may also use the Free plans while customers are known, traffic is small, and no contractual SLA exists.
- Production upgrades only when an explicit capacity, reliability, operational, or customer-dependency trigger occurs. The initial paid candidates are a dedicated CloudAMQP RabbitMQ plan and Redis Cloud Essentials in US East; provider, plan, price, and region are revalidated at purchase time.
- No environment shares RabbitMQ virtual hosts, Redis databases, credentials, messages, or cached data with another environment.
- Within each RabbitMQ environment, every independently permissioned service receives a separate broker user/credential. Virtual-host permissions and topic/exchange routing-key permissions grant only the configure, write, and read operations required by that producer or consumer; no shared host-wide broker identity is accepted as a shortcut.

Why the Free pilot is acceptable:

- The project is personal, initial customers are known, and the distributed phase begins after the MVP rather than at launch.
- The current Free quotas are likely sufficient for the expected initial volume: CloudAMQP advertises one million messages per month, 10,000 queued messages, 100 queues, and 20 connections; Redis Cloud provides one 30 MB database with 30 connections.
- PostgreSQL databases remain authoritative. RabbitMQ is integration transport, protected by producer outbox, consumer inbox/idempotency, and reconciliation. Redis contains only reconstructable or conservatively recoverable auxiliary state.
- A provider outage can pause asynchronous processing without silently losing canonical business intent.

Free-plan constraints are explicit:

- CloudAMQP describes its Free shared RabbitMQ plan as development infrastructure, provides no production reliability promise, and removes queues after 28 days of inactivity.
- Redis Cloud describes Free as learning/prototyping infrastructure with best-effort service and no persistence.
- Queue topology is redeclared idempotently at service startup and monitored for missing exchanges, queues, and bindings.
- Redis loss must never bypass authorization, permanently lose an event, or allow unlimited sending. Security/reputation-sensitive rate limits fail closed or use a conservative PostgreSQL fallback.
- Alert at approximately 50% of any relevant provider limit and plan the upgrade before 70%, rather than waiting for rejection at the hard limit.
- The system and customer communication must describe this phase as a controlled non-contractual pilot.

Local and automated validation covers exchange/queue/binding declaration, publisher confirms, manual acknowledgements, retry/backoff, DLQ, duplicate and out-of-order delivery, poison messages, broker restart, consumer termination, outbox relay, inbox idempotency, Redis TTL/atomic limits, cache reconstruction, connection loss, and reconnect. A distributed E2E must prove `Core transaction -> outbox -> RabbitMQ -> Audience consumer -> Audience database -> query API`. Homologation then proves the external behavior that local containers cannot: certificates, authentication, public-network latency, provider quotas, and managed-service failure modes.

Trade-offs and rejected alternatives:

- Using four Free infrastructure dependencies across the wider pilot (OCI, Resend, RabbitMQ, and Redis) compounds best-effort availability. This is accepted only because of the project's personal/known-customer context and must remain visible in health/status communication.
- Hosting RabbitMQ and Redis on the Core VPS is rejected. RabbitMQ recommends a production node with at least 4 CPUs and 4 GiB and advises against colocating it with other I/O-heavy services; the Core host already runs the API, worker, ClamAV, Caddy, tunnel, and Collector.
- A separate self-managed broker VPS is not initially selected because a suitably sized host approaches the price of managed service while adding patching, backups, monitoring, and recovery to a two-developer team.
- Free cloud services do not replace local containers: normal development must remain available without external credentials, quota consumption, or network access.

Upgrade RabbitMQ when any of these occurs: active campaign/automation dependency, contractual availability, repeated provider incidents, more than 50% warning or projected 70% quota use, backlog/connection pressure, queue expiry risk that cannot be safely tolerated, or business impact exceeding the paid plan. The first paid step is dedicated single-node managed RabbitMQ; three-node quorum queues become mandatory before a contractual high-availability promise.

Upgrade Redis when any of these occurs: 50% warning or projected 70% memory/connection use, need for persistence/replication, repeated eviction or reconnect impact, multiple production services relying on it, or inability to keep a safe degraded fallback. Paid Redis does not make it authoritative by default.

Primary references:

- [CloudAMQP plans and current Free limits](https://www.cloudamqp.com/plans.html)
- [CloudAMQP shared and dedicated topology](https://www.cloudamqp.com/docs/rabbitmq-server.html)
- [RabbitMQ production deployment guidelines](https://www.rabbitmq.com/docs/4.2/production-checklist)
- [RabbitMQ quorum queues](https://www.rabbitmq.com/docs/4.2/quorum-queues)
- [RabbitMQ authentication, authorization, and permissions](https://www.rabbitmq.com/docs/access-control)
- [Redis Cloud plans](https://redis.io/pricing/)
- [Redis Cloud Free database](https://redis.io/docs/latest/operate/rc/databases/create-database/create-free-database/)
- [Redis Cloud persistence by plan](https://redis.io/docs/latest/operate/rc/databases/configuration/data-persistence/)

### RabbitMQ and Redis client libraries

TypeScript services use these clients behind MailFlow-owned infrastructure adapters:

- `amqplib` 2.x for RabbitMQ over AMQP 0-9-1.
- `redis` (`node-redis`) for Redis. Pin the exact supported major at implementation after the broker/client compatibility spike; a planning-time major is not an evergreen architecture constraint.

Why `amqplib`:

- RabbitMQ's official JavaScript tutorials use it, CloudAMQP defaults to AMQP 0-9-1, and the library exposes confirm channels, acknowledgements, prefetch, topology declarations, TLS, and RabbitMQ queue extensions without imposing an application framework.
- The current 2.x line bundles TypeScript definitions and includes recovery primitives while retaining explicit protocol behavior useful for an event-driven architecture study.
- MailFlow's adapter owns long-lived connections, heartbeat, bounded reconnect with jitter, idempotent topology setup, confirm publishing, prefetch, manual acknowledgement, DLQ classification, graceful drain, and telemetry.
- The publisher never treats an in-memory client buffer as durable. PostgreSQL outbox rows remain pending until broker confirmation, so a process or connection failure can safely cause a later republish.

Why `node-redis`:

- It is the Redis project's recommended Node.js client and supports TypeScript, TLS, reconnect, transactions, pipelines, and Pub/Sub without another framework layer.
- Use separate connections for ordinary commands, publishers/subscribers, and blocking operations because a connection in subscriber or blocking mode cannot safely serve unrelated commands.
- Redis operations remain behind narrow cache, rate-limit, presence, and realtime-fan-out ports. Domain code does not import Redis types or commands.

Trade-offs and rejected alternatives:

- Direct protocol clients require MailFlow to define connection lifecycle and safe defaults, but keep those responsibilities visible and testable in one adapter rather than hidden throughout services.
- `amqp-connection-manager` is not selected initially because current `amqplib` provides recovery primitives and its offline memory buffering would overlap with the durable outbox. It may be added only inside the adapter if the mandatory recovery spike proves native recovery insufficient for channels, topology, or consumers.
- The RabbitMQ AMQP 1.0 JavaScript client is not selected yet. Although RabbitMQ documents it, its repository currently has very low adoption, no formal releases, and essential recovery work still visible in its roadmap. Reconsider it when maturity and CloudAMQP Free compatibility are demonstrated.
- `ioredis` is not selected for a new service because Redis now recommends `node-redis` and publishes migration guidance away from `ioredis`.
- Rascal, NestJS messaging modules, and a shared event framework are rejected initially because they add framework policy above the broker and conflict with the accepted Hono plus producer-owned-contract approach.

Before Audience extraction, a blocking spike must prove TLS against CloudAMQP Free, disconnect/reconnect, broker restart, channel/consumer recreation, topology redeclaration, confirm loss, outbox republish, duplicate consumption, graceful shutdown, and Redis reconnect/subscription restoration. Failure of `amqplib` recovery at this gate permits `amqp-connection-manager` inside the adapter without changing domain contracts.

Primary references:

- [RabbitMQ JavaScript tutorial](https://www.rabbitmq.com/tutorials/tutorial-one-javascript)
- [amqplib API](https://amqp-node.github.io/amqplib/channel_api.html)
- [amqplib release history](https://github.com/amqp-node/amqplib/blob/main/CHANGELOG.md)
- [RabbitMQ reliability guidance](https://www.rabbitmq.com/docs/reliability)
- [RabbitMQ AMQP 1.0 clients](https://www.rabbitmq.com/client-libraries/amqp-client-libraries)
- [node-redis guide](https://redis.io/docs/latest/develop/clients/nodejs/)
- [Redis migration from ioredis](https://redis.io/docs/latest/develop/clients/nodejs/migration/)

## 12. Data lifecycle and privacy

- MailFlow processes server-readable plaintext because search, automation, sanitization, and future RAG require it; the system is not zero knowledge.
- Use encryption in transit and at rest, managed keys/secrets, private storage, short signed URLs, encrypted backups, and data-minimized logs.

### Cancellation, export, and deletion

- Normal cancellation immediately places the workspace in a 30-day read-only grace period.
- During grace, the owner and admins may access and export data. Sending, invitations, automations, and user mutations are disabled.
- Inbound messages received during grace remain preserved so reactivation does not cause silent message loss.
- Reactivation during grace restores the existing workspace and its retained content. Customer reactivation and platform-administrator intervention are audited.
- The owner may waive grace and request early irreversible purge after password, TOTP, and typed workspace-name confirmation.
- At the end of grace, an idempotent deletion saga begins and must remove operational tenant data from databases, object storage, search indexes, jobs, projections, and future embeddings within 30 days.
- Operational data is therefore removed no later than 60 days after normal cancellation.
- Encrypted backups are not selectively rewritten. They remain unavailable to the product and expire naturally within their 30-day retention, making the worst-case backup expiry 90 days after cancellation.
- A deletion ledger is reapplied before any restored backup can serve traffic, preventing deleted data from becoming accessible again.
- A minimal workspace tombstone survives purge for idempotency, security, audit, and possible future reprovisioning.
- A user who belongs to another workspace retains the global identity; only the cancelled workspace's membership and tenant-owned data are deleted.

The platform administrator may reactivate the organization at any time, but reactivation has two distinct semantics:

- During the 30-day grace period, reactivation restores the same workspace identifier and retained content.
- Once the purge saga begins, it runs to completion and cannot be cancelled midway.
- After purge, product-facing “reactivation” is technically empty reprovisioning. It creates a new workspace UUID and may reclaim the prior name, slug, and email address when still available.
- The new record references the surviving tombstone through `reprovisioned_from_workspace_id` for audit, but deleted messages, attachments, indexes, and other content are not restored.
- Backups cannot be used to bypass an executed deletion request.

Using a new tenant identifier prevents the deletion ledger, stale jobs, or delayed events associated with the prior workspace from affecting newly created data.

### Export

- Export is an asynchronous job that creates an encrypted ZIP containing documented JSON/CSV data, normalized email content, workspace configuration, and original attachments.
- Export does not promise raw `.eml` because MailFlow does not possess guaranteed original MIME under the MVP provider contract.
- A short-lived signed URL grants download access, and the temporary export object is automatically deleted.

### Retention classes

- Operational logs are retained for 30 days.
- Security events are retained for 180 days.
- Workspace audit records are retained for 12 months unless a documented contractual or legal requirement changes that period.
- Billing, invoice, dispute, and statutory records use a separate retention schedule reviewed by legal and accounting before Plans & Billing launches; MailFlow will not invent one universal fiscal period.
- Data retained for a legal obligation is minimized, isolated from ordinary product use, access-restricted, and tagged with its purpose and expiry rule.
- Data-subject requests about leads, contacts, or email content are directed to the customer workspace as controller; MailFlow supplies the operator workflow and deletion evidence.

### LGPD processing roles

The processing role is classified per purpose rather than once for the entire company:

- The customer workspace is the controller for organizational email, leads, contacts, campaigns, templates, customer-directed analytics, and RAG over that organizational content.
- MailFlow is the operator for that content and processes it under the workspace's documented instructions.
- MailFlow is the controller for its own account administration, authentication, contract and billing data, minimum operational telemetry, platform security, fraud prevention, and abuse prevention.
- Infrastructure and delivery providers that process customer content for MailFlow are suboperators. The initial inventory includes Resend, Neon, Cloudflare, and the selected compute provider according to the data each actually processes.
- A processing agreement is distinct from the commercial terms and records instructions, responsibilities, incident cooperation, deletion/export duties, and the current suboperator list.
- Each data category records its purpose, lawful basis assigned through legal review, role, location, retention rule, and deletion behavior.
- International transfers are inventoried and covered by an applicable mechanism under ANPD Resolution CD/ANPD No. 19/2024.
- A legal review is required before publishing the privacy notice, processing agreement, retention schedule, or customer contract. This architecture record is a technical baseline, not legal advice.

Primary references:

- [Brazilian General Data Protection Law, especially Articles 15 and 16](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm)
- [ANPD Guide for the Definition of Processing Agents and the Data Protection Officer](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/Segunda_Versao_do_Guia_de_Agentes_de_Tratamento_retificada.pdf/%40%40display-file/file)
- [ANPD Resolution CD/ANPD No. 19/2024 on international transfers](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024)

## 13. AI and RAG security boundary

The future AI Service operates under a zero-trust retrieval boundary because organizational emails, contacts, attachments, and knowledge documents may be highly confidential.

### Ingestion and ownership

- The AI Service owns its databases, vector indexes, credentials, migrations, and derived artifacts. It never reads Mail, Audience, Campaign, or Content databases directly.
- Minimal integration events indicate that an authorized source changed. The AI Service fetches source content through the owning service API using workload identity and a declared processing purpose.
- An owner or admin enables indexing per mailbox or knowledge source. MailFlow does not silently index every source by default.
- Only attachments that completed malware scanning enter isolated parsing and indexing.
- Every source document, chunk, and embedding carries the canonical workspace identifier, source identifier and version, mailbox/team access scope, classification, and content hash.

### Tenant isolation and retrieval authorization

- The selected vector store must enforce tenant isolation through a mandatory database policy such as PostgreSQL RLS or a provider-native tenant namespace. An optional application-supplied query filter is not an acceptable security boundary.
- Workspace and user context comes from verified session/membership and delegated authorization, never from prompt text or client-supplied tenant identifiers.
- Retrieval applies workspace and resource authorization before vector search and revalidates final candidate sources through the owning service API before prompt assembly.
- Authorization changes propagate through events into the AI projection; final source revalidation protects against temporarily stale projections.
- Automated adversarial tests attempt cross-workspace, cross-mailbox, and cross-team retrieval.

### Untrusted content and agency

- Emails, documents, attachments, websites, and retrieved text are untrusted data and are explicitly delimited from system/developer instructions.
- System prompts contain no secrets, credentials, connection details, or authorization policy.
- Deterministic application code enforces every authorization decision outside the model.
- The model has no direct SQL, object-storage, provider, or administration credentials.
- Initial AI capabilities generate drafts, templates, explanations, and typed action proposals. They cannot autonomously send email, delete data, publish workflows, or change permissions.
- A future agentic action is a typed proposal passed to an ordinary application command, which rechecks authorization, validates inputs, records audit data, and obtains human approval for consequential actions.

### Provenance, evaluation, and observability

- Knowledge-backed answers cite the source email, thread, document, and source version used.
- Opening a citation repeats current source authorization; possession of an old answer does not grant source access.
- When evidence is insufficient, the product exposes uncertainty rather than fabricating a citation.
- Model, embedding model, retrieval configuration, system prompts, and evaluation datasets are versioned for comparison and rollback.
- Evaluations cover retrieval relevance, groundedness, answer quality, tenant leakage, stale permissions, direct/indirect prompt injection, poisoned documents, and cost/latency limits.
- Operational telemetry excludes prompts, generated content, retrieved source text, email content, and embeddings.

### Privacy and deletion

- AI/embedding providers must offer an appropriate DPA, prohibit training on MailFlow customer content, provide controlled retention, and disclose subprocessors and international transfers.
- AI conversations are private to their author by default; workspace sharing requires an explicit action.
- Source deletion or access revocation immediately places its AI artifacts on a denylist/tombstone before asynchronous cleanup.
- Cleanup removes chunks, embeddings, caches, citations, and derived conversational references, then reconciliation verifies the result.
- Embeddings are treated as potentially personal derived data, not assumed to be anonymous metadata.

The generation integration stack, primary model gateway, and initial vector-storage technology are selected below. Exact generation models, underlying inference providers, and embedding provider/model remain implementation-time decisions constrained by this boundary and by measured evaluations. A future dedicated vector database remains conditional on measured migration gates rather than being preselected.

### AI integration and model gateway

The AI Service is intentionally one of the last business services introduced. Mail, Audience, Campaign, Content, Workflow, authorization, and audit contracts must be consolidated before AI is allowed to assist them. AI augments stable product capabilities; it does not compensate for unfinished domain boundaries or bypass their application APIs.

Selected stack and responsibilities:

- The Vercel AI SDK for TypeScript is the AI Service's model-integration and orchestration runtime. It supplies streaming, structured outputs, tool calling, model abstractions, controlled agent loops, and explicit workflow patterns.
- OpenRouter is the primary model gateway. It centralizes access, billing, model/provider availability, provider routing, privacy constraints, and configured fallbacks.
- The `@openrouter/ai-sdk-provider` adapter is the preferred initial bridge between the AI SDK and OpenRouter, subject to an implementation spike because the AI SDK catalog classifies it as a community provider.
- MailFlow, not the SDK or gateway, owns capability contracts, prompt and tool definitions, routing policy, authorization, approvals, evaluations, budgets, audit records, retries, and durable execution state.
- The integration remains behind MailFlow-owned ports. AI SDK, OpenRouter, and provider-specific types never cross the AI Service boundary or become contracts consumed by other services.

Why this fits MailFlow:

- The AI Service is expected to support materially different capabilities: campaign generation, rewriting, translation, classification, RAG answers, workflow suggestions, quality evaluation, and future supervised actions. The AI SDK provides one typed TypeScript surface without binding domain use cases to one model vendor.
- OpenRouter permits controlled access to multiple model families through one gateway. This supports task-specific model selection and provider-level resilience without maintaining credentials, billing, and low-level adapters for every inference provider from the first release.
- TypeScript preserves the default backend language, Zod schemas, observability conventions, deployment tooling, and a two-developer team's operational focus. Python remains available later for workloads that justify its separate operational cost.
- The AI SDK supports deterministic sequential/parallel workflows, routing, evaluation loops, and orchestrator-worker patterns. This permits simple pipelines for predictable tasks and specialized orchestration only where evaluations prove additional quality.

Capability and routing policy:

- Clients request a versioned business capability such as `generate_campaign`, `rewrite_email`, `translate_content`, `classify_contact`, `answer_with_rag`, or `suggest_workflow`; they never submit an arbitrary provider or model identifier.
- An internal, versioned capability registry maps each capability to an approved model alias, model/provider allowlists, prompt version, schema, tools, timeout, token and cost budget, privacy policy, fallback policy, and evaluation suite.
- Concrete model IDs are selected near implementation through representative MailFlow evaluations for quality, groundedness, structured-output and tool-call reliability, latency, cost, multilingual behavior, and safety. Current model popularity is not architectural evidence.
- Multiple specialized orchestrators may live inside the single AI Service. They do not become separate microservices without evidence of independent scale, security, dependency, ownership, or release lifecycles.
- Start with the least autonomous pattern that meets the capability. A one-call generation or deterministic multi-step workflow is preferred over an agent loop; multi-agent orchestration is introduced only when measured quality improvement outweighs additional calls, latency, failure modes, and debugging cost.
- AI SDK loops are not a durable workflow engine. Long-running or recoverable work persists its state through the AI Service's ordinary job/event infrastructure and, when appropriate, the future Automation Runtime.

Privacy and provider controls:

- Customer email, contact, knowledge-base, and retrieved RAG content requires OpenRouter Zero Data Retention enforcement, prompt logging disabled, and explicit model/provider allowlists.
- Free or unreviewed models are prohibited for real customer content. Free-model rate limits also make them unsuitable for production reliability.
- Each underlying endpoint is reviewed for retention, training, region, DPA, and subprocessors. OpenRouter and every provider that can receive customer content enter the suboperator and international-transfer inventory.
- Only the minimum authorized context is sent. OpenRouter guardrails complement but do not replace MailFlow authorization, input minimization, prompt-injection defenses, output validation, or human approval.
- Model-generated tool inputs are untrusted. Zod/JSON schemas validate structure, while deterministic MailFlow application commands recheck membership, workspace/resource authorization, invariants, idempotency, and required approval before any side effect.

Reliability and fallback rules:

- Provider fallback for the same model is preferred because it improves availability with less expected semantic drift.
- Cross-model fallback is configured per capability only after both models pass the same evaluation and output-contract suite. It is never an unrestricted fallback to any available model.
- A response records the requested capability version, resolved model and provider, prompt/tool versions, latency, token use, cost, fallback occurrence, and outcome metadata without recording confidential prompt or completion content in operational telemetry.
- Credit balance, capability/workspace budgets, timeouts, retry limits, circuit breaking, and kill switches prevent gateway or agent behavior from producing uncontrolled spend.

Trade-offs and rejected alternatives:

- OpenRouter adds a suboperator, another availability dependency, prepaid-credit operations, and a current credit-purchase fee. This is accepted for the initial reduction in provider-integration and billing complexity.
- Gateway abstractions do not erase model differences. Tool calling, structured output, context limits, moderation, latency, and provider-specific options still require capability-level tests.
- The OpenRouter AI SDK adapter is community-listed rather than a first-party AI SDK provider. The adapter remains isolated, contract-tested, and replaceable by the AI SDK OpenAI-compatible adapter, OpenRouter's official SDK, or a direct provider adapter if the spike fails.
- Direct integration with only OpenAI or another single provider is not selected because it prematurely limits task-specific model evaluation and concentrates vendor dependency. It remains a supported escape path for a capability when privacy, SLA, cost, or feature support requires it.
- LangChain, LlamaIndex, and a separate Python orchestration service are not initial defaults. They add overlapping abstractions and polyglot operations before ordinary generation, tool use, and RAG prove the AI SDK insufficient.
- Automatic model selection across OpenRouter's full catalog is rejected for confidential and contract-sensitive workloads because behavior, privacy, cost, and output compatibility would be insufficiently controlled.

Re-evaluate this decision when the OpenRouter adapter fails compatibility or contract tests; gateway latency, outages, fees, credit operations, privacy/DPA, data residency, or provider coverage violate requirements; a direct provider offers a material SLA/cost/privacy advantage; AI SDK abstractions block required provider features; evaluation workloads justify Python/ML tooling; or multi-orchestrator complexity requires a dedicated durable agent/runtime platform. The AI Service's ports and capability registry preserve these exit paths.

### Embedding gateway and evolution policy

OpenRouter is also the initial embedding gateway, but embeddings use a dedicated MailFlow-owned `EmbeddingProvider` port rather than the generation-model abstraction. Generation and retrieval may therefore change gateways, providers, credentials, quotas, or failure policy independently.

Initial integration:

- The AI Service uses the AI SDK `embed`/`embedMany` model interface for ordinary single-query and batch embedding flows.
- At implementation time, first verify embedding support and OpenRouter-specific privacy/routing options in the current `@openrouter/ai-sdk-provider`. If that path is incomplete, use the AI SDK OpenAI-compatible embedding provider against OpenRouter's `/api/v1/embeddings` endpoint; the official OpenRouter TypeScript SDK is the final adapter-level fallback.
- OpenRouter provides consolidated access and billing while MailFlow retains model selection, batch sizing, rate limits, retry policy, cost accounting, ZDR/provider allowlists, and re-indexing state.
- The embedding provider/model/version, dimensions, normalization, distance metric, document/query instruction format, chunking version, and input hash are explicit persisted configuration, never implicit SDK defaults.

Selection and evaluation rules:

- No concrete embedding model is frozen before the AI Service implementation. The candidate set is refreshed at that time because model quality, dimensions, prices, limits, privacy terms, and deprecation status change quickly.
- The evaluation corpus contains English, Brazilian Portuguese, cross-language queries, mixed-language email threads, names, addresses, subjects, domain terminology, long messages, CRM notes, knowledge documents, and supported attachment text.
- Offline measurements include Recall@k, nDCG@k or MRR, downstream grounded-answer/citation quality, cross-language retrieval, exact-term failure cases, storage/index size, indexing throughput, p95/p99 query latency, batch behavior, token limits, cost, and filtered-search recall.
- Provider benchmarks use the same versioned chunks, queries, relevance judgments, hybrid-search policy, and reranker policy. A public leaderboard may nominate candidates but cannot replace MailFlow's corpus.
- Dimension is a quality/cost/index-memory decision proven by evaluation; a provider's maximum or default dimension is not automatically preferred.

Reliability and compatibility rules:

- A retrieval query must use the same compatible embedding space as the indexed corpus. OpenRouter may fall back only between endpoints serving the pinned embedding model/version after numerical compatibility is validated.
- Silent fallback to another embedding model is prohibited. Different models, and sometimes different versions of one family, produce incompatible spaces even when dimensions match.
- If the active embedding provider is unavailable, query embedding retries within a bounded policy and then fails explicitly or uses lexical retrieval; it does not compare an incompatible vector against the existing index.
- A model migration creates a new versioned index/table, re-embeds through idempotent jobs, dual-reads both generations against the evaluation suite, cuts over explicitly, and retains rollback until deletion reconciliation and acceptance checks pass.
- Embedding generation is content-hash idempotent inside one workspace and authorized source scope. MailFlow does not create a cross-workspace content or embedding cache because equality and cache access could leak confidential information.
- Inputs, outputs, and vector arrays are excluded from AI SDK/OpenTelemetry recording. Embeddings remain confidential derived personal data under the AI privacy and deletion policy.

Future provider paths:

- **Direct OpenAI**: candidate when its embedding endpoint offers better contractual controls, reliability, price, or feature support than the routed path. It is operationally simple but restores direct vendor concentration.
- **Direct Google Gemini/Vertex AI**: candidate for task-specific, flexible-dimension, multilingual, or multimodal retrieval and Google Cloud contractual controls. Model-generation compatibility and task-instruction behavior require a complete re-embedding evaluation.
- **Direct Cohere**: candidate for multilingual and multimodal retrieval, configurable dimensions, and paired reranking. It adds another account/provider and must beat the gateway path on measured quality or commercial/privacy terms.
- **Direct Voyage AI**: candidate for retrieval-specialized multilingual or domain-specific models and query/document modes. It adds a specialist vendor and must prove DPA, region, availability, and total cost.
- **Other managed models through OpenRouter or a direct adapter**: Mistral, Jina, or future providers enter the same evaluation and privacy gate; availability in a catalog is not approval.
- **Self-hosted open-weight embeddings**: Hugging Face Text Embeddings Inference with a then-current multilingual model becomes a candidate when strict data locality, sustained volume, or provider cost justifies dedicated CPU/GPU capacity, patching, scaling, model licensing, and on-call ownership. It is not economical by default for the initial team and workload.

Move embeddings away from OpenRouter when the required model is unavailable; adapter behavior is incomplete; ZDR, DPA, provider pinning, region, or routing controls fail; gateway latency/availability or fees are material; direct batch discounts or throughput materially reduce total cost; or self-hosting wins a measured cost/privacy/reliability comparison. The `EmbeddingProvider` port and versioned re-indexing pipeline make this independent from the generation gateway and vector database.

### Initial vector storage and future migration path

The initial vector store is PostgreSQL with the `pgvector` extension in a database owned exclusively by the AI Service. It is not a table or schema in the Mail, Audience, Campaign, Content, or Identity database. Neon is compatible with this choice if it remains the selected PostgreSQL host for that service, but the extension is not coupled to Neon.

Why this fits the initial workload:

- The expected initial corpus and customer count do not justify another stateful database, SDK, backup model, network dependency, or operational control plane before measurements exist.
- PostgreSQL supplies transactions, constraints, migrations, backup/recovery, monitoring, and `FORCE ROW LEVEL SECURITY`, preserving the tenant-isolation rules already adopted by MailFlow.
- `pgvector` supports exact nearest-neighbor search and HNSW/IVFFlat approximate indexes, multiple distance functions, filtered queries, and hybrid retrieval with PostgreSQL full-text search.
- Drizzle supports vector column types, distance helpers, and HNSW/IVFFlat index definitions. The extension itself is installed through a reviewed SQL migration rather than assumed or created by application startup.
- Keeping chunk metadata, authorization projections, deletion tombstones, embedding versions, and vectors transactionally consistent simplifies the first RAG implementation and deletion/reconciliation workflows.

Data and isolation rules:

- Every document, chunk, and embedding row carries `workspace_id`, canonical source service/type/identifier/version, access-scope projection, classification, content hash, chunking version, embedding provider/model/version, vector dimension, lifecycle state, and timestamps.
- `FORCE ROW LEVEL SECURITY`, a non-owner runtime role, transaction-local verified tenant context, composite tenant-aware constraints, and automated cross-tenant tests apply exactly as they do in other tenant databases.
- The vector column and index are never the authorization boundary. RLS limits the tenant first; mailbox/team/resource access is applied before retrieval and revalidated against the source-owning service before prompt assembly.
- Embeddings and chunks are derived, rebuildable data. Canonical source ownership remains with the originating service. Source deletion or permission revocation installs a synchronous denylist/tombstone before asynchronous vector cleanup.
- Different embedding dimensions or incompatible model versions are not mixed in one vector index. A new embedding generation receives separate versioned storage/indexing and is evaluated before cutover.

Retrieval and indexing policy:

- Begin with exact vector search while the corpus is small because it offers perfect recall and establishes a comparison baseline.
- Introduce HNSW only when measured exact-search latency or resource use misses the retrieval budget. HNSW is preferred before IVFFlat because of its speed/recall behavior and lack of a training step, accepting greater memory use and slower index construction.
- Approximate retrieval is continuously compared against the exact baseline for recall. Filter selectivity, `hnsw.ef_search`, iterative scans, dead tuples, index size, build time, and query plans are monitored instead of treating an ANN index as automatically correct.
- RAG retrieval combines semantic similarity with PostgreSQL full-text search when evaluation shows that exact names, addresses, subjects, product terms, or identifiers are missed by dense vectors. Reciprocal Rank Fusion or a measured reranker combines candidates.
- AI SDK embedding telemetry remains disabled unless explicitly configured with input and output recording disabled; operational telemetry never records chunk text or embedding arrays.

Portability and extraction preparation:

- The AI domain depends on a MailFlow-owned `VectorStore` port rather than Drizzle or `pgvector` query types.
- Deterministic document/chunk identifiers, versioned chunking, source hashes, and an idempotent re-indexing pipeline permit rebuilding any target store from authorized source data.
- A future migration uses backfill plus change events, dual-read evaluation, deletion/revocation reconciliation, and controlled cutover. It does not copy an opaque ANN index and declare equivalence.
- Evaluation compares recall/groundedness, authorization filtering, deletion propagation, freshness, p95/p99 latency, throughput, failure recovery, storage/query cost, and operational effort before and after migration.

Future dedicated-vector-store shortlist:

- **Pinecone Serverless**: strongest initial candidate when managed operations and provider-native workspace namespaces are priorities. Each workspace would receive a namespace, while finer mailbox/team/resource authorization remains metadata-filtered and revalidated. Trade-offs include vendor lock-in, usage-based cost, external data processing, and eventual consistency.
- **Weaviate Cloud**: candidate when native multi-tenancy plus integrated BM25/vector hybrid retrieval and tenant lifecycle controls materially reduce application complexity. Trade-offs include a larger product/configuration surface and another opinionated data/model integration layer.
- **Qdrant Cloud or self-hosted Qdrant**: candidate when open-source portability, rich payload filtering, hybrid/multi-stage queries, and deployment control matter. Its payload-based tenant filter alone is not accepted as the mandatory security boundary; the migration spike must prove enforceable tenant partitioning through the chosen collection/shard/access topology.
- **Milvus/Zilliz and other distributed engines**: reconsider only for corpus size, ingestion throughput, or horizontal-scaling evidence beyond the preceding options. They are not near-term targets for a two-developer team.

No dedicated product is preselected. At migration time, each candidate must prove mandatory tenant scoping, fine-grained metadata filtering, hybrid retrieval, deletion/export behavior, consistency and recovery semantics, US-region/DPA/subprocessor suitability, TypeScript client quality, observability, cost at measured workload, and a reversible migration path.

Move from `pgvector` only when production evidence shows one or more of: retrieval latency or throughput missing the agreed SLO after query/index tuning; ANN recall degraded by required authorization filters; index memory/build/vacuum/replication cost becoming unsafe; ingestion or re-embedding interfering with operational workloads; required horizontal scale or tenant isolation exceeding PostgreSQL's practical topology; or a managed vector service producing a clearly better total cost and reliability profile. Vector count alone is not a migration decision.

Primary references:

- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [OWASP LLM08:2025 Vector and Embedding Weaknesses](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/)
- [NIST AI 600-1: Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
- [AI SDK providers and models](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [AI SDK agent overview and deterministic workflow guidance](https://ai-sdk.dev/docs/agents/overview)
- [AI SDK workflow and orchestrator-worker patterns](https://ai-sdk.dev/docs/agents/workflows)
- [AI SDK provider and model management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)
- [AI SDK OpenRouter community provider](https://ai-sdk.dev/providers/community-providers/openrouter)
- [OpenRouter Vercel AI SDK integration](https://openrouter.ai/docs/guides/community/vercel-ai-sdk)
- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
- [OpenRouter Zero Data Retention](https://openrouter.ai/docs/guides/features/zdr)
- [OpenRouter provider logging and data retention](https://openrouter.ai/docs/guides/privacy/provider-logging/)
- [OpenRouter pricing and free-model limits](https://openrouter.ai/docs/faq)
- [OpenRouter embeddings API](https://openrouter.ai/docs/api/reference/embeddings)
- [OpenRouter embedding-model catalog API](https://openrouter.ai/docs/api/api-reference/embeddings/list-embeddings-models)
- [AI SDK embeddings and batch embedding](https://ai-sdk.dev/docs/ai-sdk-core/embeddings)
- [AI SDK OpenAI-compatible embedding models](https://ai-sdk.dev/providers/openai-compatible-providers#embedding-models)
- [Google Gemini embeddings, task types, dimensions, and model migration](https://ai.google.dev/gemini-api/docs/embeddings)
- [Cohere embedding models](https://docs.cohere.com/v2/docs/cohere-embed)
- [Voyage AI text embeddings](https://docs.voyageai.com/docs/embeddings)
- [Hugging Face Text Embeddings Inference](https://huggingface.co/docs/text-embeddings-inference/en/quick_tour)
- [pgvector capabilities, indexing, filtering, hybrid search, and monitoring](https://github.com/pgvector/pgvector)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Neon pgvector support](https://neon.com/docs/ai/ai-concepts)
- [Drizzle PostgreSQL extension and pgvector support](https://orm.drizzle.team/docs/extensions)
- [Pinecone multitenancy and namespaces](https://docs.pinecone.io/guides/index-data/implement-multitenancy)
- [Pinecone data freshness and multitenancy trade-offs](https://docs.pinecone.io/guides/index-data/data-modeling)
- [Weaviate multi-tenancy configuration](https://docs.weaviate.io/weaviate/config-refs/collections#multi-tenancy)
- [Weaviate hybrid search](https://docs.weaviate.io/weaviate/concepts/search/hybrid-search)
- [Qdrant multitenancy](https://qdrant.tech/documentation/tutorials/multiple-partitions/)
- [Qdrant filtering and payload indexes](https://qdrant.tech/documentation/search/filtering/)
- [Qdrant hybrid and multi-stage queries](https://qdrant.tech/documentation/search/hybrid-queries/)

### Analytics storage and OLAP decision

ClickHouse is the primary analytical database for the future Analytics Service, conditional on a mandatory implementation spike against TimescaleDB. This is not an MVP dependency and does not replace any service-owned PostgreSQL database. PostgreSQL remains the system of record for transactional analytics configuration such as dashboard definitions, saved reports, schedules, sharing, RBAC, export jobs, and audit commands. ClickHouse owns rebuildable analytical facts, dimensions, and aggregates derived from domain events.

Why ClickHouse is the primary choice:

- MailFlow analytics is expected to be an append-heavy event workload: campaign sends, deliveries, opens, clicks, bounces, audience changes, automation steps, template usage, AI usage, and operational outcomes.
- Product queries will scan and aggregate large event ranges across time, campaign, workflow, audience, geography, device, provider, and client. Columnar storage, data skipping, compression, parallel aggregation, and precomputed projections fit this workload better than treating it as an extension of transactional PostgreSQL.
- ClickHouse supports the interactive, high-cardinality analysis required for funnels, cohorts, delivery trends, top performers, and drill-down dashboards. Materialized views and aggregate tables can serve frequent product queries without repeatedly scanning raw facts.
- A dedicated analytical store protects service-owned transactional databases from expensive reporting scans and preserves the accepted database-per-service boundary. Analytics consumes published facts; it never joins or queries another service's operational database directly.
- ClickHouse has a direct evolution path from one managed analytical database to larger compute/storage configurations without changing MailFlow's event contracts or Analytics API.

This choice is intentionally deferred until the Analytics Service exists. The MVP does not run ClickHouse, RabbitMQ, or an analytics ingestion pipeline merely to prepare for future scale.

Data flow and ownership:

1. A business service commits its domain change and outbox record atomically in its own PostgreSQL database.
2. Its publisher sends a minimal, versioned integration event through RabbitMQ.
3. An Analytics ingestion worker validates the contract, applies consent and classification policy, deduplicates by event identity, enriches only from Analytics-owned projections, batches writes, and records processing checkpoints.
4. The worker writes append-oriented facts to ClickHouse and maintains the required aggregate projections.
5. The Analytics API reads ClickHouse and applies product authorization; browsers and other services never receive database credentials or query ClickHouse directly.
6. PostgreSQL stores transactional dashboard/report configuration and durable export or rebuild orchestration state.

The ClickHouse RabbitMQ table engine is not the default ingestion boundary. An application-owned worker is retained because MailFlow needs explicit schema validation, idempotency, tenant and privacy enforcement, batching, retries, replay, DLQ handling, observability, and controlled schema evolution. A native engine may be evaluated for a narrow high-throughput stream later, but it cannot bypass these responsibilities.

Tenant isolation and security gate:

- Every analytical fact, dimension, aggregate, checkpoint, and deletion instruction carries `workspace_id`. Tenant identity is derived from a verified request or workload-token context, never accepted as an unrestricted client filter.
- `workspace_id` participates in table ordering and partition/query design where measurements justify it. This is a performance decision in addition to an authorization requirement.
- Analytics uses separate least-privilege ingestion and read identities. Product reads go only through the Analytics API; ingestion credentials cannot be exposed to query paths.
- ClickHouse row policies are defense in depth for read-only product identities. They are not treated as equivalent to PostgreSQL `FORCE ROW LEVEL SECURITY`: ClickHouse documentation notes that row policies constrain `SELECT`, and users with write or unrestricted copy privileges can defeat the intended restriction.
- The implementation spike must prove a non-omittable workspace-bound read context, deny-by-default behavior, protection against connection-pool context leakage, and automated cross-tenant tests for raw facts, aggregates, exports, saved reports, caches, and failure/retry paths.
- Platform administration does not receive email/contact content access through analytics. Cross-workspace operational views use explicitly approved, privacy-minimized platform aggregates rather than unrestricted tenant fact access.
- If the team cannot demonstrate an enforceable and operable isolation model, ClickHouse fails the gate and TimescaleDB with PostgreSQL RLS becomes the default.

Correction, deletion, and LGPD behavior:

- Facts are append-oriented and immutable by default. Corrections produce new versioned facts or compensating records; aggregates are rebuilt or reconciled from the authoritative event history.
- When an owning service deletes, anonymizes, or revokes processing for a subject, it emits a versioned lifecycle event. Analytics first installs a tombstone/denylist so deleted data stops appearing, then purges or irreversibly anonymizes applicable facts and rebuilds affected aggregates.
- Deletion jobs are idempotent, observable, retryable, and reconciled against source-service deletion state. ClickHouse's mutation behavior makes this workflow more operationally complex than row-oriented PostgreSQL, so deletion throughput and completion time are mandatory spike and ongoing SLO measurements.
- Raw event retention, aggregate retention, and legally required minimal records are separate policies. Analytics is rebuildable derived data and never becomes the sole legal or operational source of truth.

Mandatory ClickHouse-versus-TimescaleDB spike:

- Replay a representative MailFlow data set containing multiple workspaces, campaigns, delivery events, contacts, workflow runs, late events, corrections, and deletion requests.
- Benchmark realistic product queries: time-series summaries, multi-dimensional filters, unique counts, funnels, cohorts, audience overlap, top performers, geographic/device breakdowns, and drill-down pagination.
- Measure ingestion throughput, freshness lag, p50/p95/p99 query latency, concurrency, compression/storage, aggregate refresh/rebuild time, deletion completion, backup/restore, replay recovery, observability, and monthly managed-service cost at projected stages.
- Prove tenant isolation, least-privilege identities, pooled-connection safety, export authorization, failure behavior, and automated cross-tenant regression tests.
- Compare developer effort and on-call burden, not only query benchmarks. A performance win that creates unsafe isolation or disproportionate operational ownership is a failed result.
- Record the data generator, schemas, queries, versions, configurations, costs, and results in an ADR so the decision remains reproducible.

TimescaleDB is the mandatory fallback because it preserves PostgreSQL SQL, drivers, migrations, operational knowledge, transactional capabilities, and mature RLS while adding hypertables, compression/columnar capabilities, and continuous aggregates. It is likely the better choice if the first analytics volume remains moderate, transactional and analytical configuration must stay closely coordinated, or tenant security and operational simplicity dominate raw OLAP performance. Its trade-offs are weaker fit than ClickHouse for broad, high-cardinality scans and complex ad hoc analytical dimensions at larger event volumes; continuous aggregates also have query-shape and refresh limitations that must be tested.

Other alternatives considered:

- **Plain PostgreSQL**: acceptable for an early prototype or small operational summaries, but rejected as the planned analytical store because large scans and aggregates would compete with transactional workloads and recreate a future migration already implied by the product scope.
- **BigQuery**: a strong future warehouse/batch candidate with serverless operations and independent storage/compute. It is not primary for the interactive product path because on-demand scan economics, ingestion/query behavior, and the need for additional acceleration/caching can make low-latency tenant dashboards less predictable. Reconsider it for large-scale historical analysis, data-science workloads, or a separate warehouse/lakehouse plane.
- **Apache Pinot or Apache Druid**: capable real-time OLAP engines, but rejected initially because their distributed operational surface is too large for two developers and the projected starting load.
- **DuckDB**: useful for local analysis, deterministic tests, export transformation, and offline data investigation. It is not the shared concurrent multi-tenant production serving database.

Operational posture:

- Local development and CI use pinned ClickHouse containers and Testcontainers with representative schemas and migrations.
- ClickHouse Cloud is the first production candidate because operating a distributed analytical database is not a useful initial burden for a two-developer team. Its current trial/free allowance is for evaluation, not a permanent production-cost assumption.
- Self-hosted ClickHouse is reconsidered only when measured managed-service cost, data-control requirements, or sustained scale outweigh upgrades, backup/recovery, replication, monitoring, security, and on-call ownership.
- The Analytics API hides ClickHouse SQL and schemas behind versioned product contracts. Business services consume neither ClickHouse tables nor dashboard-specific aggregates.

Re-evaluate or reject ClickHouse when the spike or production evidence shows unsafe tenant isolation; unacceptable managed-service cost; query performance that does not materially beat TimescaleDB for MailFlow workloads; deletion/reconciliation missing its SLO; excessive schema/materialized-view correction burden; unavailable contractual region, DPA, backup, or recovery controls; or an operational burden disproportionate to the product's analytics volume. Passing the spike makes ClickHouse the selected implementation; failing any mandatory security criterion selects TimescaleDB even if ClickHouse is faster.

Primary references:

- [ClickHouse use cases](https://clickhouse.com/use-cases)
- [ClickHouse columnar storage](https://clickhouse.com/resources/engineering/what-is-columnar-storage)
- [ClickHouse row policies](https://clickhouse.com/docs/reference/statements/create/row-policy)
- [ClickHouse materialized-view and production practices](https://clickhouse.com/blog/10-best-practice-tips)
- [ClickHouse Cloud pricing](https://clickhouse.com/pricing)
- [Timescale hypertables and Hypercore](https://docs.timescale.com/use-timescale/latest/hypertables/)
- [Timescale continuous aggregates](https://docs.timescale.com/use-timescale/latest/continuous-aggregates/about-continuous-aggregates/)
- [Timescale continuous-aggregate limitations](https://docs.timescale.com/use-timescale/latest/continuous-aggregates/create-a-continuous-aggregate/)
- [BigQuery overview](https://cloud.google.com/bigquery/docs/introduction)
- [BigQuery pricing](https://cloud.google.com/bigquery/pricing)
- [BigQuery Storage Write API](https://cloud.google.com/bigquery/docs/write-api)

### Analytics visualization library

Apache ECharts is the primary browser visualization library for MailFlow analytics. It renders charts and chart-level interactions only; it does not own metric definitions, analytical queries, authorization, dashboard persistence, report scheduling, or business calculations. Those responsibilities remain in the Analytics Service and MailFlow application layers.

Integration boundary:

- The frontend imports `echarts/core` and only the required charts, components, features, and Canvas or SVG renderer. The exact compatible release is pinned and tested when Analytics implementation begins rather than frozen by this architecture document.
- A small MailFlow React adapter owns instance creation, option updates, responsive resizing, theme changes, event subscription cleanup, loading/error/empty states, and disposal. The project does not initially depend on a third-party React wrapper whose release cycle could lag ECharts.
- Reusable MailFlow chart components cover approved product semantics such as `TimeSeriesChart`, `FunnelChart`, `CohortHeatmap`, `GeoChart`, `BreakdownChart`, and `TopPerformersChart`. A speculative universal chart abstraction is rejected.
- Analytics APIs return versioned metric data, dimensions, units, comparison periods, freshness, and permitted drill-down metadata. They never return `EChartsOption`, JavaScript formatter functions, colors, or executable presentation configuration.
- The frontend maps those contracts to ECharts options. Consequently, API contracts, saved dashboards, and reports remain independent of the rendering library.

Why this fits MailFlow:

- The planned product needs more than basic line and bar charts: campaign and automation time series, funnels, cohorts, audience overlap, geographic and device breakdowns, heatmaps, treemaps, comparisons, drill-down, zoom, selection, and dense multidimensional views.
- ECharts provides more than twenty built-in chart types, composable components, datasets and transforms, native interactions, and both Canvas and SVG renderers. This breadth reduces the likelihood of adding a second chart library for an advanced dashboard.
- Progressive rendering, streaming support, typed arrays, and large-data modes give the frontend headroom for interactive exploration. They do not justify shipping raw event-scale data to the browser: the Analytics Service still aggregates, limits, paginates, or downsamples responses.
- SVG/Canvas server rendering creates a plausible path for scheduled report and export rendering, subject to a dedicated implementation spike for fonts, themes, timezones, pagination, and pixel consistency.
- The Apache 2.0 license and framework-independent core avoid binding the Analytics UI to one React-specific component model.

Accessibility and product requirements:

- Import `AriaComponent` and enable ARIA descriptions explicitly; ECharts accessibility support is not enabled by default.
- Use accessible design tokens, sufficient contrast, decal or pattern encoding when color alone would carry meaning, meaningful titles/descriptions, and keyboard-operable controls outside the chart canvas.
- Every business-critical visualization provides an equivalent summarized value and accessible data table or downloadable tabular representation. Auto-generated chart descriptions do not replace this requirement.
- Tooltips are supplementary and never the only way to discover a value. Filters, legends, date controls, and drill-down actions remain semantic HTML with visible focus.
- Accessibility is validated with automated checks plus keyboard and screen-reader testing against the actual MailFlow components.

Security and performance controls:

- The backend cannot send formatter functions, arbitrary HTML, or opaque ECharts configuration. Labels and tooltip content are produced from allowlisted frontend formatters and escaped text.
- User-supplied campaign, workflow, template, or audience names are untrusted display data. They cannot become executable formatter code or raw HTML.
- Chart responses enforce workspace authorization and contain only the data points required for the selected view. ECharts is not an authorization or tenant-isolation boundary.
- Large responses have explicit series/point budgets. The API aggregates or downsamples before transfer; the frontend may use Canvas, progressive rendering, or data zoom only after representative performance tests.
- Chart modules are lazy-loaded by route or capability where bundle measurements justify it. Tree-shaken imports are preferred over the full package build.
- Visual regression, interaction, timezone, empty/sparse/extreme-data, accessibility, and performance tests cover shared chart components. Product metrics are independently contract-tested against Analytics API fixtures.

Trade-offs and rejected alternatives:

- ECharts uses a configuration-object and instance lifecycle rather than React-native declarative chart components. The thin adapter and semantic MailFlow components isolate this impedance mismatch.
- Its feature breadth can increase bundle size and option complexity. Selective imports, route-level loading, shared option builders, and an approved component catalog control that cost.
- Canvas is not inherently accessible as structured DOM. ARIA descriptions and equivalent tables/summaries are mandatory rather than assuming the library solves accessibility automatically.
- **Recharts** is the strongest simple-dashboard alternative and has a natural declarative React API. It is not primary because MailFlow's planned funnel, cohort, geographic, dense multidimensional, and large-data views would require more custom work or an additional library. Reconsider it if the delivered scope remains limited to ordinary low-volume line, bar, area, and pie charts.
- **Visx** offers low-level React/D3 primitives and maximum design control. It is rejected initially because two developers would need to build and maintain chart behaviors, accessibility, axes, tooltips, responsiveness, and interaction infrastructure already supplied by ECharts.
- **Nivo** offers polished React components and SVG/Canvas variants. It is not selected because a broad per-component API and mixed rendering capabilities provide less consistent control for the planned advanced analytics surface than one ECharts option model.
- A commercial library is not justified before a concrete requirement for vendor support, specialized financial/enterprise charts, or an accessibility/compliance guarantee exceeds the open-source option.

Re-evaluate ECharts when its React lifecycle or bundle cost becomes material; representative dashboards miss interaction/render budgets after server aggregation; accessibility requirements cannot be met with the adapter and equivalent table views; report rendering proves unreliable; required chart types need excessive custom series code; the actual product remains simple enough that Recharts materially reduces maintenance; or a supported commercial library offers a demonstrably better total cost and compliance outcome.

Primary references:

- [Apache ECharts features and chart types](https://echarts.apache.org/en/feature.html)
- [Apache ECharts dataset model](https://echarts.apache.org/handbook/en/concepts/dataset/)
- [Apache ECharts data transforms](https://echarts.apache.org/handbook/en/concepts/data-transform/)
- [Apache ECharts Canvas and SVG guidance](https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg/)
- [Apache ECharts accessibility and ARIA](https://echarts.apache.org/handbook/en/best-practices/aria/)
- [Apache ECharts server-side rendering](https://echarts.apache.org/handbook/en/how-to/cross-platform/server/)
- [Recharts documentation](https://recharts.github.io/en-US/guide/)
- [Visx documentation](https://airbnb.io/visx/)
- [Nivo documentation](https://nivo.rocks/)

### Content service and email compilation

Content starts as one independently deployable service on VPS B, beside Audience and Campaign, with two isolated modules: **Template Management** and **Email Document & Compiler**. Template Management owns template metadata, folders, tags, collections, permissions, publication state, versions, localization, brand assignment, and usage references. Email Document & Compiler owns the versioned email-document contract, block validation, variable schemas, asset references, preview compilation, and immutable send artifacts. They share one repository, image, Compose stack, logical PostgreSQL database, and deployment initially; module boundaries prohibit direct cross-module repositories and make later extraction evidence-driven rather than mandatory.

The initial stack is TypeScript on the pinned Node.js LTS runtime, Hono, Zod/OpenAPI, PostgreSQL with Drizzle, R2 for image and exported-template assets, Pino and OpenTelemetry, and RabbitMQ through the accepted outbox/inbox conventions. Redis is not a required Content dependency initially: drafts and versions are durable PostgreSQL state, compiled artifacts are durable object or database state, and cache adoption requires measured compilation or read pressure. The same image runs separate API and compiler-worker processes so compilation load, retries, timeouts, and concurrency do not block interactive API requests.

Canonical document boundary:

- MailFlow owns a versioned `EmailDocument` JSON contract containing stable block identifiers, allowlisted block types, validated properties, layout, styles, variable references, asset references, localization metadata, and document-schema version.
- The database does not persist React elements, JSX/TSX source, editor-library node types, raw MJML as the canonical document, or compiler-internal types. The visual builder and future importers are adapters around `EmailDocument`.
- An immutable published template version is distinct from its editable draft. A campaign execution is pinned to an immutable rendered snapshot so later edits or compiler upgrades cannot change mail already queued.
- The authoritative pipeline is `EmailDocument -> validate and normalize -> allowlisted MJML tree/markup -> MJML compilation -> controlled post-processing and sanitization -> HTML and plain-text artifacts -> immutable artifact/version reference`.
- Preview and publish use the same pinned compiler image and policy. A lightweight browser approximation may improve editing responsiveness, but it cannot become the authoritative send renderer.

#### Why MJML is selected over React Email

Server-side rendering is **not** the differentiator. Both candidates support it: MJML transforms email-oriented markup or a JSON component tree into HTML, while React Email renders a React component written in JSX/TSX into HTML. MailFlow requires server-side authoritative compilation either way for repeatable validation, sanitization, variables, observability, resource limits, and immutable send snapshots.

MJML is the initial compiler because its abstraction is closer to MailFlow's customer-authored block document:

- Its email-specific section, column, text, image, button, and related component model maps naturally from an allowlisted visual-builder tree and abstracts responsive email-client HTML.
- Its official compiler accepts a structured JSON component tree as well as MJML markup. This reduces the adapter distance from `EmailDocument` without making MJML's JSON shape the product contract.
- Dynamic customer content remains data. MailFlow maps validated data to known compiler nodes; it never generates or executes customer-supplied JavaScript, JSX, or TSX.
- Compiler version, component catalog, validation policy, and output can be pinned inside a worker. This supports deterministic publication and isolates CPU or malformed-document failures from the API.
- The abstraction favors a constrained, portable email-design system over an unrestricted code-component system, which is appropriate for a multi-tenant drag-and-drop builder operated by non-developers.

React Email remains a strong option for **developer-authored, code-first** transactional templates. Its React/TypeScript component model, familiar composition, preview tooling, and direct HTML rendering give excellent developer experience. It could also render customer-authored documents safely if MailFlow implemented an allowlisted `EmailDocument -> React elements` adapter; arbitrary JSX generation is neither required nor acceptable. It is not primary because that extra React runtime/component mapping provides little advantage for the planned end-user builder and encourages product templates to drift toward code-owned artifacts. MailFlow may still use React Email separately for internal platform emails if that produces a clear maintenance benefit, but those templates do not define the customer-content architecture.

Security and reliability controls:

- Customers cannot submit executable JSX/JavaScript, arbitrary MJML documents, arbitrary components, filesystem includes, or unrestricted raw HTML. Initial support excludes `mj-raw`, remote/local includes, community custom components, scripts, event-handler attributes, and unsafe URL schemes.
- Block types, attributes, CSS properties, URLs, variables, nesting, document depth, node count, source size, compiled size, image sources, and compilation time are allowlisted and bounded. The compiler worker has explicit memory, timeout, concurrency, and retry limits.
- Variables are typed and escaped according to their destination context. A variable cannot change markup structure, CSS, URLs, or headers unless its schema explicitly permits and validates that context.
- Compilation jobs are idempotent by document version, compiler version, policy version, locale, brand version, and variable-schema version. Poison documents fail visibly and do not retry indefinitely.
- R2 assets are referenced through controlled immutable or versioned keys. Publication validates ownership, workspace scope, media type, scan state, and lifecycle before an asset can enter a send artifact.
- Representative Gmail, Outlook, Apple Mail, mobile, dark-mode, image-blocked, plain-text, and accessibility checks are part of the template test corpus. No compiler guarantees pixel-identical behavior across every email client.

Trade-offs:

- MJML is opinionated and may constrain unusual designs; generated HTML can be verbose, and custom-component pressure is a warning that the product is fighting the abstraction.
- A compiler upgrade can change output. MailFlow pins the version, records it with artifacts, runs golden and client-render regression tests, and never silently recompiles an already queued send.
- MJML does not supply the visual editor, durable version model, permissions, variables, localization, sanitization policy, or deliverability validation. These remain MailFlow responsibilities.
- Separating API and worker processes adds operational structure, but prevents expensive or malformed compilation from consuming interactive request capacity and prepares later independent scaling without declaring another service prematurely.
- Co-locating Content on VPS B avoids another host for initial customers but shares host-level resource and failure pressure with Audience and Campaign. The placement gate must prove headroom, and compiler concurrency must be capped before production activation.

Validation and re-evaluation:

Before the full Visual Email Builder, run a bounded compiler spike using the same representative `EmailDocument` fixtures through an MJML adapter and an allowlisted React Email adapter. Compare Gmail/Outlook/mobile output, responsive behavior, accessibility, custom-block effort, HTML size, compile latency and memory, deterministic snapshots, error quality, upgrade behavior, and maintenance complexity. MJML remains selected unless the spike shows that React Email materially reduces total complexity while preserving the data-only trust boundary.

Re-evaluate MJML when representative designs require excessive raw markup or custom components; compiled size or worker cost misses budgets; compatibility regressions become frequent; accessibility cannot be satisfied; React Email or another compiler demonstrates materially simpler adapters and better tested output; or the product becomes primarily developer-authored rather than visual-builder-authored. Because `EmailDocument` is canonical and the compiler is behind a port, changing the renderer does not require changing public APIs or stored template semantics.

Primary references:

- [MJML documentation and JSON input](https://documentation.mjml.io/)
- [React Email introduction and provider-independent rendering](https://react.email/docs/introduction)
- [React Email render utility](https://react.email/docs/utilities/render)

### Visual email builder editor

Puck is the conditionally selected visual-editor engine and is a **frontend-only dependency** in the MailFlow web application. It is lazy-loaded with the Visual Email Builder route in the TanStack Start frontend. Puck is not a backend service, does not run in the Content Service or compiler worker, and is never part of campaign execution.

Responsibility boundary:

- Puck owns transient canvas interaction: dragging, dropping, nesting, selection, component fields, outline navigation, local history, and viewport presentation.
- MailFlow provides an allowlisted email-block catalog and adapters between Puck's runtime data and the canonical versioned `EmailDocument`. Puck data and React component types are not database rows, public API contracts, integration events, or MJML compiler input.
- Tiptap is embedded only inside rich-text blocks. It does not own the complete email layout or template document.
- Puck owns its internal canvas state. Jotai coordinates only surrounding MailFlow UI state that is not already owned by Puck; the application must not mirror the full editor tree into a second client store. TanStack Query owns server draft, revision, and mutation state.
- Autosave converts the current editor state to `EmailDocument` and sends it to the Content API with optimistic revision control. Durable drafts, conflict detection, version history, publication, and permissions remain server responsibilities.
- The immediate editing canvas is a React approximation optimized for interaction. Authoritative preview, validation, publication, and send artifacts are produced by the Content Service using the pinned MJML pipeline.

Why Puck is the initial candidate:

- It fits the accepted React frontend and supplies component configuration, nested slots, component restrictions, outline, viewports, local history, permissions, and compositional editor primitives.
- These facilities reduce the work required from two developers while preserving a custom MailFlow block catalog and a MailFlow-owned canonical document.
- Puck remains an editor adapter rather than a content or rendering authority, limiting replacement cost if the spike fails.

Trade-offs and alternatives:

- Puck is a general React visual editor rather than an email-specific editor. Its nesting, keyboard behavior, preview fidelity, Base UI integration, and mapping to the stricter email layout model require a representative spike.
- Some UI override and plugin surfaces are experimental and may break between releases. Pin the selected version, isolate it behind MailFlow adapters, prefer stable composition and theming APIs, and test upgrades before adoption.
- GrapesJS is mature and supplies a broad web-builder environment, but centers its own HTML/component/project model. It is not selected because that model would compete with `EmailDocument` and the MJML pipeline.
- Raw dnd-kit provides strong drag-and-drop and keyboard primitives but would require MailFlow to build selection, nested layout behavior, outline, fields, history, viewports, and editor orchestration. It is the control-oriented fallback only if Puck fails the spike.
- Craft.js is flexible and serializable but intentionally does not provide a ready editor interface, leaving more product infrastructure to the team than Puck.

Mandatory spike:

- Prove rows, constrained columns, nested slots, block allowlists, copy/duplicate/delete, Tiptap integration, keyboard and screen-reader operation, local undo/redo, responsive viewports, Base UI styling, and representative document size performance.
- Prove lossless supported conversion between Puck runtime data and `EmailDocument`, including unknown or upgraded block versions, and ensure no Puck type crosses the API boundary.
- Prove debounced autosave with optimistic revisions, conflict handling, recovery after refresh, unsaved-change protection, and authoritative MJML preview/error mapping.
- Record bundle cost, upgrade surface, accessibility gaps, mapping complexity, and maintenance effort. Failure selects a bounded raw dnd-kit implementation rather than weakening the canonical document boundary.

Primary references:

- [Puck introduction and capabilities](https://puckeditor.com/docs)
- [Puck slots and nested layouts](https://puckeditor.com/docs/api-reference/fields/slot)
- [Puck compositional components](https://puckeditor.com/docs/api-reference/components)
- [Puck UI override stability warning](https://puckeditor.com/docs/api-reference/overrides)
- [dnd-kit overview](https://docs.dndkit.com/)
- [dnd-kit accessibility](https://docs.dndkit.com/guides/accessibility)
- [GrapesJS component and storage model](https://grapesjs.com/docs/getting-started.html)
- [Craft.js scope and serializable state](https://github.com/prevwong/craft.js/)

### Workflow graph and canvas library

React Flow (`@xyflow/react`) is the selected visual graph editor for the Workflow Builder. Its responsibility ends at rendering and manipulating the workflow canvas: nodes, handles, edges, selection, viewport, drag-and-drop, visual connection feedback, and editor interactions. It never validates publication authoritatively and never executes an automation.

Boundary and persisted model:

- MailFlow owns a versioned workflow-definition schema containing stable node identifiers, catalog node type and version, typed configuration, input/output ports, edges, validation metadata, and separate presentation layout.
- React Flow `Node`, `Edge`, viewport, and internal store shapes are frontend adapter types. They are not database rows, public API contracts, integration events, or Automation Runtime instructions.
- The frontend maps a MailFlow workflow draft into React Flow elements and maps approved editor commands back into the draft model. Presentation-only coordinates and viewport state remain separable from executable semantics.
- Jotai coordinates complex unsaved editor state, selection, inspector state, local commands, and optimistic changes. The Workflow Service remains canonical for durable drafts, autosave revisions, conflict detection, version history, and publication.
- Undo/redo uses a MailFlow-owned command or bounded snapshot history over semantic editor changes. React Flow Pro examples may inform implementation but are not a runtime dependency or licensed source assumption.
- Optional automatic layout is an adapter behind the editor and may use ELK.js only after a graph-shape and bundle/performance spike. A layout algorithm never changes workflow semantics.

Validation and publication:

- React Flow connection validation provides immediate usability feedback for known port compatibility, connection limits, cycles, and obvious structural errors.
- The Workflow Service always repeats authoritative validation: node catalog/version availability, schemas, required configuration, trigger cardinality, edge and branch rules, reachability, cycles where prohibited, entitlement, workspace/team authorization, referenced-resource existence, secret references, and policy limits.
- A draft may be incomplete or temporarily invalid. Publication succeeds only from an expected draft revision and creates an immutable workflow version plus a versioned runtime intermediate representation or execution plan.
- The Automation Runtime consumes only the published representation. It neither imports React Flow nor interprets browser-specific graph objects.
- Existing running instances remain pinned to their published workflow version unless an explicit migration policy is introduced later.

Why this fits MailFlow:

- React Flow integrates directly with the accepted React/TanStack frontend and provides customizable React nodes and edges without introducing another rendering framework.
- Its open-source core supplies the editor primitives MailFlow needs: controlled nodes/edges, handles, connection validation hooks, viewport controls, minimap, custom components, subflows, touch support, save/restore primitives, and TypeScript APIs.
- Built-in keyboard focus, node/edge operation, ARIA descriptions, focus panning, and localized accessibility text provide a stronger starting point than a canvas built from generic SVG or HTML primitives.
- The library remains deliberately presentation-focused. This supports the accepted separation between the Workflow control plane and Automation Runtime data plane and avoids coupling graphical editing to one in-browser execution engine.
- The MIT-licensed core is usable commercially without a React Flow Pro subscription. Pro examples, templates, and maintainer support are optional commercial conveniences, not required product capabilities.

Accessibility and interaction requirements:

- Nodes and edges remain keyboard-focusable, receive meaningful localized labels and descriptions, and expose correct roles for their actual interactive content.
- Custom nodes use semantic Base UI/HTML controls with visible focus and do not create nested or misleading button roles on the node wrapper.
- A structured workflow outline/list and node inspector provide an equivalent way to inspect, navigate, configure, and identify validation errors without relying only on spatial canvas interaction.
- Keyboard operations, focus retention, screen-reader announcements, drag alternatives, zoom, selection, large graphs, touch behavior, and reduced motion receive explicit component and E2E coverage.
- Visual connection acceptance is only feedback; inaccessible or manipulated clients cannot bypass server publication validation.

Performance, collaboration, and security controls:

- Node and edge components are memoized and subscribe only to required state. Large-graph performance is measured with representative workflow sizes before introducing virtualization or custom rendering.
- High-frequency pointer movement updates local presentation state; autosave coalesces semantic and layout changes rather than issuing an API request for every frame.
- Draft saves use optimistic concurrency with a server revision. Concurrent editing is not silently last-write-wins; real-time multi-user collaboration is a separate future design requiring presence, conflict semantics, and possibly CRDT/OT evidence.
- Node catalog definitions are allowlisted and versioned. API data cannot inject React components, arbitrary JavaScript, executable expressions, or raw HTML into the editor.
- Expressions, template variables, credentials, and resource references are parsed and validated by MailFlow-owned schemas and never evaluated by React Flow.

Trade-offs and rejected alternatives:

- React Flow solves canvas interaction, not workflow semantics, persistence, history, collaboration, or execution. MailFlow must implement those layers deliberately.
- Some advanced examples, including the published undo/redo example, use a React Flow Pro license. The architecture does not assume that example code is available; subscribe only if saved engineering time or maintainer support justifies its current cost.
- The internal React Flow state model can tempt direct persistence. Adapter and contract tests enforce separation from the canonical workflow schema.
- **Rete.js** is TypeScript-first and offers a rich plugin ecosystem plus dataflow/control-flow engines. It is rejected because its processing orientation and multi-package/plugin surface could couple the editor to runtime semantics that MailFlow has intentionally separated. It also introduces rendering conventions and dependencies beyond the accepted React/Base UI/Tailwind system.
- **JointJS/Rappid and commercial diagram suites** are reconsidered if enterprise support, specialized graph tooling, or large-editor capabilities demonstrably outweigh license cost and migration effort.
- A custom SVG/Canvas editor is rejected because pan/zoom, connection geometry, selection, touch, accessibility, focus, hit testing, and performance infrastructure would consume substantial effort without differentiating MailFlow.

Re-evaluate React Flow when representative graphs miss interaction budgets after ordinary optimization; accessibility cannot meet the product target with the outline alternative; controlled-state integration causes persistent correctness problems; required collaboration or nested-graph behavior demands disproportionate custom code; a license or maintenance change makes the dependency unsuitable; or another editor proves a materially lower total implementation and operational cost without coupling authoring to execution.

Primary references:

- [React Flow documentation and feature map](https://reactflow.dev/learn)
- [React Flow custom nodes](https://reactflow.dev/learn/customization/custom-nodes)
- [React Flow accessibility](https://reactflow.dev/learn/advanced-use/accessibility)
- [React Flow connection validation](https://reactflow.dev/examples/interaction/validation)
- [React Flow save and restore](https://reactflow.dev/examples/interaction/save-and-restore)
- [React Flow performance guidance](https://reactflow.dev/learn/advanced-use/performance)
- [React Flow MIT license](https://github.com/xyflow/xyflow/blob/main/LICENSE)
- [React Flow Pro](https://reactflow.dev/pro)
- [Rete.js overview and processing model](https://retejs.org/docs/)

### Workflow Service stack and placement

Workflow is an independently deployable control-plane service. It owns workflow metadata, drafts, autosave revisions, graph definitions, node-catalog references, validation, immutable published versions, runtime-plan generation, templates, notes, permissions, audit decisions, and publication lifecycle. It never executes workflow instances, provider actions, delays, retries, or contact journeys; those belong to Automation Runtime.

Selected stack and deployable shape:

- TypeScript on Node.js 24, Hono, Zod/OpenAPI, PostgreSQL, Drizzle, RabbitMQ, Pino, and OpenTelemetry.
- One Workflow repository and immutable image produce separate `workflow-api` and `workflow-worker` containers with independent commands, health checks, resource limits, concurrency, and telemetry roles.
- Workflow owns a logical PostgreSQL database, credentials, migrations, RLS policies, backup/restore target, Infisical scope/identity, deployment lock, and rollback target. No Runtime, Campaign, Audience, or frontend process reads its tables.
- React Flow remains a lazy-loaded frontend dependency. Workflow persists only the MailFlow-owned definition and presentation contracts; React Flow nodes, edges, store state, and component types never cross the public API boundary.
- Redis is not an initial correctness dependency. It may later support measured collaborative presence, ephemeral editing locks, or rebuildable caches, but it never owns drafts, revisions, publication state, permissions, or published versions.

API and worker responsibilities:

- The API serves versioned CRUD, draft/autosave mutations with optimistic revision checks, node-catalog queries, validation feedback, templates, history, permissions, and publication requests.
- Cheap structural checks run synchronously for editing feedback. The worker performs authoritative publication validation, referenced-resource checks, runtime-plan generation, import/export processing, event consumption, outbox relay, and other variable-duration work.
- A publication request records an idempotent accepted state and expected draft revision. Successful publication atomically records an immutable workflow version, versioned runtime representation, checksum, catalog/schema versions, audit record, and outbox fact before it becomes available to Runtime.
- Drafts may be incomplete or invalid. Published versions are immutable; edits create a new draft/version, and existing Runtime instances remain pinned to their original published version.
- Runtime-plan generation is deterministic for the workflow definition, node catalog, compiler version, and policy version. Generated artifacts and checksums are reproducible and contract-tested.

Workflow-to-Runtime publication contract:

- `WorkflowVersionPublished` is a versioned, minimal integration fact. Its payload contains the event envelope, workspace routing identifier, workflow and immutable version identifiers, runtime-plan schema/compiler versions, checksum, creation timestamp, correlation/causation metadata, and only the bounded retrieval metadata required by the contract.
- The event does not embed the workflow graph, compiled runtime plan, secret values, arbitrary node configuration, or other large domain documents. Runtime plans contain typed secret references only. Payload expansion requires explicit evidence that the additional data is necessary and remains bounded, non-confidential, backward-compatible, and cheaper or more reliable than retrieval.
- Automation Runtime consumes the event idempotently and retrieves the exact immutable plan from a versioned internal Workflow API using its Runtime-bound workload token. Workflow authorizes the caller and workspace/version scope; Runtime enforces the declared maximum size and schema version, verifies the checksum, and persists an immutable local execution copy with source and ingestion metadata in its own PostgreSQL database.
- A plan is not executable until Runtime has validated and durably stored its local copy. Once stored, starting or continuing an instance does not require Workflow availability. Existing instances remain pinned to the Runtime copy of their original version even when a newer workflow version is published.
- Retrieval failures use durable retry/backoff, idempotent ingestion, DLQ/operational visibility, and reconciliation. A missing or invalid plan fails closed: Runtime neither starts the version nor silently falls back to another version.
- R2 or another immutable artifact-transfer mechanism is considered only when measured plan size, publication volume, transfer latency, Workflow API pressure, or recovery throughput makes authenticated API retrieval unsuitable. Broker payload limits alone are not treated as a reason to move domain documents into RabbitMQ.
- The decision is reviewed with measured serialized and compressed plan sizes, p95/p99 ingestion latency, publication lag, retrieval and checksum failure rates, retry/DLQ volume, API load, storage duplication, network cost, and recovery throughput. A full-plan event remains a rejected default and may be adopted only through a recorded evidence-backed revision.

Publication lifecycle and acknowledgement:

- The user-visible lifecycle is `draft -> publishing -> published`. A publication request returns an asynchronous accepted result and moves the expected draft revision to `publishing`; it never reports immediate success merely because Workflow committed its own database transaction or published the broker fact.
- In this contract, `WorkflowVersionPublished` means that Workflow has authoritatively validated and created the immutable publication artifact. The Workflow aggregate remains user-visible as `publishing` until Runtime confirms that the exact artifact is usable.
- After retrieving, validating, checksum-verifying, and durably storing the local plan, Runtime emits an idempotent `WorkflowVersionIngested` fact containing the publication attempt, workspace, workflow, version, schema, and checksum identifiers. Only a matching acknowledgement moves Workflow to `published`.
- A terminal incompatibility, invalid checksum, unsupported schema, unauthorized resource, or non-retriable validation failure produces `WorkflowVersionRejected` with a stable non-confidential error code and diagnostic reference. Transient network, Workflow API, database, or broker failures remain `publishing` under bounded durable retry and do not become false terminal rejections.
- Workflow consumes Runtime acknowledgements idempotently and rejects stale, mismatched-version, mismatched-attempt, and mismatched-checksum messages. Reconciliation detects either side missing the other side's fact and safely republishes or rechecks the immutable version.
- A rejection records `publication_failed` for that attempt and leaves the immutable artifact and audit evidence available for diagnosis. It never deletes or mutates the previous published version. The user fixes the draft or dependency and starts a new idempotent publication attempt.
- If an earlier version is active, it remains active throughout publishing, retry, rejection, and reconciliation. A first publication has no runnable version until acknowledgement succeeds. The independent `enabled`/`paused` operational state controls whether an accepted version may receive new triggers; publication state alone never enables an automation.
- There is no distributed database transaction between Workflow and Runtime. The Workflow-owned publication process is a durable asynchronous state machine over outbox/inbox facts, idempotent commands, timeouts, and reconciliation. This explicitly accepts temporary eventual consistency while preventing false readiness.

Version cutover semantics:

- `latest_published_version_id` and `active_version_id` are distinct concepts. The former identifies the newest publication accepted by Runtime; the latter identifies the immutable version that Runtime uses when creating a new workflow instance.
- When an already `enabled` workflow finishes publication, its accepted version is automatically promoted as the desired active version. Runtime changes its local `active_version_id` atomically only after the new plan is durably present and valid. Publication does not add a separate manual activation step initially.
- When a workflow is `paused` or `disabled`, successful publication updates only `latest_published_version_id`. It does not enable the workflow or allow the new version to receive triggers. A later enable operation selects an accepted published version explicitly according to the current desired state.
- Each new trigger pins the selected `active_version_id` when the workflow instance is created. Existing, delayed, retrying, paused, or branching instances remain pinned to their original version for their entire lifetime; publication never migrates them in place.
- A failed or incomplete cutover leaves the previous active version unchanged. Runtime never partially exposes a plan, falls back to an unacknowledged version, or changes already-created instances. The previous immutable plan remains available for running instances and operational rollback under the retention policy.
- Manual version promotion, canary percentages, staged rollout, and in-place instance migration are rejected initially. Reconsider them only when customer risk, high-volume workflows, contract changes, or measured release failures justify their additional state, routing, rollback, and support complexity.

Convergent desired-state control:

- Workflow is the authority for desired operational state; Runtime is the authority for the state actually applied to execution. Workflow stores both its desired state and the latest acknowledged Runtime projection so the UI can distinguish `applying`, `applied`, `pending`, and `failed` without pretending that a cross-service transaction exists.
- Every desired-state mutation atomically increments a per-workflow monotonic `state_generation`, persists the complete desired-state snapshot, audit decision, and outbox command in Workflow PostgreSQL. Publication-driven promotion uses the same mechanism as an explicit enable, pause, disable, or rollback decision.
- Workflow sends one versioned `ApplyWorkflowDesiredState` command rather than independent `EnableWorkflow`, `PauseWorkflow`, and `ActivateWorkflowVersion` deltas. Its bounded payload contains the technical envelope, workspace and workflow identifiers, `state_generation`, `operational_state`, nullable `desired_active_version_id`, required version/checksum reference metadata, and correlation/causation data. It contains no graph, runtime plan, secret value, or expiring delegated token.
- Runtime processes the command transactionally with its inbox. A generation greater than the last observed generation supersedes the entire previous desired snapshot; an equal generation is an idempotent duplicate; a lower generation is stale and cannot change execution state. Generation gaps are valid because every command is a complete snapshot rather than a partial delta.
- Runtime applies `paused` or `disabled` safety states immediately for the newer generation even if a referenced plan is not locally available. An `enabled` snapshot that selects a plan not yet ingested remains pending while the previous valid active version continues according to the accepted cutover rule; Runtime retrieves/reconciles the missing immutable plan and switches only after validation and durable storage.
- Applying an enabled snapshot and changing Runtime's local `active_version_id` occur in one Runtime database transaction. New instance creation reads and pins that applied version in its own transaction, so it cannot observe a half-applied cutover.
- Runtime emits a minimal idempotent `WorkflowDesiredStateApplied` fact with the generation, applied operational state, active version, and source command identity. A terminal invalid request emits `WorkflowDesiredStateRejected` with a stable non-confidential reason. Transient or missing-plan conditions remain pending and observable rather than becoming false terminal failures.
- Workflow accepts acknowledgements only for the matching workflow and generation, records stale acknowledgements without regressing desired state, and reconciles any persistent difference between desired and applied projections. Reconciliation resends the latest complete snapshot; it never replays a chain of historical deltas.
- Relying on RabbitMQ delivery order, maintaining separate partially ordered state commands, or treating broker acknowledgement as business-state application is rejected. At-least-once delivery and independent retries make convergence by monotonic complete snapshot the safer contract.

Domain-event trigger ingestion:

- Mail, Audience, Campaign, and later bounded contexts publish their own versioned past-tense facts to producer-owned exchanges and routing keys through their transactional outboxes. They do not know which workflows subscribe and do not publish once per workflow.
- Automation Runtime initially owns one durable trigger-ingress queue, bound only to the event contracts supported by its published trigger catalog. Runtime worker replicas are competing consumers of this service queue. RabbitMQ routing delivers a source event to Runtime as a service; Runtime owns the fan-out to matching workflow subscriptions.
- The architecture does not create a RabbitMQ queue, exchange, binding, or consumer per workflow, workspace, or workflow version. That model would turn customer configuration into broker topology, increase declarations and recovery work, complicate deletion and migration, and make operational limits part of product semantics.
- Runtime materializes an indexed local trigger-subscription registry from successfully ingested plans and applied desired state. Matching begins with `workspace_id`, versioned event contract/type, and allowlisted indexed discriminators before evaluating bounded typed trigger predicates. It never calls Workflow during matching and never executes arbitrary customer code.
- Paused, disabled, rejected, non-ingested, or superseded subscriptions are excluded from new matches. The registry and active-version pointer change transactionally inside Runtime so an ingress worker sees either the previous valid state or the next valid state, never a partial publication.
- On message receipt, Runtime validates the producer contract and tenant routing, durably records the source event/inbox acceptance, and creates or schedules a resumable fan-out operation before acknowledging RabbitMQ. Fan-out creates workflow instances idempotently in bounded batches, records progress, and can resume after worker or database failure without asking the producer to republish.
- Source-event fan-out uniqueness is `(workspace_id, producer_service, source_event_id, workflow_id, stable_trigger_subscription_id)`. `active_version_id` is deliberately excluded: the version selected during the first accepted match is persisted on the fan-out item and resulting instance, so a redelivery after version cutover cannot create a second execution under a different key.
- A `stable_trigger_subscription_id` identifies the logical trigger subscription across ordinary workflow-version edits. Replacing the trigger as a different logical subscription creates a new identifier, but an already accepted source event is never rematched against the new registry: its persisted fan-out plan remains authoritative for every retry and recovery.
- The source-event inbox row and resumable fan-out plan ensure only one worker performs first-time matching. Competing deliveries, worker restarts, and later redeliveries find the persisted plan and resume unfinished items; they never query the current trigger registry again for that source event.
- A deliberate operator replay is a new audited operation with its own `replay_id` and policy checks. Republishing or redelivering the original producer event without that explicit replay identity remains a duplicate. Minimal idempotency tombstones outlive ordinary instance-detail retention for at least the accepted broker/replay horizon.
- Initial trigger routing uses processing-time semantics. In the transaction that first accepts a valid source event, Runtime assigns canonical `accepted_at` from its database clock, reads one consistent applied trigger-registry state, selects and persists the matching subscriptions and active versions, and never revisits that selection for a redelivery.
- Producer `occurred_at` remains required event metadata and may be used by typed workflow conditions, audit timelines, lag metrics, or domain logic, but it does not select a historical workflow version. Producer clocks, delayed outbox relay, broker backlog, and out-of-order delivery therefore cannot move the Runtime cutover boundary.
- An event produced before a version cutover but first accepted by Runtime after that cutover uses the new applied version. An event durably accepted before cutover remains pinned to the old version even when its fan-out completes later. This processing-time trade-off is explicit in operations and customer-facing semantics.
- Event-time version selection is reconsidered only when a concrete use case requires the workflow configuration that was active at domain occurrence. That design would require retained activation intervals, trusted clock/skew policy, late-event watermarks, deterministic replay rules, and tests across delayed and out-of-order delivery; it is not inferred from `occurred_at` alone.
- Each supported trigger type declares a versioned trigger-data contract in the node catalog: producer event type/version, bounded fields, types, sensitivity and retention classification, allowed matching operators, and fields that may seed initial workflow variables. Workflow publication rejects predicates or variable references not supplied by that declared contract.
- A producer event carries the smallest typed trigger projection that is sufficient for supported matching and event-time variables. This may include justified bounded facts in addition to identifiers, but never an entire contact, message, campaign, attachment, arbitrary metadata bag, secret, or unrestricted content merely for possible future use.
- Runtime performs first-time matching entirely from the validated event contract and its local trigger registry. It does not synchronously call Mail, Audience, Campaign, Workflow, or another producer to hydrate an ingress event. Producer or network unavailability therefore cannot hold the trigger-ingress transaction open or change its result.
- Values whose meaning is “as observed when the domain event occurred” must be present in the versioned event contract or an explicitly versioned local projection and are persisted only when required by the accepted runtime plan. Values whose meaning is “current when this action executes” are fetched later through the owning service's authenticated API or command contract and may legitimately differ or be unavailable after deletion, revocation, suppression, or other policy changes.
- Adding a new predicate field requires an explicit producer contract version and compatibility window; Runtime never starts extracting undocumented fields from an arbitrary JSON payload. Frequently needed data that is too large, sensitive, or volatile for events may justify a minimal Runtime-owned projection fed by separate versioned facts, with freshness and reconciliation controls.
- Ingress telemetry and logs record schema/version, identifiers, sizes, timing, and outcomes without copying confidential payload values. Runtime retains only the source fields required by instance execution, audit, replay, and the accepted privacy schedule; data minimization is part of each trigger-contract review.
- Malformed, unsupported, unauthorized, or poison events follow typed rejection and DLQ policy with non-confidential diagnostics. Transient database or capacity failures remain retryable. Per-event matched-subscription count, fan-out lag, queue age, duplicates, rejections, DLQ depth, and workspace fairness are observable.
- One queue is the initial operational choice, not a permanent throughput ceiling. Split or shard ingress by stable workspace partition or event family only when measured queue age, head-of-line blocking, hot-tenant contention, recovery time, broker limits, or independent SLOs justify the added routing, rebalance, ordering, and operational cost.

Why this stack fits:

- Workflow operations are primarily API, PostgreSQL, validation, serialization, and broker I/O. TypeScript/Node.js fits that profile and reuses the two-developer team's contracts, authorization, Zod schemas, testing, telemetry, deployment, and incident tooling.
- TypeScript discriminated unions help model a versioned allowlisted node catalog and exhaustive graph transformations. Runtime validation remains mandatory because browser documents, stored JSON, broker messages, and imported templates are untrusted.
- Hono preserves the accepted compact REST/OpenAPI surface. Zod/OpenAPI gives editing and generated-client contracts without making frontend or database types the service contract.
- PostgreSQL fits transactional draft revisions, immutable versions, metadata relationships, permissions, audits, outbox records, and tenant isolation. Versioned JSONB may hold the graph document, while relational columns and tables retain identity, ownership, lifecycle, searchable metadata, and integrity constraints.
- RabbitMQ is justified because Workflow publishes to an independently deployed Automation Runtime. Transactional outbox, publisher confirms, idempotent inboxes, acknowledgements, reconciliation, and versioned events provide the accepted at-least-once boundary.
- Keeping the broker fact small decouples event delivery from runtime-plan size and prevents RabbitMQ from becoming document storage. The temporary asynchronous retrieval dependency affects version ingestion only; the Runtime-owned copy removes Workflow from the execution availability path.
- Separate API and worker containers isolate publication spikes or malformed/large graph validation from interactive authoring without declaring an additional service.

Initial placement:

- Workflow begins on VPS B only after the placement gate proves CPU, memory, connection-pool, broker, and failure-domain headroom beside Audience, Campaign, and Content.
- VPS A is rejected as the default because it remains the critical Gateway, Identity, Mail, ClamAV, and later Billing host. Workflow authoring and publication must not consume or couple that path for convenience.
- VPS B groups later marketing control-plane capabilities and keeps Mail available during a Workflow outage. Co-location does not permit shared processes, databases, credentials, repositories, domain code, unsigned calls, or unversioned contracts.
- A VPS B failure makes Workflow authoring/publication unavailable but must not stop already running automation instances when Runtime is placed in a separate failure domain. RabbitMQ retains bounded publication traffic for recovery, subject to broker policy.
- If VPS B fails the capacity gate, Workflow receives another host rather than weakening reservations or moving to VPS A. Moving hosts changes routing, workload identity, secrets, network policy, deployment, and telemetry, not its database or contracts.

Trade-offs and rejected alternatives:

- Keeping Workflow and Runtime separate adds a repository, database, contracts, eventual consistency, deployments, and operational boundaries. This cost is accepted because authoring/publication and long-lived execution have different availability, scaling, failure, retention, and release profiles.
- A single Workflow-plus-Runtime service is rejected: worker saturation, provider failures, retries, or queue backlog could degrade editing and publication, while a control-plane deployment could disrupt active journeys.
- A document database is not selected because PostgreSQL JSONB already represents the graph while preserving transactions, relational metadata, RLS, outbox atomicity, operational knowledge, and one fewer data platform.
- Redis persistence is rejected because eviction, loss, or cache inconsistency cannot erase a draft or published version.
- Python and Go remain valid specialized-worker options but do not currently offset the polyglot build, contract, telemetry, deployment, and team-context cost for ordinary graph validation and publication.
- Building graph-canvas infrastructure in the service is rejected. React Flow is presentation only, and Automation Runtime is execution only; Workflow owns the portable semantics between them.

Re-evaluate when representative graph validation or compilation becomes CPU-bound; publication queue age misses its SLO; collaboration requires a proven CRDT/OT architecture; workflow documents exceed PostgreSQL or API size/latency budgets; node-catalog evolution produces unsafe compatibility burden; VPS B lacks safe headroom; or an independent compliance, availability, or recovery boundary becomes necessary.

Primary references:

- [Node.js event-loop guidance](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [Hono on Node.js](https://hono.dev/docs/getting-started/nodejs)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [PostgreSQL JSON types](https://www.postgresql.org/docs/current/datatype-json.html)
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [RabbitMQ reliability](https://www.rabbitmq.com/docs/reliability)
- [RabbitMQ acknowledgements and publisher confirms](https://www.rabbitmq.com/docs/confirms)
- [React Flow documentation](https://reactflow.dev/learn)

### Automation Runtime execution stack

The initial Automation Runtime is a MailFlow-owned dynamic-graph interpreter implemented in TypeScript on Node.js 24. It is not a generic code-execution platform and does not execute JavaScript supplied by customers.

Execution responsibilities and state:

- PostgreSQL is canonical for workflow instances, immutable published-version references, node executions, attempts, branch and join state, scheduled transitions, pause/cancel state, terminal outcomes, and the product-visible execution timeline.
- A transaction records each accepted state transition and its outbox message together. RabbitMQ distributes execution commands and wake-up notifications after the outbox relay publishes them; it is not the source of workflow truth.
- Long delays are stored as indexed PostgreSQL `due_at` state and released by a recoverable scheduler using bounded leases and `SKIP LOCKED`-style claiming. RabbitMQ message TTL is not the canonical clock for journeys that may wait days or months.
- Workers acknowledge a RabbitMQ delivery only after the corresponding durable transition is committed. Redelivery is expected, handlers are idempotent, and external side effects remain at least once with provider idempotency and reconciliation where available.
- RabbitMQ DLQs support operational isolation and diagnosis, while PostgreSQL records the failed execution, retry policy, reason, operator action, and redrive result.
- Redis may implement distributed throttling, short leases, hot ephemeral counters, and presence. Losing Redis must not erase or invent a workflow transition.
- The first node catalog is deliberately constrained and versioned. Branching, joins, retries, delays, pause/resume, cancellation, and recovery are explicit state-machine semantics; arbitrary user code and an unrestricted expression language are excluded.

Temporal semantics for delays and schedules:

- Canonical instants, transition timestamps, and `due_at` values are stored as UTC PostgreSQL timestamps. The database clock supplies accepted and transition time at the durable transaction boundary; browser clocks and individual worker process clocks do not determine execution order or deadlines.
- A relative delay is an elapsed duration from its committed source transition. Runtime calculates and persists one UTC `due_at` in the same transaction that enters the delay state. It does not repeatedly recalculate the deadline, and DST or a later workspace-timezone change cannot alter it.
- A calendar-based schedule preserves both the user's local wall-clock intent and its explicit IANA timezone identifier, together with the resolved UTC occurrence, schedule-policy version, and calculation metadata. The browser may suggest a timezone but cannot silently become the stored execution timezone.
- The initial DST policy is deterministic: a nonexistent local time advances to the first valid instant after the gap; an ambiguous repeated local time executes once at the earlier occurrence. Workflow preview displays this resolution, publication pins the policy, and changing it requires a new immutable workflow version.
- Workspace timezone is an explicit workspace setting and may be the editor default. A node override must be explicit and authorized. Recipient-local execution is introduced only when a use case provides a validated timezone source and defines missing, invalid, changed, and inferred-zone behavior; location or browser data is never silently converted into a recipient timezone.
- Time-dependent conditions use an explicit instant captured in immutable execution context. They do not call an ambient `now()` during evaluation. Calendar parsing and formatting occur only through versioned typed contracts, never through locale-dependent string coercion.
- Scheduler claiming remains idempotent and due work is ordered against canonical PostgreSQL time. NTP monitoring, database-time drift alerts, timezone-database update tests, and fault tests cover restart, clock skew, DST gaps and overlaps, leap-day boundaries, pause/resume, and duplicate claims.

This stores more temporal metadata than a UTC timestamp alone, but preserves both the actual execution instant and the user's calendar intent. UTC-only calendar definitions, server-local time, fixed numeric offsets, and implicit browser timezone are rejected because they cannot represent future regional clock-rule changes safely.

Overdue and missed-occurrence recovery:

- A one-shot delay that becomes due during an outage, workflow pause, scoped hold, or capacity backlog remains the same durable transition with the same `due_at` and transition identity. Once every applicable gate permits execution, Runtime claims it idempotently and executes it exactly once; it is neither skipped nor recreated as a new delay.
- Recovery does not bypass workspace fairness, concurrency, rate, provider, entitlement, cancellation, or safety controls. Runtime records `due_at`, actual release time, lateness, blocking reason and duration, and claim identity so operators can distinguish expected catch-up latency from scheduler failure.
- A recurring schedule maintains a durable cursor for the last resolved occurrence. When one or more occurrences were missed, the initial policy creates one synthetic recovery occurrence representing the closed missed interval rather than creating one trigger per elapsed schedule.
- The recovery trigger contains the schedule definition and version, first and last missed instants, bounded missed-occurrence count or overflow classification, recovery acceptance time, timezone/policy version, and a stable recovery-occurrence identity. It does not carry a large list of every missed timestamp.
- Reconciliation derives the recovery identity deterministically from the schedule definition version and missed interval. Scheduler restart, duplicate claims, or concurrent scheduler replicas therefore cannot create two workflow instances for the same consolidated recovery occurrence.
- After committing that occurrence and advancing the cursor transactionally, Runtime calculates the next future calendar occurrence. The recovery trigger selects the workflow version through the accepted processing-time rule; it does not revive every historical workflow version that was active during the missed interval.
- Unlimited catch-up is prohibited initially because a long outage could create a burst of duplicate or obsolete email, AI, webhook, and domain actions. Alternative versioned policies such as `skip` or a tightly bounded per-occurrence catch-up may be introduced only for proven use cases with publication validation, quotas, cost preview, safety caps, and explicit customer semantics.
- Tests cover a single overdue delay, multiple missed recurring occurrences, long downtime, very dense schedules, overflow counts, DST transitions, pause/hold overlap, cursor transaction failure, duplicate scheduler claims, Runtime restart, and fair throttled recovery across workspaces.

Consolidation may not reproduce every historical calendar action. That trade-off is explicit and safer as the default than either silently skipping all missed work or unleashing an unbounded recovery storm.

Acyclic workflow-graph policy:

- Every initially publishable workflow graph is a directed acyclic graph. Workflow rejects self-edges, backward edges, direct or indirect cycles, unreachable nodes, invalid ports, and disconnected executable components before creating an immutable version. Runtime repeats structural validation during plan ingestion.
- Workflow compiles the accepted graph into a stable topological execution plan with versioned node and edge identities. Independent ready branches may still execute concurrently; acyclic does not mean sequential.
- Recurrence is modeled by a recurring trigger that creates a new independently pinned workflow instance. It is not a graph edge that returns an existing instance to an earlier node.
- Contact, recipient, campaign, or other domain fan-out remains an operation of the service that owns the collection and its policy. Automation Runtime receives bounded operation/result contracts and does not loop through an audience as customer-authored graph state.
- Arbitrary `while`, `repeat until`, backward-edge, recursive-subflow, and customer-code loops are excluded initially. This prevents unbounded node attempts, context growth, provider effects, costs, retention, and instances that cannot reach a terminal state.
- Publication enforces calibrated limits for total nodes, edges, depth, branch width, projected action cost, delays, and maximum reachable side effects. Exact numeric limits are implementation-time operational configuration and later entitlements, not values embedded permanently in the architecture.
- If representative use cases later require iteration, MailFlow evaluates a dedicated versioned iterator node rather than relaxing the DAG rule. Such a node must declare an immutable bounded input collection, maximum items/iterations, concurrency, per-item identity, total time/cost/output limits, cancellation, partial-failure, retry, resume, and aggregation semantics before publication.
- Validation and fault tests cover large graphs, hidden indirect cycles, imported malicious graphs, concurrent branches, topological-plan stability, unreachable terminals, duplicate node/edge identifiers, and future-version rejection.

The DAG restriction reduces initial expressiveness, but it keeps publication analysis, execution bounds, retry, join, cancellation, replay, cost prediction, and incident recovery tractable for two developers. A general cyclic interpreter is rejected until evidence justifies that correctness burden.

Single-trigger workflow contract:

- Every published workflow version has exactly one trigger node, one executable entry point, and one pinned versioned trigger-data contract. The trigger has no incoming executable edge, and every executable node must be reachable from it.
- Event, recurring schedule, manual, webhook, and future trigger families remain distinct catalog node types. A version chooses one family and contract; it does not expose a union-shaped context whose fields change according to which trigger fired.
- The trigger contract defines matching predicates, initial immutable variables, sensitivity and retention classification, producer or scheduler identity, idempotency source, and replay policy. Workflow validates every downstream reference against this one initial type environment.
- `stable_trigger_subscription_id` remains stable across ordinary workflow-version edits only while the logical trigger subscription remains the same. Replacing the trigger family, producer fact, schedule identity, or matching meaning creates a new subscription identity without rematching events already accepted under the previous one.
- Runtime stores the exact trigger type, contract version, subscription identity, source or occurrence identity, accepted timestamp, and minimal pinned input snapshot on each instance. A retry, redelivery, replay, or version cutover cannot reinterpret the instance as having started from another trigger.
- Similar automation initiated by different events is represented initially as separate workflows. Templates, cloning, and future reusable authoring components may reduce editor duplication, but they do not merge runtime trigger identities or databases.
- Composite OR triggers, multiple roots, and runtime unions are deferred. Reconsideration requires concrete shared-journey use cases and explicit semantics for cross-trigger idempotency, correlation, variable compatibility, simultaneous matches, ordering, replay, version changes, analytics, and authorization.
- Validation tests cover zero or multiple triggers, hidden secondary roots, changed subscription identity, incompatible trigger contracts, simultaneous producer events, duplicate delivery, replay, version cutover, and cloned workflow independence.

This may duplicate a shared downstream graph across workflows, but it preserves one typed origin and one idempotency domain per instance. Multiple implicit entry points are rejected because they make validation, audit, replay, and execution context depend on runtime unions.

Structured parallelism and join policy:

- Initial parallel execution is structured. A versioned `parallel` node declares a fixed bounded set of branch identities and a paired `join_all` node. Workflow publication proves that each opened branch is structurally contained by the pair and converges on that join before execution can leave the parallel region.
- Runtime transactionally creates one branch group and one durable branch token per declared branch when the `parallel` node completes. Duplicate delivery or worker restart finds the existing identities and cannot open an additional branch.
- Every branch reads the same immutable parent context and writes only its branch-local overlay and namespaced node outputs. Nested parallel regions are permitted only as correctly paired structures within calibrated depth, width, node, action, and cost limits.
- `join_all` becomes ready only after exactly one completion token has been durably accepted for every branch in its group. The join transition and output merge commit once under transactional uniqueness or equivalent locking; arrival order cannot affect output or release downstream work twice.
- A handled business failure may continue through its explicit failure path and reach the paired join. An unhandled definitive failure, cancellation, `attention_required`, or `suspended_system_error` does not fabricate a completion token: the join remains blocked or the instance follows its accepted terminal/suspension policy.
- Join outputs follow the accepted explicit deterministic merge mapping. The join never exposes another branch's partial output, resolves collisions by completion time, or refreshes external data while merging.
- Pause and scoped holds prevent new transitions but preserve committed branch and join tokens. Instance cancellation marks unfinished branches terminal under the cancellation policy without attempting to undo already completed external effects.
- `join_any`, race, first-success, first-response, implicit loser cancellation, and detached fire-and-forget branches are excluded initially. A future race primitive requires evidence plus explicit semantics for losing actions already dispatched, unknown outcomes, cancellation support, output choice, billing, retries, replay, and audit.
- Validation and fault tests cover mismatched pairs, branch escape, nested regions, duplicate tokens, simultaneous final arrivals, failure and suspension in one branch, restart around join commit, pause/cancel races, deterministic merging, and proof of single downstream release.

Structured `join_all` cannot express fastest-wins flows, but it prevents side-effecting branches from continuing invisibly after the graph has advanced and keeps recovery explainable.

Template and workflow-composition boundary:

- A workflow template is an authoring-time blueprint, not an executable dependency. Applying one creates or updates an ordinary workspace-owned draft through validated editor commands; the resulting draft and every published version are independently owned and versioned.
- Template updates never mutate existing drafts, published versions, active versions, or running instances. There is no hidden live link, inheritance chain, automatic propagation, or runtime lookup back to the template.
- Cloning or applying a template assigns new workflow, draft, node, edge, trigger-subscription, and referenced-resource binding identities as required. Provenance may record the source template and version for attribution and analytics, but it grants no execution authority and does not couple lifecycle.
- Applying a template rechecks workspace/team permissions, node entitlements, catalog compatibility, trigger configuration, referenced templates or assets, secret-reference slots, and policy limits. Secret values, tenant resource identifiers, credentials, and authorization decisions are never copied blindly across workspaces.
- Automation Runtime initially has no `invoke_workflow`, child-workflow, recursive workflow, dynamic workflow reference, or synchronous workflow-to-workflow call node. Each instance executes one pinned immutable graph and reaches its own terminal state.
- Reusable visual sections may later improve authoring, but expansion must produce an ordinary validated DAG at publication. They cannot conceal cycles, bypass graph limits, or become a runtime dependency merely because the editor displays them as one component.
- A future child-workflow capability requires evidence and an explicit versioned contract for pinned child version, typed inputs/outputs, tenant/team authorization, maximum depth and fan-out, recursion prevention, idempotency, parent/child cancellation, pause, retry, unknown outcomes, quotas, tracing, retention, deletion, and partial failure. It is not enabled by reusing template metadata.
- Tests cover same-workspace and cross-workspace application, inaccessible resources, secret placeholders, template updates after publication, cloning identity, deleted templates, imported malicious templates, and proof that Runtime execution remains available when template management is unavailable.

This accepts controlled authoring duplication in exchange for runtime isolation and immutable execution. Automatic template propagation and nested workflow invocation are rejected because they could change behavior outside the ordinary publication and acknowledgement lifecycle.

Preview, simulation, and real-test boundary:

- Workflow preview and dry-run are side-effect-free authoring capabilities. They validate and compile the selected draft revision, evaluate pure conditions, time calculations, mappings, branch structure, and deterministic merge behavior against bounded synthetic or explicitly supplied fixture data without creating a production Runtime instance.
- Action nodes in simulation use versioned schema-valid fixture outputs or action-owner-provided simulation contracts. They do not publish production commands, call a provider, consume a production secret, mutate domain state, send email, invoke a webhook, charge usage as a real effect, or claim that a simulated response proves provider availability.
- Simulation records are isolated from production execution history, idempotency keys, retry counters, quotas for real effects, analytics facts, and workflow trigger subscriptions. UI, APIs, logs, and exports label them clearly as simulated and preserve the draft revision, fixture version, evaluator version, and validation diagnostics needed for reproducibility.
- User-supplied fixtures remain untrusted workspace data. Workflow validates their schema, size, nesting, classification, authorization, retention, and redaction; confidential fixture values do not enter telemetry or reusable cross-workspace template assets.
- A real test operation is a separate versioned capability owned by the domain service that can safely perform it. For example, Mail may send a visibly marked test email only to an explicitly authorized and verified destination under Mail-owned provider, suppression, content, quota, rate, and audit policy.
- Each real test has a distinct `test_operation_id`, initiating actor, workspace, capability, target restriction, expiry, cost/usage classification, correlation identity, and audit record. It cannot reuse a production `action_operation_id`, satisfy a production node, advance a workflow instance, or be relabeled as production success.
- Services that cannot provide a safe constrained test contract expose validation or simulation only. MailFlow never promises a universal real dry-run or generic rollback for irreversible provider effects.
- Tests prove that simulation cannot reach RabbitMQ production command routes, provider clients, production secret adapters, domain-write repositories, or production instance tables, and that each real-test adapter enforces target allowlists, authorization, quotas, audit, duplicate handling, and visual identification.

This boundary requires separate simulation fixtures and domain-specific test endpoints, but it prevents a preview button from causing customer-visible effects or presenting mocked behavior as real provider evidence.

Node and contract-version lifecycle:

- Every trigger, condition, structural node, action, input/output schema, evaluator semantic, and retry profile has an immutable explicit version. Changing accepted fields, types, defaults, side-effect meaning, error classification, idempotency, authorization, cost, or execution semantics creates a new version rather than mutating the old one.
- New versions coexist with supported predecessors. Workflow pins exact catalog versions into each immutable publication artifact, and Runtime stores and executes the versions pinned by each instance; deploy order cannot silently upgrade a published workflow.
- Lifecycle states distinguish `candidate`, `active`, `deprecated_for_new_use`, `publication_blocked`, and `retired`. Deprecation removes a version from new editor selection and may block new publication while still allowing existing published versions, rollback targets, and running instances to execute under their original contract.
- The platform maintains a reference inventory across drafts, latest publications, active and rollback versions, retained instances, scheduled transitions, replay eligibility, test fixtures, and template provenance. A normal retirement is allowed only when the reference count is zero for every required support and retention horizon and rollback/replay policy can no longer select the version.
- Compatibility CI proves that Workflow compilation, Runtime ingestion/execution, domain-owner command/result handling, generated schemas, fixtures, and rolling deployment windows support every advertised version. A service deployment cannot remove an adapter merely because the newest editor no longer creates it.
- Migration is explicit and produces a new draft/publication after validation and user-visible review. MailFlow never rewrites a published graph or running instance in place to eliminate an old node version.
- A severe security, legal, provider, corruption, or correctness risk may place a specific version under an audited emergency safety block before its normal retirement conditions are satisfied. Runtime suspends affected new and existing execution at safe durable checkpoints, exposes impact and remediation status, and does not silently switch semantics, skip the node, or traverse a business edge.
- Emergency remediation may require republishing a replacement version, completing a controlled reconciliation, or cancelling affected instances. Authorization, impact preview, reason, scope, expiry/review deadline, customer communication, and release evidence are recorded separately from ordinary deprecation.
- Tests cover mixed-version fleets, rolling deploy and rollback, deprecation during draft editing, long-running delayed instances, replay after deprecation, zero-reference retirement, stale catalog caches, missing adapters, emergency block convergence, and attempted silent migration.

The coexistence window increases adapter and test maintenance, but it is the cost of reproducible long-running automation. Mutable contracts and retirement based only on current editor usage are rejected because historical instances and rollback remain executable dependencies.

Node-catalog contract bundle and distribution:

- Each capability-owning service remains the source owner for its trigger, action, command, result, API, event, policy, and simulation schemas. A central package never becomes the owner of Mail, Audience, Campaign, Content, AI, Billing, or another service's business semantics.
- Producer CI publishes immutable language-neutral JSON Schema, OpenAPI, AsyncAPI, fixtures, and compatibility metadata. A catalog assembly job pins accepted producer artifact versions and creates the private contract-only npm package `@mailflow/automation-catalog` in GitHub Packages.
- The bundle contains a checksummed manifest, stable node keys and versions, owner identity, lifecycle state, editor configuration schema, typed input and output schemas, command/result references, allowed retry profiles, side-effect and idempotency classification, required permissions and entitlements, sensitivity/retention classification, bounded presentation metadata, simulation fixtures, and compatibility evidence. It contains no repository, provider credentials, secret values, domain entities, handwritten business implementation, or executable customer code.
- Presentation metadata may describe label keys, category, icon identity, ports, field ordering, help references, and schema-driven controls. React components, React Flow objects, Base UI implementation, and browser state remain in `mailflow-web`; the package does not turn backend contracts into a shared frontend framework.
- Workflow pins an exact catalog package version and uses it to serve the node palette, construct configuration forms, type variable paths, validate graph connections and permissions, produce cost/safety previews, reject deprecated versions for new publication, and compile the immutable runtime plan.
- Runtime pins an exact compatible package version and uses it to validate ingested plans, node inputs, domain commands, progress/results, outputs exposed to downstream nodes, retry/error classifications, sensitivity controls, and supported evaluator semantics. The owner service still revalidates its command and current policy before any domain effect.
- The package is resolved only during dependency installation and image build. Workflow and Runtime images embed their supported catalog bundle and identify its version and checksum in health/deployment metadata; request handling and workflow execution never depend on GitHub Packages availability.
- `mailflow-web` does not install `@mailflow/automation-catalog`. Through the Gateway, it consumes a versioned workspace- and actor-scoped node-catalog projection from the Workflow API using the ordinary generated OpenAPI client.
- The browser projection contains only the presentation and authoring data required for the current actor: visible node key/version, localized label and help keys, category and icon identity, safe configuration schema and field hints, typed ports, allowed connections, lifecycle warning, and user-facing entitlement or permission reason. It excludes internal command/result schemas, routing keys, workload identities, provider details, secret metadata, internal retry/safety thresholds, unsupported capabilities, and cross-workspace information.
- Workflow derives this projection from its embedded catalog plus current Identity/Billing/feature-policy projections. The frontend may hide unavailable capabilities for usability, but every draft mutation, validation, and publication is authorized and validated again by Workflow; browser visibility never grants permission.
- Responses expose catalog projection version, checksum or ETag, and cache policy. Draft mutations include the observed projection/version where relevant; a stale browser receives a typed refresh or incompatibility response rather than having an old form silently reinterpret a newer node contract.
- Node-specific React components remain thin presentation adapters keyed by supported node type/version and operate only on the safe projection and draft API. Unknown or newly added node versions render a non-destructive unsupported-node state instead of executing arbitrary metadata or deleting configuration.
- This avoids a third independently pinned catalog dependency in the browser, keeps internal execution contracts out of public assets, and lets Workflow apply workspace permissions and lifecycle state consistently. The trade-off is that Workflow availability is required to load or refresh the editor catalog, which is already inherent to durable workflow authoring.
- A new node version follows a candidate-to-active rollout. Producer CI first publishes the immutable candidate schemas and fixtures. The capability-owning service deploys command/result support without exposing customer use, then Runtime deploys ingestion and execution support. Compatibility, fault, authorization, and rolling-deployment tests run against the exact target artifacts before catalog activation.
- Deployment inventory and health metadata prove that the owning service, Runtime, Workflow compiler, and required broker/API contracts support the candidate in the target environment. Workflow does not discover this through per-request live calls; CI and deployment orchestration compare immutable version/checksum evidence.
- Only after those gates pass does catalog assembly publish a new immutable catalog bundle that marks the node version `active`, and Workflow deploys that bundle. Its safe projection then exposes the node to eligible authors. This catalog promotion is distinct from promotion of a customer's workflow version.
- Runtime still validates every published plan and acknowledges ingestion under the accepted publication state machine. Catalog activation therefore cannot force an unsupported plan into execution if deployment inventory was stale or incorrect.
- Rollback blocks new selection/publication in Workflow first by applying the audited `publication_blocked` lifecycle state or emergency safety override. Owner and Runtime adapters remain available for already published and running instances while the fault is corrected; rollback never removes the only executable adapter before its references are gone.
- Rollout tests cover every partial order, stale readiness evidence, candidate hidden from the browser, producer/Runtime rollback, Workflow activation before support, mixed image versions, publication racing activation/block, and continued execution of an older supported version.
- This sequence adds deployment steps and delays feature exposure, but prevents the editor from offering a capability whose owner or Runtime cannot execute. A direct `publish package -> show node` path and live service-readiness checks during ordinary authoring are rejected.
- Exact versions and lockfiles are required. Compatibility CI tests producer implementation against its schemas, assembles the catalog deterministically, detects breaking changes, runs Workflow and Runtime consumer fixtures, verifies rolling-deployment matrices, and rejects a release whose generated working tree differs from committed source artifacts.
- Generated schemas, clients, validators, or fixtures are never edited manually in consumer repositories. A producer change must regenerate and publish its artifact, then an explicit dependency update changes the catalog and consumer images. Automated update pull requests may assist but never bypass compatibility review.
- Drift has two forms. **Invalid drift** occurs when service implementation, declared schema, generated client, bundle checksum, or deployed adapter disagree; CI, startup self-checks, contract tests, and deployment inventory must block or expose it. **Intentional version lag** occurs when a consumer remains pinned to an older still-supported contract; this is allowed, visible, and governed by the accepted deprecation/reference lifecycle.
- GitHub Packages/npm is selected because the first Workflow, Runtime, and action-owning consumers are TypeScript/Node.js, GitHub Actions is already the deployment pipeline, SemVer and lockfiles solve build-time pinning, and no new stateful registry is required for two developers. Private-package authentication and npm ecosystem bias are accepted operational costs.
- GitHub Actions run artifacts are not the canonical distribution channel because they expire. GitHub Releases or R2 would require MailFlow to build package resolution, permissions, lifecycle, and compatibility workflows. A central Git repository or submodules would weaken producer publishing and add manual pin/update drift. Live `/contracts` service calls would couple build or execution availability to producer services and could not reproduce historical bundles reliably.
- An OCI artifact in GHCR becomes the preferred next distribution option when Python, Go, external tooling, digest-based supply-chain controls, or language-neutral consumption makes npm materially awkward. Apicurio or another dedicated schema registry is reconsidered when service/contract/team count, dynamic discovery, centralized compatibility governance, references, or independent release frequency justify operating another stateful platform.

The functional boundary is: contracts describe what a capability accepts, guarantees, returns, classifies, and permits; the owning service alone decides how that capability is implemented. Sharing these data-only contracts reduces integration ambiguity without recreating a distributed monolith through shared domain code.

Primary references:

- [GitHub Packages npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)
- [GitHub Packages permissions](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages)
- [GitHub Actions artifact retention](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization)
- [ORAS artifact distribution](https://oras.land/docs/1.2/how_to_guides/pushing_and_pulling/)
- [Apicurio Registry concepts and version states](https://www.apicur.io/registry/docs/apicurio-registry/3.3.x/getting-started/assembly-registry-concepts-glossary.html)
- [Apicurio Registry rule maturity](https://www.apicur.io/registry/docs/apicurio-registry/3.3.x/getting-started/assembly-rule-reference.html)

Typed condition-expression contract:

- Workflow conditions are represented by a MailFlow-owned, versioned, typed JSON AST. This follows the same safety philosophy as the Audience segment-rule AST, but each bounded context owns its own contract, operator catalog, evolution, validation, and execution semantics. The services do not share domain implementation code merely because both structures are JSON expression trees.
- The initial allowlist supports boolean composition such as `all`, `any`, and `not`; typed equality and ordering comparisons; explicit existence and null checks; and bounded operators for strings, numbers, dates, booleans, enums, and allowlisted collections. Arithmetic, arbitrary functions, dynamic property traversal, and regular expressions are excluded initially.
- Operands are either typed literals or declared variable paths supplied by the pinned trigger contract, system execution context, or typed outputs of previously completed nodes. A condition cannot discover fields dynamically, query another service, access a secret, or refer to a value absent from its published variable catalog.
- Condition evaluation is pure and deterministic: no network or database I/O, provider calls, side effects, randomness, ambient process state, or implicit wall-clock access. Time-dependent logic must use an explicit typed value captured in the execution context under the workflow's defined clock semantics.
- Workflow validates field availability, types, operators, authorization, AST depth, total node count, literal size, and collection cardinality while editing and again at publication. It compiles the accepted AST into the immutable runtime plan and pins the expression-contract and evaluator-semantic versions.
- Runtime validates the compiled condition again at ingestion and evaluates only supported pinned semantics. An unknown operator, unsupported version, invalid type, or malformed plan fails closed; it never falls back to coercive evaluation or the newest evaluator behavior. Already-created instances retain the semantics pinned by their immutable workflow version.
- Contract tests and golden fixtures prove identical validation and evaluation behavior across Workflow publication and Runtime ingestion/execution. Generated schemas and fixtures may be shared as contract artifacts, but neither service imports the other's domain implementation.
- JavaScript, `eval`, SQL, JSONLogic, CEL, and other customer-supplied expression runtimes are rejected initially. This avoids code execution, injection, denial-of-service, coercion, portability, and compatibility risks that are disproportionate to the first bounded node catalog. CEL may be reconsidered if measured operator growth, tooling burden, interoperability needs, or evaluator maintenance makes the owned AST more costly or less safe than a sandboxed standard language.

Strict condition-value semantics:

- `missing` and explicit `null` are distinct typed states. A missing path means that the declared optional value was not supplied; `null` means that the value was supplied with an explicit empty value permitted by its schema.
- Ordinary equality, inequality, ordering, string, date, and collection comparisons return `false` when an operand is either `missing` or `null`. Authors must use explicit allowlisted predicates such as `isMissing`, `isPresent`, `isNull`, and `isNotNull` when either state is meaningful. Even `null` compared with `null` does not become an implicit business match.
- The evaluator performs no implicit coercion between strings, numbers, booleans, dates, enums, collections, `null`, or `missing`. For example, the string `"10"` is not equal to the number `10`, and an untyped string is not silently parsed as a date. Normalization or parsing must occur in a declared typed node or producing contract.
- Workflow rejects statically incompatible operands, invalid optional-path use, and unsupported operators before publication. Runtime repeats validation when ingesting a plan and validates every external node output against its pinned schema before making it available to conditions.
- If runtime data violates a declared type despite those boundaries, condition evaluation does not convert the violation into `false`. The condition node records a typed contract error, fails closed, and emits only schema path, expected/observed type classification, contract version, and diagnostic correlation metadata; confidential values are not copied into logs or events.
- Golden fixtures cover missing paths, explicit nulls, wrong types, boundary values, Unicode strings, dates, empty collections, nested boolean groups, and evaluator-version compatibility. The frontend preview, Workflow validator, and Runtime evaluator must agree on these results.

This strictness requires authors to handle optional data deliberately, but it prevents schema drift, provider anomalies, and ambiguous coercion from silently selecting a workflow branch.

Immutable execution-context model:

- Every node transition reads a durable immutable context snapshot. Trigger data and versioned system execution data are read-only; a node never mutates a shared global object. Each completed node publishes a typed immutable output under its stable node namespace, and downstream references resolve only paths declared by the pinned plan.
- Node attempts remain separately recorded for diagnostics and retry history. Only the canonical accepted completion for a node supplies its downstream output; a late, duplicate, failed, superseded, or unknown attempt cannot overwrite that output.
- Parallel branches begin from the same immutable parent snapshot and write only to branch-local overlays and their own node namespaces. They cannot observe another branch's partial work or race through last-write-wins mutation.
- A join exposes data only through a versioned explicit merge mapping and conflict policy validated at publication. The initial policy requires unique output destinations or an allowlisted deterministic aggregation; ambiguous collisions fail publication or execution validation instead of depending on worker completion order.
- The committed join result becomes another immutable namespaced output. Retries and replay reuse the recorded inputs and accepted upstream outputs, so scheduling order, process restart, or later external state cannot silently change a completed decision.
- Data needed from current external state is obtained through an explicit typed domain query or action at the appropriate node, never by mutating or implicitly refreshing the instance context. Secrets remain service-owned and are represented only by authorized opaque references when a contract requires one.
- Workflow validates variable reachability, path types, branch scope, merge compatibility, and output-size limits before publication. Runtime validates these invariants at plan ingestion and enforces bounded context, output, and collection sizes during execution. Unsupported or oversized output fails closed with a typed operational result.
- PostgreSQL stores canonical context references, node outputs, branch overlays, merge decisions, checksums, and retention metadata. Large justified outputs use an immutable integrity-checked artifact reference rather than enlarging every row, event, or action payload; this is evidence-triggered and does not make R2 the default variable store.

This model adds explicit mapping work to joins and may retain repeated small values, but it makes parallel execution, pause/resume, retry, replay, audit, and incident reconstruction deterministic. Mutable global workflow variables and implicit last-write-wins merging are rejected because they make outcomes depend on concurrency timing.

Execution-outcome and system-error taxonomy:

- A normal business decision is not an execution error. A successfully evaluated condition records its typed inputs and deterministic boolean result, then traverses exactly its `true` or `false` edge.
- A definitive domain-action failure is an expected action outcome only when the pinned action contract classifies it as such. After the accepted retry policy is exhausted, Runtime traverses the explicitly configured definitive-failure edge; if no such edge exists, the instance reaches its declared failed terminal policy.
- A transient technical failure remains inside the owning service's technical retry or Runtime's eligible semantic-retry policy. It cannot prematurely traverse a business failure edge. An unknown external-effect outcome remains the separately defined `attention_required` state and cannot be treated as either success or failure.
- A violated schema, expression type mismatch, unsupported evaluator behavior, corrupted state, checksum mismatch, or Runtime invariant failure is a platform or contract error, not a customer business result. Runtime durably checkpoints the instance as `suspended_system_error`, prevents downstream traversal and new side effects on the affected dependency path, and raises typed operational telemetry.
- `suspended_system_error` is distinct from `failed`, `cancelled`, and unknown-outcome `attention_required`. The UI may present each as requiring intervention, but APIs, metrics, alerts, audit records, and recovery permissions preserve the exact category and never expose confidential values in diagnostics.
- Recovery requires evidence that the underlying fault is corrected, revalidation of the pinned workflow version, context, checksums, contracts, and intended next transition, followed by an explicitly authorized and audited resume. Runtime continues from the same durable checkpoint and immutable instance version; it does not restart the workflow, invent a new trigger, skip the node, or resend a previously accepted side effect.
- A corrected producer or action-owner result may be accepted only through its versioned reconciliation contract and original correlation or operation identity. Operators cannot directly edit canonical node outputs or instance context to make recovery pass.
- Fault-injection and contract tests cover every category, late and duplicate outcomes, retry exhaustion, invalid outputs, corrupted references, restart during suspension, authorization, audited resume, and proof that no business edge or side effect occurs from a system error.

This extra state and recovery path add operational complexity, but they prevent infrastructure defects and contract drift from becoming legitimate customer decisions or hidden workflow branches.

Domain-action execution contract:

- Automation Runtime owns orchestration state but never performs a domain side effect belonging to Mail, Audience, Campaign, Content, AI, Billing, or another bounded context. It does not call those services' providers directly, read their databases, reuse their credentials, or reimplement their policy.
- When a domain action node becomes ready, a Runtime transaction creates one durable node-execution intent, assigns a stable `action_operation_id`, moves the node to a waiting state, and records the versioned outbox command. The command carries only the workspace, operation, instance/node, contract/version, bounded typed inputs or resource references, stable `execution_authorization_id` and generation, approved capability or binding, initiating decision metadata, and correlation/causation identifiers required by the owner. It contains no expiring workload, delegated-user, or automation token.
- `action_operation_id` is created once per logical node execution and is reused across outbox publication, RabbitMQ redelivery, owner-worker retry, provider retry, result-event redelivery, and reconciliation. Transport or provider attempts receive separate attempt identifiers for observability; they do not create a new logical side effect.
- The owning service consumes the command through its least-privilege broker identity, validates its schema, workspace scope, stable authorization reference/generation, and durable local projection, rechecks current resource state, entitlement, suppression/safety policy, and any authorization that cannot remain valid from publication time, then records its operation and outbox state under its own transaction boundaries.
- The owning service, not Runtime, maps the stable operation to any provider idempotency mechanism, classifies provider failures and uncertain outcomes, owns retries and reconciliation, and persists the canonical domain result. Runtime cannot bypass an unavailable owner by invoking the provider itself.
- The owner publishes a minimal versioned terminal or progress result correlated by `action_operation_id`, instance, node execution, workspace, and causation identifiers. Runtime consumes results idempotently and advances the graph only after committing the corresponding durable node transition; duplicate or stale outcomes cannot execute downstream nodes twice.
- Fast, bounded, read-only data needed to evaluate the next deterministic transition may use an authenticated versioned REST call under the accepted synchronous-depth, timeout, circuit-breaker, and degraded-behavior rules. Variable-duration work and every domain mutation use the asynchronous command/result path.
- Domain-specific compensation is represented as another explicit allowlisted action owned by the relevant service. Runtime does not invent a universal rollback for an email already sent, a campaign launched, a contact changed, or an external provider effect.

Layered retry ownership:

- A domain action contract separates technical attempts from semantic node attempts. The owning service controls transport, connection, throttling, provider, and reconciliation attempts for one `action_operation_id`; Runtime controls whether a definitively failed node may become a new logical attempt.
- Technical retries retain the same `action_operation_id` and follow the owner's bounded maximum attempts, elapsed time, deadlines, backoff with jitter, provider idempotency window, circuit breaker, and reconciliation policy. Runtime waits for progress or a definitive owner result and never runs a competing technical retry loop.
- The versioned node/action catalog declares whether the capability is `semantic_retry_safe`, which definitive failure classifications permit it, and the platform maximum semantic attempts, elapsed duration, cost/usage, and backoff range. Unknown, successful, policy-rejected, unauthorized, suppressed, cancelled, or still-reconciling outcomes never qualify.
- When a definitive eligible failure remains within the total budget, a Runtime transaction creates a new node-attempt identity and new `action_operation_id`, links them to the failed attempt, persists the next `due_at`, and records its outbox/scheduler state. The prior operation remains immutable and cannot later be mistaken for the new effect.
- Semantic retry scheduling uses canonical PostgreSQL state and the recoverable scheduler, not RabbitMQ TTL as the clock. Pause, cancel, applicable holds, entitlement changes, and current owner safety policy are rechecked before dispatching the next attempt.
- The owner result reports bounded attempt, elapsed, provider classification, idempotency/reconciliation, and cost metadata without confidential content. Runtime combines this with its semantic-attempt history to enforce one visible total policy and prevent multiplicative retry budgets hidden across layers.
- Exhausted semantic budget follows the workflow's explicit definitive-failure edge or terminal node policy. It never changes into `ActionOutcomeUnknown`, and an unknown outcome never consumes a new semantic attempt automatically.
- Contract and fault tests prove exact attempt counts across duplicate commands/results, owner retry exhaustion, Runtime retry scheduling, restart, pause/hold, circuit-breaker transitions, cancellation races, and late outcomes from an earlier operation.

Retry-profile governance:

- Workflow authors initially select only versioned retry profiles permitted by the node/action catalog, such as a no-semantic-retry profile, the action's safe default, or a bounded extended profile where the capability supports it. Exact profile names and numeric values are calibrated during implementation; the architecture fixes their ownership and limits, not speculative constants.
- A profile defines the maximum semantic attempts, eligible definitive failure classes, backoff strategy and bounded range, jitter policy, maximum elapsed duration, cost/usage ceiling, and terminal behavior. It cannot weaken provider idempotency, reconciliation, safety, authorization, suppression, entitlement, hold, or cancellation rules.
- The catalog declares which profiles each action contract/version allows and its default. Workflow publication validates the selection, workspace entitlement, editor capability, graph-level retry/cost budget, and referenced catalog version, then pins the accepted profile ID/version into the immutable runtime plan.
- Authors cannot enter unlimited attempts, arbitrary code or expressions, unbounded delays, or raw provider retry parameters. Technical retry policy remains owned by the action service and is never exposed as workflow configuration.
- Runtime applies the most restrictive of the pinned profile, current workspace entitlement/quota, emergency platform safety cap, and current owner-contract maximum. A later plan downgrade or provider-safety reduction may clamp future attempts but never manufactures an attempt or reclassifies an unknown outcome.
- Catalog profile evolution creates a new version and compatibility policy. Existing instances remain explainable from their pinned plan and recorded effective cap; an emergency downward safety override is separately versioned, visible, and audited.
- Advanced numeric retry configuration is reconsidered only when representative customer use cases cannot be expressed by bounded profiles and the support, cost-prediction, abuse, validation, migration, and observability burden is justified by evidence.

Uncertain action outcomes:

- The owning service distinguishes a definitive success, definitive terminal failure, safely retrying/reconciling progress, and an outcome that remains unknown after its bounded provider-specific reconciliation policy. A timeout or lost response is never automatically classified as failure.
- Safe retries reuse the same `action_operation_id` and are permitted only when the owner can prove idempotency or non-execution under the provider contract. The owner never creates a new logical operation merely because its transport or provider attempt timed out.
- When the owner cannot prove whether the external effect occurred, it emits `ActionOutcomeUnknown` with the stable operation identity, classification, non-confidential diagnostic reference, reconciliation history metadata, and evidence timestamps. It does not expose provider secrets or confidential payloads in the event.
- Runtime commits the affected node and branch to `attention_required`, records the unknown outcome in the execution timeline, and does not traverse either a success or failure edge. Independent parallel branches may continue when their join semantics do not depend on the blocked branch; the overall instance cannot report successful completion while an outcome remains unknown.
- Automatic retry, automatic compensation, automatic fallback provider execution, and automatic creation of another `action_operation_id` are prohibited from `attention_required`. Any of them could duplicate an email, charge, webhook, campaign operation, AI tool action, or other irreversible effect.
- Background reconciliation may later resolve the same operation as succeeded or definitively failed and publish an idempotent result. Otherwise, an authorized workspace operator with the explicit incident-resolution permission may record an audited resolution or authorize a new logical execution after a risk warning. The decision stores actor, reason, evidence, previous operation, new operation when applicable, and timestamps.
- Platform administration may monitor aggregate health and facilitate recovery but does not gain tenant-content access or silently adjudicate an unknown customer action. Escalation, age, and unresolved-count alerts make `attention_required` visible rather than allowing it to remain hidden indefinitely.
- Cancellation or workflow pause does not erase an unknown operation. A later provider result is still reconciled and audited, while cancellation policy determines whether downstream execution remains prohibited.

Workflow pause and resume semantics:

- A workflow pause is a resumable safety state applied through the accepted monotonic desired-state generation. Once Runtime applies it, the workflow's trigger subscriptions are removed from new matching and workers do not begin a new node transition for its existing instances.
- Pause takes effect at durable transition boundaries. A worker rechecks the applied generation before committing a new action intent or releasing a due transition. Work already committed or dispatched to an owning service may have crossed the cancellation boundary and is not blindly revoked, recalled, or resubmitted.
- Results for in-flight actions continue to be consumed, reconciled, and persisted while paused. A successful or failed result may complete the current node, but the next node remains durably pending until resume. An unknown result remains `attention_required` under the accepted policy.
- Delay nodes retain their original `due_at` and become paused-pending when due. Resume releases eligible delayed and ready transitions with per-workspace concurrency and throttling rather than creating an unbounded catch-up spike.
- A source event first accepted after pause is applied cannot match the paused subscription and is not automatically enrolled later. A source event whose fan-out plan was durably accepted before the pause retains that plan, but any resulting instance stops at the first applicable durable checkpoint. Recovering missed enrollment requires an explicit authorized replay with its own `replay_id` and audit evidence.
- Resume preserves the instance, pinned workflow version, node state, action operation identities, attempts, variables, due timestamps, and timeline. It continues from durable state; it does not interpret “resume” as sending the last external action again.
- Pause and resume acknowledgements expose desired generation, applied generation, affected active-instance counts, in-flight counts, delayed counts, and any convergence lag. A workflow is not shown as fully paused until Runtime acknowledges the matching generation, although the UI may immediately show `pausing`.

Enabled, disabled, paused, and cancelled semantics:

- `enabled` admits matching source events and permits existing instances to claim their next durable transitions under normal concurrency, quota, and safety controls.
- `disabled` removes the workflow from new trigger matching but does not freeze, terminate, or change the pinned versions of instances already accepted. Those instances continue to completion unless separately paused or cancelled. Publishing while disabled updates `latest_published_version_id` without enabling it.
- `paused` removes the workflow from new trigger matching and prevents existing instances from beginning new transitions at the accepted checkpoints. It is explicitly resumable with the same instance and operation identities.
- `cancelled` is a terminal state for the selected workflow instance or explicit set of instances, not another resumable workflow desired state. Cancellation prevents all not-yet-committed transitions and downstream traversal. Already dispatched external effects are not undone; their later outcomes are reconciled and retained in the cancelled timeline.
- Cancelling one instance, a filtered set, or all active instances is a separate idempotent capability-controlled command with explicit scope, impact preview, confirmation, reason, actor, correlation identity, and audit record. A broad cancellation never hides behind the ordinary disable control.
- A cancelled instance cannot be resumed. Reprocessing requires an explicit replay or new instance with a new audited execution identity while preserving links to the cancelled source and prior action operations. No replay may silently reuse a completed or uncertain external side effect.
- UI and APIs display desired workflow state, applied Runtime state, and instance terminal state separately. Counts for running, checkpoint-paused, in-flight, `attention_required`, completed, failed, and cancelled instances prevent a disabled workflow from appearing operationally empty while older work continues.

Automation engine operational hold:

- Pausing the Automation engine is a platform operational hold, not a customer workflow-state mutation. Runtime PostgreSQL stores a separately authorized, audited, monotonic engine-control generation with `holding`, `held`, `resuming`, and `running` convergence states. Applying it does not rewrite each workflow's desired state.
- In `holding` or `held`, Runtime does not claim due transitions, begin new node transitions, or create new domain-action intents. Workers complete only the local transaction already past its durable boundary; action commands already committed or delivered remain under the owner/reconciliation policy.
- Trigger ingress continues validating and durably accepting source events, persisting their first-match fan-out plans and held instances while safe persistent-capacity headroom remains. Unlike a customer workflow pause, an operational incident does not silently discard enrollment that MailFlow was responsible for processing.
- Result consumers continue recording outcomes for in-flight actions, including definitive and unknown outcomes, but downstream nodes remain held. Control/API, health visibility, reconciliation, cancellation, and incident-resolution operations remain available according to their own dependency state.
- Runtime enforces configured database, queue, fan-out, instance, and per-workspace high-water marks during the hold. When durable acceptance approaches a safety limit, it stops or reduces trigger consumption and acknowledgements through bounded prefetch/consumer backpressure so RabbitMQ retains the remaining messages under its capacity and retention policy. It never acknowledges an event that exists only in memory.
- Resume is a controlled recovery phase. Fair per-workspace scheduling, action-family/provider limits, due-time ordering policy, queue prefetch, and bounded concurrency release held ingress, timers, retries, and ready nodes gradually. Recovery age, backlog, estimated drain time, starvation, provider health, and database/broker headroom gate acceleration.
- A source event accepted during the hold follows the accepted processing-time semantics and pins the trigger/version state visible at that acceptance. A later customer pause, disable, or cancellation does not rematch the event; explicit instance cancellation remains available before execution resumes.
- API readiness and execution readiness are separate. The dashboard and alerts show the hold reason, actor or automatic policy, generation, started time, accepted backlog, broker backlog, in-flight operations, unresolved outcomes, and resume progress. The engine never reports normally running merely because its HTTP API is healthy.
- Local and distributed tests cover hold races at every durable boundary, broker and database high-water marks, consumer backpressure, result arrival during hold, provider recovery, restart while held, repeated hold/resume commands, and fair throttled backlog drainage.

Operational hold scopes:

- Runtime supports independently versioned `global`, `workspace`, and `action_owner/provider` hold scopes. Each record contains a stable scope key, monotonic generation, desired/applied state, reason code, human-readable operational note, manual or automatic source, actor or policy identity, timestamps, optional reviewed expiry, correlation identity, and audit history.
- A global hold blocks every new execution transition and domain-action intent while preserving the accepted ingestion and reconciliation behavior above. It is reserved for systemic Runtime, database, broker, security, or correctness incidents rather than ordinary dependency degradation.
- A workspace hold applies only to that tenant's new transitions and actions. Other workspaces continue under their own quotas and fairness limits. An operational workspace hold preserves accepted events; billing cancellation, security suspension, or abuse rejection remains a separate product/policy state that may prohibit new admission instead of accumulating work.
- An `action_owner/provider` hold blocks only new intents for matching action contracts, such as Mail delivery through Resend or AI execution through an approved model provider. Unrelated delays, conditions, owner contracts, and workspaces continue. A branch reaching the held action becomes durably provider-held rather than failing or switching provider without an approved policy.
- Holds compose by most restrictive applicable scope. Clearing a provider hold cannot override a workspace or global hold; clearing a workspace hold cannot override a global hold. Every claim and action-intent transaction evaluates the currently applied scope generations so stale clear commands cannot reopen execution.
- Owning services retain their own provider circuit breakers, idempotency, rate limits, and reconciliation. Runtime's scoped hold prevents dispatch pressure but does not replace the owner's last-line policy or authorize direct provider fallback.
- Platform operators can manage these scopes without opening tenant content. Workspace-visible status exposes the affected capability, impact, start time, and recovery state without exposing another tenant, provider secret, or internal security diagnostic.
- Metrics partition held instances, due transitions, action intents, backlog age, and drain rate by scope without using raw workspace identifiers as high-cardinality public metric labels. Tests cover overlapping scopes, stale generations, clear precedence, provider-only recovery, and fairness while one tenant remains held.

Automatic trip and release policy:

- Only a technical `action_owner/provider` hold may be opened automatically by the initial circuit-breaker policy. Versioned owner-health facts and Runtime observations such as bounded timeout, transient-error, throttling, rejection, latency, and unknown-outcome rates feed the decision. Thresholds and windows are configuration calibrated from production evidence, not permanent architecture constants.
- An automatically opened hold persists durably with its triggering evidence and generation. It does not disappear because a process restarts, a Redis key expires, a monitoring gap occurs, or wall-clock TTL elapses.
- Recovery enters `half_open` only after the owning service reports a candidate recovery and minimum cool-down conditions pass. Probes use provider health capabilities where meaningful or a tightly limited sample of already-authorized queued operations with their existing `action_operation_id`; MailFlow never creates synthetic customer side effects merely to test a provider.
- Successful probes move the scope to `resuming` and release backlog gradually under reduced concurrency. A failed or unknown probe reopens the hold without creating a new logical action. Full release requires a configured success volume/window plus acceptable latency, throttling, unknown-outcome rate, and owner-health state.
- A manual provider release requires capability authorization, reason, current evidence, impact preview, and audit. It may override an overly conservative technical breaker but cannot override a global, workspace, security, billing, abuse, entitlement, suppression, or owner-service safety block.
- Global holds and workspace holds created for security, billing, abuse, compliance, data-integrity, or correctness reasons require explicit authorized release. An optional expiry is a review/alert deadline only; it never auto-clears those holds. Automated recovery recommendations may be displayed without applying the decision.
- Runtime consumes the owner's health/hold projection asynchronously and retains its own defensive breaker. It does not make a synchronous provider-health call before each action and does not interpret missing health telemetry as proof of recovery.
- Tests cover noisy/flapping providers, false trips, process restart, stale health facts, `half_open` concurrency, duplicate results, failed probes, overlapping manual holds, no-traffic recovery, and gradual backlog release without a retry storm.

Hierarchical concurrency and capacity admission:

- Every new transition or domain-action intent must fit all applicable limits: platform/global capacity, workspace entitlement and safety cap, workflow cap, action owner/contract cap, provider cap, and any current hold or quota. Availability at one level never bypasses exhaustion at another.
- PostgreSQL is canonical for ready transitions, durable leases, active-instance accounting, in-flight action operations, applied limits, and recovery evidence. Claiming uses bounded transactions and `SKIP LOCKED`-style selection; lease expiry and idempotent state checks recover abandoned local work without inventing another domain effect.
- Limits distinguish active instances, locally executing transitions, delayed/waiting transitions, and externally in-flight action operations. A delay or action waiting for a result does not hold a scarce CPU/worker-transition slot indefinitely, but it continues to count against the relevant active-instance, in-flight, cost, and provider limits.
- A transition transaction reserves the required canonical capacity before moving work to running or creating an action intent, and releases or converts that reservation when the durable state changes. Crash recovery is driven by lease and operation state rather than an in-memory semaphore.
- The scheduler provides bounded fairness across workspaces before selecting work inside a workspace and workflow. A high-volume tenant cannot consume every worker or connection while another eligible tenant remains perpetually queued. Priority and age may influence order only inside documented starvation bounds.
- Billing supplies a local versioned entitlement/quota projection, but platform safety ceilings, provider limits, abuse controls, suppression, and operational holds remain independent and may be stricter. Missing or stale entitlement data follows the accepted conservative policy rather than granting unlimited work.
- Redis may accelerate distributed token buckets, provider rate windows, hot counters, and short coordination leases. It is never the only record that a transition or action was admitted. Redis loss uses conservative PostgreSQL-backed or reduced static limits, or holds the affected action family when correctness cannot be preserved.
- Owning services repeat their own provider concurrency/rate enforcement. Runtime admission limits dispatch pressure and tenant fairness; it does not reserve capacity inside a provider or make the owner trust an upstream counter.
- Numeric limits, lease durations, reservation batch sizes, and worker prefetch are calibrated from production-like load, provider contracts, VPS C headroom, managed database/broker limits, and plan design. Metrics expose utilization, wait time, rejections, lease recovery, fairness, starvation, and throttling without confidential payloads or unbounded tenant labels.
- Fault and load tests cover concurrent replicas, double claims, lease expiry, slow/unknown actions, Redis loss, database contention, hot tenants, provider throttling, plan changes, holds, restart, and backlog recovery while proving that every scope remains within its effective cap.

Initial fair-scheduling policy:

- Scheduler selection is workspace-first rather than one global FIFO. Runtime maintains canonical workspace scheduling state for tenants with eligible work and repeatedly selects the least recently served eligible workspaces under row-level claiming, then grants each a small bounded dispatch quantum before rotating.
- Work inside the selected workspace is ordered by eligible priority class and `due_at`, with a stable tie-breaker. Safety/control and result-reconciliation lanes may receive protected capacity, but customer-authored workflows cannot create arbitrary priority values that starve ordinary work.
- Aging increases the scheduling urgency of work that has waited beyond configured thresholds while preserving all global, workspace, workflow, action, provider, and hold limits. It never converts ineligible work into eligible work or bypasses a safety block.
- The initial scheduler gives every eligible workspace the same base service opportunity. Commercial plan weights, reserved throughput, or burst credits are not assumed before Billing defines them and measured capacity proves they can coexist with a non-zero minimum service and bounded maximum delay for smaller tenants.
- A quantum limits transitions claimed for one workspace in a pass and is tuned with worker count, transaction cost, active-workspace count, and backlog. Unused capacity may be borrowed, but one hot tenant cannot reserve idle global capacity permanently or monopolize all database claims.
- Fairness is best effort within explicit bounds, not a promise of strict event ordering across independent workflows or branches. Ordering that is a domain invariant must be modeled by workflow state, joins, keys, or serialization constraints rather than inferred from scheduler timing.
- Global FIFO is rejected because one import, campaign, resumed hold, or hot workspace could create head-of-line blocking for every tenant. Unbounded priority queues and plan-paid starvation are also rejected.
- Metrics and deterministic load tests measure per-workspace wait distributions, oldest-ready age, dispatch share, quantum use, starvation, hot-tenant impact, database claim contention, and recovery after a large backlog. Replace the initial algorithm only when evidence shows its fairness or throughput misses the accepted SLO.

Production deployment and placement:

- Automation Runtime starts production on VPS C, in a failure and resource domain separate from the VPS B Workflow control plane and the critical VPS A Gateway/Identity/Mail plane. Local development and homologation may co-locate containers; production activation does not.
- Runtime has its own repository, immutable image, Compose project, logical PostgreSQL database, credentials, migrations, RLS policies, Infisical project/scope and machine identity, telemetry identity, deployment lock, health checks, resource limits, rollback target, and backup/restore procedures.
- The same immutable image runs separate `automation-api`, `automation-scheduler`, and one or more `automation-worker` containers with distinct startup commands and least-privilege database/broker roles where practical. The API serves authorized monitoring and control operations; the scheduler releases durable due transitions; workers execute bounded node transitions.
- Scheduler and worker failure never make the Runtime API appear healthy for execution readiness. Process-specific readiness, liveness, queue-age, due-transition lag, lease, event-loop, database-pool, and dependency metrics expose partial degradation.
- Gateway reaches the Runtime API only over the private service network with workload and delegated tokens. Workflow primarily publishes through RabbitMQ. Runtime calls Mail, Audience, Campaign, Content, AI, or other action-owning services only through versioned authenticated contracts; it never reads their databases or imports their domain code.
- Runtime connects directly to its managed PostgreSQL, RabbitMQ, Redis, and authorized provider dependencies. VPS A or B never proxies those connections.
- VPS A, VPS B, and VPS C use direct WireGuard peer links in a full mesh. A never relays B-C traffic, B never relays A-C traffic, and C never relays A-B traffic. This removes a host-level transit bottleneck and allows Gateway-to-Runtime, Workflow/Audience-to-Runtime, and Runtime-to-owning-service calls to take the direct private path.
- Each host has its own environment-specific WireGuard key pair and fixed tunnel address. `AllowedIPs`, provider-native firewalls—OCI NSGs or DigitalOcean cloud firewalls—and host firewalls expose only the peer routes and service ports required by the accepted call graph. Internal DNS names resolve to tunnel addresses; possession of a host key grants transport reachability only and never domain authorization.

Why VPS C is justified:

- Runtime maintains continuous consumers, schedulers, timers, retries, parallel branches, external calls, and recovery work. Its load and incident profile differ materially from interactive authoring and ordinary request/response APIs.
- VPS A already carries the highest-impact Gateway, Identity, Mail, ClamAV, and later Billing failure domain. Runtime contention, retry storms, or provider incidents cannot be allowed to reduce mail reception, authentication, or inbox availability.
- VPS B already carries Audience, Campaign, Content, and conditionally Workflow. Adding Runtime would turn most later product capabilities and their background workloads into one host-level noisy-neighbor and outage boundary.
- Separate compute allows workers and scheduler resources to scale or restart without scaling or restarting Workflow. A malformed workflow, slow provider, queue backlog, or Runtime deployment cannot consume Workflow authoring capacity.
- The third host makes the accepted control-plane/data-plane split operationally real and supplies the intended distributed-systems learning: multi-host identity, routing, failure injection, telemetry, recovery, and independent deployment.
- By the Automation release, MailFlow has passed the MVP and first service extraction. If a production VPS C is not operationally or financially supportable, production Automation is delayed rather than placed on the critical VPS A or an unsafe VPS B.

Failure and cost trade-offs:

- VPS C adds compute cost, patching, secrets, network policy, deployment, monitoring, backup exercises, and another failure boundary. That cost is accepted only when Automation is activated in production; it is not an MVP expense.
- One VPS C is isolation, not high availability. Host loss pauses new transitions and external actions until recovery, while PostgreSQL and RabbitMQ preserve durable state. Recovery resumes idempotently from due transitions, unacknowledged deliveries, checkpoints, and reconciliation.
- Mail, Identity, inbox, Campaign authoring, Content, and Workflow publication remain independently available according to their own host/dependency state during a Runtime outage. Already running journeys are delayed, never falsely reported as completed.
- Runtime receives hard CPU, memory, connection, concurrency, queue-prefetch, provider-rate, and per-workspace limits. Horizontal replicas or additional worker hosts are introduced when queue-age/SLO or resource evidence requires them; scheduler leadership and lease semantics must already tolerate multiple candidates.
- Development and homologation co-location cannot be used as production capacity evidence. Production-like fault, backlog, lease, restart, network-partition, and resource-pressure tests run against the three-host topology before activation.
- The three-host activation gate includes independent A-B, A-C, and B-C latency/failure tests, direct-route verification, per-link traces, key rotation with peer overlap, and proof that losing one host does not turn either surviving host into an unintended router or authorization fallback.

Re-evaluate the physical placement when VPS C lacks headroom; an independent SLO requires replicas or multiple fault domains; provider or node classes require stronger secret isolation; managed container scheduling becomes cheaper than static hosts; regional or disaster-recovery requirements appear; or static WireGuard peer and firewall operations no longer scale safely.

Why TypeScript and Node.js fit initially:

- Automation orchestration is expected to be primarily I/O-bound: PostgreSQL transactions, RabbitMQ deliveries, service/provider calls, timers, and small deterministic state transitions. Node.js is designed around non-blocking I/O and an event loop, which fits that profile when every callback remains bounded.
- MailFlow's Web, Gateway, Identity, Mail, Audience, Workflow, and initial AI orchestration already use TypeScript. Keeping the runtime in the same language reduces context switching for two developers and reuses the established build, testing, Zod runtime validation, generated API/event contracts, workload-token validation, OpenTelemetry, logging, deployment, and incident tooling.
- TypeScript discriminated unions and exhaustive checks are useful for the versioned node catalog and runtime transition commands. They do not replace runtime validation: persisted definitions, broker messages, API input, and node output are always untrusted and schema-validated.
- Horizontal scale comes from independent worker processes and containers consuming bounded queues. The architecture does not depend on one Node.js process exploiting every CPU core.
- The dynamic workflow graph remains data owned by MailFlow. A different worker language can consume the same versioned command and result contracts without becoming coupled to React Flow or TypeScript domain objects.

Trade-offs and controls:

- CPU-heavy or long synchronous JavaScript blocks the event loop, reduces throughput, and can become a denial-of-service vector. CPU-heavy node types are isolated behind bounded workers or delegated to a specialized service; they do not run in the orchestrator callback path.
- Node worker threads are available for CPU-intensive JavaScript but provide little benefit for ordinary asynchronous I/O. They are not the default scaling model for this distributed runtime.
- TypeScript types are erased at runtime, so Zod/JSON Schema validation and versioned compatibility tests remain mandatory at every persistence and transport boundary.
- A shared language can encourage forbidden shared domain packages. Services may share generated contracts and small technical primitives, but Automation never imports another service's entities, repositories, or business rules.
- Building the interpreter creates substantial correctness work: leasing, duplicate delivery, crash recovery, join races, pause/cancel races, version pinning, redrive, reconciliation, and observability all require invariant and fault-injection tests.

Language alternatives are not prohibited:

- **Go** is the preferred candidate for a high-throughput or resource-sensitive specialized worker because goroutines are lightweight and its runtime supports concurrent I/O and parallel execution. It is not selected for the initial control plane because introducing another language would duplicate platform adapters, build/test tooling, operational knowledge, and contract handling before measurements show a benefit.
- **Python** is valid for asynchronous I/O and becomes preferred for a specialized node or service when ML, NLP, scientific, statistical, or evaluation libraries provide material value. Ordinary AI actions call the AI Service rather than embedding Python into the Automation orchestrator solely because a model is involved.
- A polyglot worker communicates through versioned REST/event contracts, authenticates as its own workload, owns its deployment and telemetry, and cannot read Automation's database directly unless it is an internal deployable of the Automation bounded context with separately reviewed credentials.

Runtime-platform alternatives:

- **Temporal** provides mature durable execution and long-lived workflow recovery. It is not selected initially because MailFlow would still need a generic interpreter for customer-authored graphs, while operating or purchasing another critical platform and reconciling its technical history with MailFlow's product-visible contact journey. It remains the leading managed/general engine comparison when custom-runtime correctness or maintenance becomes disproportionate.
- **Restate** provides durable execution from a comparatively small self-hosted server, while **DBOS** provides PostgreSQL-backed durable workflows as a library. Both reduce some recovery implementation, but both also introduce their execution and versioning model beneath a domain interpreter MailFlow still owns. They require a representative compatibility and failure-recovery spike before replacing the accepted state machine.
- **Trigger.dev** is oriented toward developer-authored tasks and its self-hosted architecture adds PostgreSQL, Redis, a web application, supervisors, and runners; some checkpoint behavior is Cloud-only. It is not selected as the customer-defined Automation Runtime.

Re-evaluate the language or engine when representative production/homologation evidence shows one of the following:

- Event-loop delay remains above 50 ms at p95 under the agreed peak after CPU-bound work and synchronous libraries are removed from the orchestration path.
- Automation workers remain CPU-saturated above 70% or miss transition-throughput/queue-age targets while PostgreSQL and RabbitMQ have demonstrated headroom.
- A controlled Go or Python implementation improves total worker cost or capacity by at least 30% under the same correctness, observability, and failure tests.
- A required node depends materially on a language-specific ecosystem and isolating it produces a simpler, safer boundary than porting or replacing that dependency.
- Timers, replay, recovery, joins, signals, version migration, or operational tooling consume disproportionate engineering time or repeatedly violate correctness; compare the current Temporal, Restate, and DBOS offerings with a representative published workflow before extending the custom engine.

Primary references:

- [Node.js event-loop and worker-pool guidance](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [Node.js worker threads](https://nodejs.org/api/worker_threads.html)
- [Go concurrency and goroutines](https://go.dev/doc/effective_go#concurrency)
- [Python asyncio](https://docs.python.org/3/library/asyncio.html)
- [RabbitMQ reliability and at-least-once delivery](https://www.rabbitmq.com/docs/reliability)
- [RabbitMQ acknowledgements and publisher confirms](https://www.rabbitmq.com/docs/confirms)
- [RabbitMQ message TTL behavior](https://www.rabbitmq.com/docs/ttl)
- [Temporal durable execution](https://docs.temporal.io/)
- [Restate self-hosting architecture](https://docs.restate.dev/server/overview)
- [DBOS architecture](https://docs.dbos.dev/architecture)
- [Trigger.dev self-hosting architecture and feature comparison](https://trigger.dev/docs/self-hosting/overview)

## 14. Backend stack

Every stack decision in this document and the future architecture website must record:

1. The selected technology and its precise responsibility.
2. Why it fits MailFlow's workload, team size, architecture, and current phase.
3. Operational and development trade-offs introduced by the choice.
4. Material alternatives considered and why they were not selected now.
5. Objective triggers that require re-evaluation.
6. Primary documentation or measured evidence for claims that may change over time.

Technology names without this decision context are not considered complete stack documentation.

- Default language: TypeScript.
- Production runtime: Node.js 24 LTS.
- HTTP framework: Hono.
- API style: REST/JSON and OpenAPI.
- Validation and OpenAPI integration: Zod with `@hono/zod-openapi`.
- Database: PostgreSQL.
- ORM and migrations: Drizzle ORM/Kit with the `pg` driver.
- Durable MVP jobs: pg-boss.
- Local attachment scanning: ClamAV.

API DTOs, database records, and domain models are separate representations. Drizzle schemas do not become public API contracts. Stage and production use reviewed, versioned SQL migrations; `drizzle-kit push` is not a deployment strategy. RLS policies are maintained explicitly in migrations. A dedicated PostgreSQL connection is used for `LISTEN/NOTIFY`.

Bun remains a future measured spike, not the initial production runtime. Hono's runtime portability is useful, but operational maturity and library compatibility favor Node.js for the MVP.

### Future language choices

- AI remains TypeScript for provider orchestration and ordinary RAG. Python becomes justified by custom ML, scientific/NLP libraries, evaluation pipelines, or model-serving workloads.
- Analytics starts with TypeScript and SQL. Python becomes justified by scientific ETL, forecasting, statistical workflows, or data-science ownership.
- Automation Runtime begins with the accepted TypeScript/Node.js interpreter over PostgreSQL and RabbitMQ. Go and Python remain conditional specialized-worker choices, and Temporal, Restate, or DBOS remain evidence-triggered engine alternatives under the criteria above.

Polyglot choices are reviewed regularly and must earn their deployment, observability, hiring, and contract costs.

### Billing service and Stripe boundary

Billing is an independent bounded context and deployable service implemented with the default TypeScript/Node.js, Hono, PostgreSQL, Drizzle, OpenAPI, and OpenTelemetry stack. Stripe owns payment collection, subscription and invoice processing, payment-method handling, and the hosted financial self-service experience. MailFlow owns product plans, workspace subscription projections, entitlements, quotas, grace and suspension policy, operational overrides, and authorization decisions.

Initial physical placement:

- Billing begins co-located on VPS A because its expected API and webhook volume is small and its durable state already lives in managed PostgreSQL and Stripe. Co-location is a cost decision, not a reversal of the service boundary.
- Billing has its own repository, immutable image, Compose project, deployment lock, rollback target, health checks, resource limits, logical database, credentials, migrations, and telemetry identity.
- `billing-api` and `billing-worker` are separate containers that may use the same immutable Billing image with different startup commands. Only the API is reachable from the internal Gateway route; the worker has no inbound product route.
- Billing never shares a process, tables, schema migrations, database credentials, repositories, or Stripe adapter with Gateway, Identity, or Mail.
- A Billing process or deployment failure must not make Mail or Identity unready. Full VPS A loss still removes Gateway, Identity, Mail, and Billing together; container separation is not host high availability or a hard VM security boundary.
- Billing receives its own runtime machine identity and an enforceable service-scoped Infisical boundary. If Billing is the first independently permissioned runtime introduced after Audience, it consumes the sixth identity and activates the accepted paid-Infisical transition; if another service has already activated that transition, Billing is provisioned under the paid service-scoped project/RBAC layout. Reusing the VPS A/Core identity is never a cost workaround.
- Move Billing to the next dedicated host available when it needs an independent SLO or failure domain; security/compliance requires a separate host trust boundary; Billing deploys or incidents affect Core; VPS A lacks safe CPU/memory headroom; or Billing needs independent scaling. This may be VPS C before Automation is activated, but VPS C becomes reserved for Automation Runtime at that activation and Billing then uses another host such as VPS D. Because the database and Stripe remain external, this move changes image placement, private networking, routing, secrets, and workload identity without moving canonical Billing data.

Initial Stripe integration:

- Stripe Checkout is the hosted entry point for starting a paid subscription or trial that requires payment collection.
- Stripe Customer Portal handles supported payment-method changes, billing/tax information, invoices, plan changes, renewal/cancellation, and reactivation before the subscription period ends. MailFlow creates a short-lived portal session only after authenticating and authorizing the workspace billing administrator.
- The official Stripe Node.js SDK is isolated behind a Billing-owned provider adapter. Stripe object shapes and SDK types do not enter Billing domain models, public MailFlow contracts, or other services.
- Internal immutable plan versions map MailFlow capability and quota policy to Stripe Product and Price identifiers. Stripe identifiers remain integration references, not domain identifiers or authorization inputs.
- Portal limitations are accepted initially. MailFlow builds a custom financial UI only when a required plan, usage-based, scheduled-change, localization, or support flow cannot be represented safely by Checkout/Portal.

Webhook and consistency policy:

- Stripe webhook signatures are verified against the raw body before any event is accepted. The public endpoint has a narrow payload limit and does not trust browser state or redirect success as payment proof.
- The ingress transaction persists the Stripe event identifier, type, relevant object identifiers, API version, received timestamp, and processing state in an idempotent inbox before acknowledging delivery. Sensitive payment data is not copied unnecessarily.
- Webhook processing is asynchronous, idempotent, and independent of event arrival order. A worker retrieves the current Stripe object when required to reconcile missing or stale context rather than assuming event sequence.
- The Billing transaction updates its subscription/payment projection and outbox together. It then publishes versioned facts such as `WorkspaceEntitlementsChanged`, `WorkspaceSubscriptionPastDue`, or `WorkspaceSubscriptionEnded`.
- Stripe API commands use stable MailFlow operation identifiers as provider idempotency keys where Stripe supports them. Uncertain outcomes are reconciled before repeating a financial mutation.

Entitlement ownership and enforcement:

- Stripe Billing and Stripe Entitlements may notify Billing about commercial product state, but neither is queried synchronously on a product request and neither becomes MailFlow's authorization engine.
- Billing derives an immutable, versioned workspace entitlement snapshot from the internal plan version, verified subscription state, usage, grace policy, approved overrides, and safety restrictions.
- Each owning service consumes only the entitlement projection required for its capabilities and enforces it locally. The Gateway may reject an obviously unavailable plan feature for usability, but the target service repeats the authoritative domain check.
- Quotas are not represented as simple booleans. Services own concurrency and usage counters appropriate to their domain while Billing owns the purchased limits and billing-period interpretation.
- Payment status never disables abuse, sender-reputation, security, provider, or infrastructure safety ceilings. A paid entitlement cannot override an operational kill switch.
- `platform_admin` workspace reactivation is an audited platform lifecycle operation and does not fabricate a successful Stripe payment or paid entitlement. Any commercial exception is recorded separately with actor, reason, scope, and expiry.

Why this fits:

- Checkout and Customer Portal remove high-risk payment UI and common subscription self-service work from a two-developer team while preserving MailFlow's branded plan and entitlement experience.
- A local projection removes Stripe latency and availability from every request, supports the accepted event-driven service model, and allows workspace-, risk-, and provider-specific policy that Stripe product mappings alone cannot express.
- Keeping Stripe behind Billing prevents payment-provider concepts from coupling Mail, Audience, Campaign, AI, or Automation to one vendor.

Trade-offs and rejected alternatives:

- Webhook projections are eventually consistent. Explicit processing states, entitlement versions, short bounded grace where policy allows, reconciliation jobs, and support tooling constrain this trade-off.
- MailFlow must maintain plan/version mappings and entitlement logic instead of delegating all feature access to Stripe Entitlements. This is required for quotas, operational overrides, custom-domain cost recovery, abuse controls, and future non-Stripe commercial arrangements.
- A fully custom checkout and billing portal is rejected initially because it adds payment-method, invoice, tax, authentication, and compliance-sensitive UI without differentiating the MVP.
- Direct Stripe reads from feature middleware are rejected because they add network latency, couple authorization availability to Stripe, and cannot express all MailFlow policy.
- Storing card or bank details in MailFlow is prohibited; hosted Stripe surfaces and tokenized provider references keep sensitive payment collection outside MailFlow application storage.

Re-evaluate when Customer Portal limitations block a confirmed product flow; usage-based or hybrid pricing requires a different meter architecture; multiple currencies, entities, tax obligations, invoices, credits, or enterprise contracts exceed the initial model; webhook lag violates entitlement-change targets; Stripe availability or pricing becomes material; or a second billing provider is required. Re-evaluation preserves Billing-owned plan and entitlement contracts even if the payment adapter changes.

Primary references:

- [Stripe Customer Portal](https://docs.stripe.com/customer-management)
- [Stripe Customer Portal API integration](https://docs.stripe.com/customer-management/integrate-customer-portal)
- [Stripe Billing Entitlements](https://docs.stripe.com/billing/entitlements)
- [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Stripe webhook security, duplicates, ordering, and asynchronous handling](https://docs.stripe.com/webhooks)

## 15. Frontend stack

- Language: TypeScript.
- UI: React.
- Preferred framework: TanStack Start, subject to a stability and deployment spike.
- Fallback: React Router with Vite.
- Hosting: Cloudflare Workers with Static Assets, not Cloudflare Pages.
- Server-state and cache: TanStack Query.
- Complex local editor/builder state: Jotai.
- Simple component state: React state.
- Forms: React Hook Form with Zod; Base UI fields integrate through `Controller` when needed.
- Styling: Tailwind CSS, design tokens, and CSS variables.
- Component source: shadcn/ui configured with Base UI (`@base-ui/react`), not Radix and not Uber Base Web.
- Rich-text editing: Tiptap OSS with a restricted schema.

The public landing/signup experience uses SSR or prerendering. The authenticated dashboard is client-heavy. TanStack Start server functions are restricted to presentation-edge concerns such as session bootstrap, calls to backend APIs, CSP, locale, and correlation. They do not implement domain rules or access PostgreSQL/R2 directly.

Navigation/filter state belongs in router search parameters; server state belongs in TanStack Query; complex unsaved UI state belongs in Jotai. Redux and Zustand are not initial dependencies.

Tiptap JSON is the editable source. Plain text is derived, and the backend performs final compilation, sanitization, and creation of the immutable send snapshot. No paid Tiptap Cloud service is required.

## 16. Infrastructure

### Cloudflare

Cloudflare centralizes DNS, TLS, CDN/WAF, frontend Workers, and object storage.

Production and homologation use private Cloudflare R2 Standard buckets separated by environment, not by workspace. Object keys include tenant prefixes, and each environment receives least-privilege credentials. Presigned operations are short-lived and restricted by CORS. R2's location hint is best effort and must not be described as strict US data residency. AWS S3 regional storage is reconsidered if contractual residency requires it.

All storage access goes through an `ObjectStorage` port. Local development uses MinIO in Docker. Homologation runs compatibility tests against real R2 because S3 compatibility is not assumed to be perfect.

### Secrets management

Infisical Cloud is the source of truth for MVP secrets. “Secrets” means sensitive configuration such as database URLs, provider keys, session-signing material, webhook secrets, and machine credentials. Public runtime configuration such as log level, public API URL, and non-sensitive limits remains ordinary versioned configuration. No value shipped to browser JavaScript is treated as secret.

The initial Infisical layout is:

- One `mailflow` secrets project during the MVP.
- `development`, `staging`, and `production` environments.
- `/core`, `/web`, and `/shared` paths in the MVP.
- Two human identities.
- Machine identities for GitHub Actions OIDC and production VPS A; production VPS B receives its own identity when Audience is extracted. VPS A and VPS B never share a machine credential.
- GitHub Actions uses OIDC and short-lived access rather than a permanent Infisical token.
- Homologation has no dedicated runtime identity. GitHub Actions reads the staging secrets from Infisical during deployment and injects only the selected values into the homologation workloads. Infisical remains the source of truth; a staging secret change takes effect through a controlled redeployment.
- Cloudflare Worker secrets are synchronized into native Cloudflare secret bindings; only server-side Worker code can receive them.

An Infisical agent/fetch step delivers secrets before a process starts. Domain/application code does not call the Infisical SDK and therefore remains secrets-provider neutral. Prefer file-mounted secrets with per-service access; when a library only accepts an environment variable, inject it into that process rather than the image, command arguments, source, or logs. Production secret changes use a controlled restart; development-only `--watch` behavior is not used to restart production unexpectedly.

Why Infisical fits:

- Two developers receive a shared operational UI and a single source of truth instead of manually exchanging encrypted files.
- Environments, secret paths, human identities, and machine identities map cleanly to MailFlow's deployment and future service boundaries.
- GitHub OIDC removes a long-lived CI credential.
- Native Docker, GitHub, and Cloudflare integrations reduce custom secret-delivery scripts.
- The current Free allocation of up to five identities and three environments fits both the MVP and the first two-VPS topology: the MVP uses two humans, CI, and VPS A; Audience extraction adds VPS B as the fifth identity.

Trade-offs and controls:

- The first two-VPS topology consumes the fifth identity and leaves no growth margin. The first independently permissioned runtime introduced after Audience—whether Billing, Campaign, Content, Workflow, Automation Runtime, AI, Analytics, or another service—or a direct homologation runtime identity requires a paid plan or another explicitly approved delivery design.
- Secret folders organize values but are not automatically an authorization boundary. On the Free plan, built-in project roles do not provide the same per-path isolation as paid custom RBAC.
- When Audience is extracted, secrets are split into two Infisical projects: `mailflow-core` and `mailflow-audience`. The VPS A identity is assigned only to `mailflow-core`; the VPS B identity is assigned only to `mailflow-audience`; the two human identities and the CI identity may be assigned to both according to their operational responsibilities. This uses project membership as the enforceable Free-plan boundary and remains within the three-project and five-identity allowances.
- After the paid transition, service secrets use separate projects or enforceable custom RBAC/scopes according to the selected Infisical plan. No fixed service order or third-project assignment is assumed. Every independently permissioned runtime keeps its own machine identity even when services share a VPS.
- Shared sensitive values are not copied into both projects merely for convenience. A secret belongs to the service that owns the external capability or data boundary. Any unavoidable duplicated credential has an explicit owner, independent rotation procedure, and documented blast radius.
- Free lacks secret versioning, point-in-time recovery, and searchable audit logs. Pro/alternative cost is reviewed before those controls become contractual requirements.
- Infisical Cloud becomes a control-plane dependency. Already-running containers continue using injected values, but provisioning a new host may depend on Infisical availability.
- Keep an encrypted, access-controlled, offline break-glass bundle of essential static secrets. Update and test it after rotation; it is recovery material, not a second editable source of truth.
- Infisical Agent persistent caching for ordinary VM deployments must not be assumed equivalent to its documented Kubernetes persistent cache.
- Do not self-host Infisical on the MailFlow MVP VPS. Doing so would create a circular bootstrap/failure dependency and add another PostgreSQL/Redis workload to the same host.

Rejected for the MVP:

- SOPS plus age as the primary workflow: portable and inexpensive, but less convenient for two-person daily operations, access changes, and environment visibility. Age encryption may still protect the break-glass bundle.
- Plain `.env` files or GitHub Secrets as the system of record: weak sharing, rotation, environment visibility, and runtime delivery semantics.
- OCI Vault: stronger cloud-native identity but unnecessarily couples the accepted DigitalOcean fallback to OCI.
- Self-hosted HashiCorp Vault: excessive operational and availability burden for one host and two developers.

Re-evaluate at the first of: more than five identities, need for path-scoped custom RBAC inside either service project, frequent/dynamic rotation, required secret-access auditing/PITR, the first independently permissioned runtime after Audience, direct homologation runtime authentication, or contractual secrets-manager availability. Audience-on-VPS-B consumes the final Free identity; the exact later service that triggers the transition depends on delivery order.

Primary references:

- [Infisical pricing and plan boundaries](https://infisical.com/pricing)
- [Infisical GitHub Actions OIDC integration](https://infisical.com/docs/integrations/cicd/githubactions)
- [Infisical machine identities](https://infisical.com/docs/documentation/platform/identities/machine-identities)
- [Infisical Docker Compose integration](https://infisical.com/docs/integrations/platforms/docker-compose)
- [Infisical Agent behavior and caching](https://infisical.com/docs/integrations/platforms/infisical-agent)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

### Tenant integration credential storage

Infisical stores platform and deployment secrets. Future per-workspace OAuth grants and API credentials are dynamic tenant data, not environment variables or individual Infisical records. The capability owner stores them in its PostgreSQL database under this envelope-encryption boundary:

- Each credential revision stores only authenticated ciphertext, a wrapped data-encryption key, unique nonce/initialization material, algorithm and key versions, and non-secret lifecycle metadata beside its workspace-scoped connection. A distinct data-encryption key is generated per connection; authenticated encryption context binds at least the service, environment, workspace, connection, and credential revision so ciphertext cannot be transplanted silently between records.
- A managed KMS protects the key-encryption key and performs data-key wrap/unwrap operations. The key-encryption key never enters PostgreSQL, application configuration, Infisical, logs, or application memory as raw key material. Infisical contains only the owning workload's least-privilege bootstrap identity or credential for reaching the selected KMS.
- The service accesses cryptography through a provider-neutral `CredentialCipher`/KMS port. The exact managed KMS, region, SDK, algorithm implementation, latency budget, pricing, audit capability, availability policy, and key hierarchy are selected through a security and operations spike immediately before the first per-workspace credential integration.
- Plaintext credential material may exist only inside the owning service process while the credential is being used. It is never cached in Redis, persisted to disk or temporary files, placed in a queue, shared with another service, or included in a crash dump or diagnostic export.
- To avoid one KMS unwrap per recipient or provider request, an owner worker may resolve a credential once per bounded batch and use a bounded process-local cache keyed by `connection_id` and exact `credential_revision`. The initial maximum TTL is five minutes and remains configurable downward by capability risk; entries are never shared across processes, environments, workspaces, connections, or revisions.
- Rotation, revocation, deletion, provider-principal mismatch, or a newer connection generation invalidates matching process-local entries immediately through durable lifecycle signals. Every cache hit still checks local connection and authorization state; possession of cached plaintext never grants permission by itself.
- During KMS unavailability, only an existing unexpired and otherwise valid process-local entry may continue until its TTL. A cache miss or expiry fails closed with a typed dependency outcome; the service never falls back to old credential revisions, Redis, database plaintext, or a platform credential.
- Implementation minimizes plaintext copies and lifetime and uses mutable buffers where compatible with the provider SDK. Node.js garbage collection and third-party string APIs prevent a guarantee of deterministic memory zeroization, so documentation and compliance claims must not promise one. Process isolation, short TTLs, redacted crash handling, restricted diagnostics, and prompt reference release are the practical controls.
- Connection lifecycle metadata, encrypted revision insertion, activation, rotation, and tombstoning remain transactionally coordinated in the owner database. The active revision changes only after encryption and provider-account verification succeed; plaintext is never written to PostgreSQL, outbox rows, backups, migrations, query logs, or ORM telemetry.
- Database backup and replication preserve only ciphertext and wrapped keys. KMS key rotation can rewrap data keys without republishing workflows or changing `connection_id`; cryptographic deletion uses the narrowest feasible data-key/key-hierarchy boundary plus the accepted backup-retention caveat.
- A database-only `pgcrypto` design, one application master key stored beside the service environment, storing dynamic tenant secrets in Infisical paths, and a self-hosted Vault/KMS on MailFlow VPS hosts are rejected. They respectively combine database and decryption authority, create an excessive shared blast radius, turn a deployment secret manager into a high-cardinality customer credential database, or introduce a circular high-value operational dependency.
- Secret values are excluded from contract/catalog bundles, browser projections, workflow definitions and execution context, RabbitMQ payloads, logs, traces, analytics facts, audit records, R2 objects, test fixtures, and support exports. Schema classification, validation, structured logging filters, telemetry redaction, and payload tests enforce this boundary.
- Tests cover cross-workspace and forged references, revoked/deleted/expired connections, rotation, provider-account mismatch, KMS outage, replay and retry paths, and absence of secrets from every payload and observability surface.

Primary references:

- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [NIST SP 800-57 Part 1 Rev. 5: key-management guidance](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final)

### PostgreSQL hosting

Production uses Neon Launch paid in US East:

- Direct TLS connections from the Core VPS and, after extraction, each service host to its service-owned logical database.
- Scale-to-zero disabled for production.
- A deliberately sized connection pool.
- Provider PITR target of at least seven days.
- Independent encrypted daily logical backups copied to R2 and retained for 30 days.

Neon Free remains for disposable development or demos. It was rejected for production because the free compute/storage/restore limits and forced scale-to-zero conflict with continuous pg-boss/background processing and the agreed recovery goals. Alternative free managed PostgreSQL offerings were rejected because they lack the required combination of SLA, stable capacity, exact region, backups, and PITR guarantees.

### Backend compute

The accepted staged policy is:

1. Run the controlled pilot on an OCI Always Free A1 Flex instance in the Ashburn home region, if capacity is available.
2. Treat availability and the 99.5% MVP SLO as aspirational rather than contractual while on reclaimable free compute.
3. Do not create artificial load to avoid Oracle idle-resource reclamation.
4. At the MVP decision gate, prefer a genuinely paid OCI VM if OCI operations have been satisfactory.
5. Use DigitalOcean as the tested portable fallback if OCI capacity, complexity, or support is unsatisfactory.
6. Move to paid compute immediately if customers depend on the service daily or require a contractual availability commitment.
7. At Audience extraction, provision VPS B with the same selected compute provider and US region as VPS A and attach both to that provider's private network, even if measured traffic would still fit VPS A. OCI uses a VCN/NSGs; the DigitalOcean fallback uses a VPC/cloud firewalls. This deliberate distribution is a learning and validation objective, not a claim that current load requires another host.

Upgrading an OCI account while continuing to use an Always Free-eligible VM does not make that VM a paid reliability tier. The paid transition creates a new non-free VM, expected to be comparable to an OCI `VM.Standard.E4.Flex` with roughly 1 OCPU/2 vCPU and 4 GB RAM, or a comparable DigitalOcean Basic Droplet. Exact shapes and prices must be reverified at purchase time.

ClamAV makes 4 GB RAM the safer minimum. The Core API, worker, and ClamAV run as distinct containers. Durable state remains in Neon, R2, and Resend, so compute replacement does not require production data migration.

The current Always Free documentation must be rechecked at provisioning time. If its A1 allocation and capacity permit two instances, the planning baseline is approximately 1 OCPU/8 GB for VPS A and 1 OCPU/4 GB for VPS B. This split is a pilot hypothesis, not a guaranteed entitlement or production sizing result. If free capacity or limits cannot provide both hosts safely, Audience extraction uses a small paid VPS rather than moving Audience back onto VPS A or starving ClamAV/Core.

Portability requirements:

- Docker Compose for each host deployment unit: one Compose project for MVP/VPS A and a separate Audience project for VPS B after extraction.
- Multi-architecture images in GHCR so OCI Arm and x86 providers remain options.
- OpenTofu, minimal cloud-init, and Ansible with the responsibility boundaries defined below.
- External secrets and no canonical durable application state on either VM.
- Cloudflare origin routing so cutover does not change the public hostname.
- Idempotent workers and a deploy lock to prevent concurrent database migrations.

A rehearsed compute migration provisions the target host, applies network/secrets, starts the immutable images, performs health checks, updates the relevant internal or Cloudflare route, drains the old worker/API, and retires the old host after verification. Before the distributed topology exists, one service may move independently. After VPS A and VPS B form the accepted private topology, a provider migration moves the related hosts as one planned topology or requires an explicit cross-provider ADR; accidental public or cross-provider service paths are prohibited.

### Infrastructure as code and host configuration

The selected automation stack is deliberately layered:

- OpenTofu owns external infrastructure resources and their lifecycle: provider-equivalent compute, private-network, and firewall resources (OCI or DigitalOcean), Cloudflare resources, dedicated R2 buckets, DNS, and other resources only when the corresponding provider is sufficiently mature.
- Cloud-init performs first-boot bootstrap only: create the operational account and install the minimal prerequisites required to run Ansible. It does not become the long-term host configuration system.
- Ansible owns repeatable host configuration: operating-system packages, Docker, WireGuard after Audience extraction, local firewall rules, Caddy, `cloudflared`, ClamAV, filesystem permissions, service definitions, and operational hardening. Host roles ensure Audience VPS B does not receive Mail/ClamAV configuration.
- Docker Compose owns each host's application container topology, health checks, networks, resource limits, and image versions. It does not provision cloud resources, cross-host networking, or the base operating system.
- GitHub Actions orchestrates validation, OpenTofu plan/apply, immutable image publication, host configuration, and the accepted blue/green deployment procedure.
- Infisical remains the secret source of truth. Application code has no OpenTofu, Ansible, or Infisical-specific dependency.

Why this split fits:

- OpenTofu models cloud-resource dependency and lifecycle through declarative state and reviewable plans.
- Ansible can be safely rerun to reconcile mutable host configuration; cloud-init is intentionally optimized for instance initialization rather than continuing configuration management.
- Docker Compose remains a portable runtime description across OCI Arm, paid OCI, and the DigitalOcean fallback.
- GitHub Actions already owns the accepted CI/CD flow and supplies environment protection, OIDC, deployment history, and per-environment concurrency.
- Clear ownership prevents three automation tools from independently modifying the same resource.

#### OpenTofu remote state policy

- Use a private R2 bucket dedicated to infrastructure state. Never share the application attachment bucket.
- Use a distinct state key and credentials per environment, with least-privilege access to only the required prefix or bucket.
- Enable OpenTofu client-side AES-GCM encryption for state and saved plans. Supply its derivation secret from Infisical and preserve a tested copy in the encrypted offline break-glass bundle.
- Enforce encryption so a missing environment configuration cannot silently write plaintext state.
- Use the S3 backend against the R2 endpoint with native `use_lockfile = true`. R2 currently supports the conditional `PutObject` operation required by the native S3 lock.
- Permit production `apply` only from the protected GitHub Actions environment. Developers may run validation and plans, but not an uncoordinated production write.
- Use one GitHub Actions concurrency group per environment in addition to the backend lock. The CI lock coordinates deployment workflows; the backend lock protects state operations.
- Before every apply, copy the still-encrypted state object to an immutable timestamped backup key. Retain a bounded history and periodically test state recovery.
- Pin OpenTofu and provider versions, commit the dependency lock file, and review every production plan before apply.
- Do not generate or manage application passwords, private keys, or provider tokens through OpenTofu when Infisical can own them. A `sensitive` declaration masks output but does not remove a value from state.

The R2 choice has an explicit limitation: R2 does not currently provide the bucket object-versioning behavior recommended for S3 state recovery. Native conditional writes make locking viable, but the CI snapshot is a compensating control and must pass a pre-production lock/recovery spike. If the spike fails, use a managed state backend or versioned object store rather than weakening locking or recovery.

Trade-offs and rejected alternatives:

- This stack has more tools than a shell-only deployment, but each tool has a narrow, non-overlapping responsibility and supports the accepted provider portability requirement.
- R2 state centralizes storage with the existing Cloudflare account and avoids placing state on the single VPS, but requires explicit snapshot automation because it lacks native object versioning.
- Local state and state committed to Git are rejected because they cannot safely coordinate two writers and state may contain sensitive resource attributes.
- State hosted on the MailFlow VPS is rejected because host loss would remove both the runtime and its recovery metadata.
- A managed Terraform/OpenTofu automation platform is not selected initially because GitHub Actions already supplies the execution workflow and the MVP does not yet justify another privileged vendor. It becomes preferable when policy, approvals, drift detection, auditability, or team scale exceed the CI-based controls.
- Cloud-init-only host management is rejected because ongoing reconciliation and remediation become difficult. Ansible-only cloud provisioning is rejected because it lacks OpenTofu's stateful resource-lifecycle model.
- Self-hosted state-lock services are rejected because they add another service and circular availability dependency to the single host.

Re-evaluate when the R2 compatibility spike fails, state recovery cannot meet the RPO, more engineers need apply access, multiple infrastructure stacks introduce complex dependencies, continuous drift detection becomes necessary, or contractual audit/approval controls appear.

Primary references:

- [OpenTofu S3 backend and native locking](https://opentofu.org/docs/language/settings/backends/s3/)
- [OpenTofu state and plan encryption](https://opentofu.org/docs/language/state/encryption/)
- [OpenTofu sensitive state guidance](https://opentofu.org/docs/language/state/sensitive-data/)
- [Cloudflare R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [GitHub Actions deployment environments and concurrency](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
- [Ansible Docker Compose v2 module](https://docs.ansible.com/projects/ansible/latest/collections/community/docker/docker_compose_v2_module.html)

### MVP deployment topology

The OCI host runs one Docker Compose deployment with no durable application data on local disk:

- `cloudflared` creates outbound-only Cloudflare Tunnel connections. Public HTTP/HTTPS origin ports remain closed, preventing direct origin bypass.
- Caddy is the stable internal reverse proxy and switches traffic between blue and green Core API containers after health checks.
- `core-api-blue` and `core-api-green` are alternative slots built from the same immutable Core image; only the ready active slot receives new traffic.
- `core-worker` uses the same Core image with a different startup command and no public route.
- `clamav` is isolated on the internal container network and can be reached only by the worker.
- `otel-collector` receives local telemetry and exports it to the selected observability backend.
- Neon, R2, and Resend remain external systems of record/providers.

The target for the OCI Free pilot is 8 GB RAM when capacity permits; 4 GB is the absolute production minimum. ClamAV receives approximately 1.5–2 GB of reserved/limited memory. Attachment scanning begins at concurrency one, while lightweight inbound/outbound jobs begin at aggregate concurrency four. Both values are configuration and are tuned from measured CPU, memory, queue latency, and provider rate limits.

Health behavior is deliberately separated:

- `/health/live` proves only that the process/event loop is alive.
- `/health/ready` proves configuration, initialization, and PostgreSQL connectivity.
- R2 and Resend outages degrade their capabilities but do not make the entire API unready or trigger restart loops.
- The worker records a PostgreSQL heartbeat and queue lag; ClamAV has an independent health check.
- Metrics and the Caddy administration API remain internal.
- Public SSH is closed. Administration uses Cloudflare Access/Tunnel or the OCI console.
- Resend webhooks remain publicly routable through Cloudflare but require signature and timestamp verification, replay protection, and idempotent persistence.

Deployment uses a single immutable multi-architecture artifact:

1. GitHub Actions builds and publishes the SHA-tagged image.
2. Compatible expand migrations run under a deployment lock.
3. The inactive API color starts and passes readiness and smoke checks.
4. Caddy gracefully reloads its upstream configuration to send new connections to the new color.
5. The prior API drains requests and SSE connections; clients automatically reconnect SSE.
6. The old worker stops claiming jobs, completes active work within a bounded grace period, and lets unfinished leases expire for idempotent reprocessing.
7. Destructive contract migrations occur only in a later release after every old application version is gone.

Blue/green deployment removes routine application-release interruption; it does not make the system highly available. The single OCI host remains a shared failure domain for API, worker, ClamAV, Caddy, and `cloudflared`. Cloudflare Tunnel maintains redundant edge connections, but host-loss tolerance requires a connector/API replica on another machine. That expansion is triggered by a paid availability commitment or measured business impact.

Primary references:

- [Cloudflare Tunnel outbound-only model](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- [Cloudflare Tunnel connector replicas](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/tunnel-useful-terms/)
- [Caddy graceful configuration reload](https://caddyserver.com/docs/getting-started)
- [Caddy reverse proxy health checks](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

### First distributed topology at Audience extraction

The first distributed production-like topology is mandatory when Contact/Audience begins. It intentionally places one bounded context on another host even if the initial customer volume could run on VPS A. The objective is to exercise real service ownership, network failure, independent deployment, authorization, event delivery, tracing, and recovery before later domains multiply those concerns.

**VPS A — Core edge and Mail failure domain**

- Cloudflare Tunnel and Caddy.
- Thin API Gateway/BFF.
- Identity/Workspace and Mail, initially still derived from the Core codebase according to the strangler stage.
- Mail API and Mail worker.
- After its later launch, independently deployed Billing API and Billing worker containers; this extends the VPS A host failure domain without merging their service, data, or release boundaries.
- ClamAV.
- Host-local OpenTelemetry Collector.

**VPS B — Audience failure domain**

- Audience API built and deployed independently.
- Audience worker built from the Audience repository/image with a distinct startup command.
- Host-local OpenTelemetry Collector.
- No public product route, Mail code, Identity database access, or ClamAV dependency.

**Managed dependencies**

- Neon hosts separate logical Identity, Mail, Audience, and later Billing databases with separate credentials, migrations, RLS, and ownership. Physical-cluster sharing does not permit cross-database access.
- RabbitMQ and Redis remain managed external services and are reached directly by the workloads that own their connections; they are never proxied through VPS A.
- R2 and provider APIs remain external and are used only by services that own the corresponding capability.

Network and trust design:

- Both VPSs use the same selected compute provider and US region. They share provider-private networking: an OCI VCN/NSG topology on the preferred path or a DigitalOcean VPC/cloud-firewall topology on the fallback. Prefer separate fault domains or equivalent placement isolation when available without making pilot capacity a deployment blocker.
- Product service traffic does not use public endpoints or traverse Cloudflare. Gateway reaches Audience over stable internal naming and the WireGuard interface.
- A point-to-point WireGuard tunnel encrypts and authenticates host traffic. Private keys are distinct per environment and host, delivered through Infisical/Ansible, never embedded in images, and rotated through a rehearsed peer-overlap procedure.
- Provider-native firewalls allow only the required WireGuard peer traffic between host security groups: OCI NSGs on the preferred path or DigitalOcean cloud firewalls on the fallback. Host firewalls expose the Audience application port only on the WireGuard interface and to the expected peer.
- WireGuard is transport protection, not service authorization. Gateway still presents an Audience-bound workload token and the audience-bound delegated user/workspace assertion; Audience validates both locally and applies its own authorization.
- HTTP connection pooling, keep-alive, bounded DNS caching, propagated deadlines, trace context, and the accepted maximum synchronous depth apply across the tunnel.
- Each service connects directly to its own database and managed dependencies. Audience never asks Mail/Core to proxy a database, RabbitMQ, Redis, or object-storage operation.

Availability and degradation semantics:

- VPS B loss makes Audience capabilities unavailable or explicitly degraded but does not stop Mail inbox, compose, inbound webhook persistence, outbound queueing, or Mail workers on VPS A.
- Gateway readiness does not depend on Audience globally. Audience-dependent routes return a bounded `503` or an explicitly designed partial response; unrelated routes continue.
- RabbitMQ retains integration messages while Audience consumers are unavailable within broker retention/capacity limits. On recovery, the worker reconnects, processes idempotently, and reconciles its projection.
- VPS B is not a Core replica and does not make Mail highly available. VPS A remains the shared Core/Mail failure domain until a separate availability decision adds replicas.
- A WireGuard or provider-private-network partition is tested independently from process and host failure. Circuit breaking prevents repeated calls from exhausting Gateway resources.

Independent delivery and operations:

- VPS A and VPS B have separate immutable image tags, Compose projects, deployment locks, Infisical machine identities/paths, health checks, resource limits, and rollback targets.
- A Mail deployment does not restart Audience, and an Audience deployment does not drain Mail. Shared contract compatibility follows the accepted versioning window.
- A Billing deployment or rollback does not restart Gateway, Identity, Mail, or Audience even while Billing is co-located on VPS A.
- OpenTofu owns both instances, provider-private network/subnets, provider firewalls, routing, and relevant DNS. Ansible host roles configure WireGuard, host firewall, Docker, Collector, and only the workloads assigned to that host.
- GitHub Actions can deploy the Audience artifact independently after contract, migration, integration, and distributed smoke tests pass.
- Traces cross Gateway on VPS A, WireGuard, Audience on VPS B, and the Audience database. Host/service attributes identify the latency and failure boundary without using tenant identifiers as metric labels.

Mandatory distributed validation includes:

- Warm and cold connection latency, p50/p95/p99 internal-call latency, throughput, and timeout/circuit-breaker behavior.
- VPS B shutdown/restart, process crash, WireGuard loss, private-network packet loss, DNS failure, firewall denial, slow response, and connection-pool exhaustion.
- Workload/delegation-token validation, wrong audience, expired token, unknown `kid`, JWKS refresh, revocation/version propagation, and cross-tenant attempts across hosts.
- RabbitMQ backlog accumulation, consumer recovery, duplicate/out-of-order messages, idempotency, DLQ, and reconciliation after Audience downtime.
- Independent deploy/rollback, incompatible-contract prevention, secrets isolation, backup/restore, and complete distributed trace propagation.

This topology is preferred over placing the learning service in another provider or region. Cross-provider or cross-region placement would mix service-boundary learning with public-network variance, egress, geographic latency, and data-residency/availability concerns. Those dimensions are introduced only for a justified portability, disaster-recovery, or regional requirement.

The accepted next evolution of this two-host topology is the direct A-B-C full mesh when Automation Runtime activates on VPS C. Re-evaluate the resulting static WireGuard topology when host count makes peer/key management unsafe, services use dynamic scheduling, multi-provider/region routing becomes required, policy needs workload-level transport identity, or compliance requires stronger certificate-bound controls. At that point compare SPIFFE/SPIRE, application mTLS, a managed private network, or a service mesh; do not preserve WireGuard merely because it was the first implementation.

### Progressive placement after Audience extraction

An independent service does not imply a dedicated VPS. After the mandatory Audience extraction, VPS A and VPS B are the first placement candidates for each new service, but they are not a permanent two-host ceiling.

Before implementing a new bounded context, its architecture sprint records a placement decision based on:

- Expected CPU, memory, storage, network, connection-pool, queue, and concurrency profile.
- Independent scaling, SLO, deploy, rollback, maintenance, and failure-domain requirements.
- Data and secret sensitivity, compliance, provider credentials, and acceptable host-level blast radius.
- Interactive call graph, synchronous-depth rule, measured cross-host latency, and degraded dependency behavior.
- Remaining resource headroom on both hosts after reserved limits and worst-case worker/ClamAV behavior.
- Operational and monetary cost of another host versus the business and reliability impact of co-location.

Co-location is allowed only when the service retains its own repository, image, Compose project, process/container, database and credentials, migrations, secret scope, health checks, resource limits, telemetry identity, deployment lock, and rollback target. No host-local shortcut permits cross-service database access, unsigned calls, shared domain code, or unversioned contracts.

VPS B is not a generic overflow host: placing another service there explicitly expands the Audience failure domain and must preserve Audience recovery and capacity. VPS A remains the critical edge/Identity/Mail host, so convenience alone cannot add background or compute-heavy workloads to it. If neither host passes the gate, MailFlow provisions the next dedicated host available rather than weakening isolation, SLOs, or safe resource headroom. VPS C is reserved for Automation Runtime from its production activation onward, so another service may require VPS D.

The placement result is revisited when observed load, latency, incidents, compliance, customer commitments, or deployment coupling invalidate its assumptions. Moving a service between hosts must not move its canonical managed data; routing, workload identity, secrets, firewall/WireGuard policy, deployment, and telemetry change while service contracts remain stable.

### Three-host network at Automation activation

When Automation Runtime activates on VPS C, the production service network becomes a static WireGuard full mesh among VPS A, VPS B, and VPS C. The three direct pairs are A-B, A-C, and B-C; VPS A is not a central transit gateway. This is selected because Runtime needs direct authenticated access to action-owning services, Gateway needs direct access to the Runtime API, and Workflow/Runtime coordination must not make availability or latency depend on forwarding through the critical Core host.

The full mesh does not mean broad trust. Every host uses a distinct environment-specific key, `AllowedIPs` is limited to known peer tunnel addresses, provider-native firewalls and host firewalls permit only required peer/port combinations, and internal service DNS resolves to stable tunnel addresses. Application-level audience-bound workload tokens and delegated assertions remain mandatory and are validated by the destination service. Managed PostgreSQL, RabbitMQ, Redis, R2, Resend, Stripe, and other approved providers are reached directly over their own authenticated TLS connections rather than through another VPS.

Three static hosts keep peer and key operations manageable while avoiding the bottleneck and single transit dependency of a hub-and-spoke design. The trade-off is three peer relationships, more firewall and routing policy, more key rotation and failure testing, and another host cost/failure boundary. Before production activation, MailFlow recalculates capacity, latency, and monetary cost from the complete A-B-C topology and current provider prices. It does not extrapolate A-C or B-C from the earlier A-B baseline. Each link receives independent traces, p50/p95/p99 measurements, fault injection, recovery tests, and an explicit allowed call graph.

#### Confirmed Audience service stack and placement

Audience is the first independently deployed business service and begins on VPS B with its own repository, image, Compose project, logical PostgreSQL database, credentials, migrations, Infisical scope, telemetry identity, deployment lock, and rollback target. Its API and worker run as separate containers built from the same immutable image. Audience owns contacts, lists, segment definitions and evaluation, tags, notes, deduplication, suppression audiences, imports, exports, audience-health operational state, and its own audit decisions.

Selected stack:

- TypeScript on Node.js 24, Hono, Zod/OpenAPI, PostgreSQL, Drizzle, RabbitMQ, R2, Pino, and OpenTelemetry.
- PostgreSQL extensions and capabilities such as `pg_trgm`, ordinary full-text search, expression/generated-value indexes where justified, and reviewed parameterized SQL support initial contact search, filtering, normalization, deduplication, and segmentation.
- RabbitMQ carries versioned integration events and asynchronous commands after the accepted transactional outbox. Imports, exports, large merges, deduplication scans, audience-health recalculation, and segment materialization run in Audience workers rather than interactive API requests.
- R2 holds uploaded import sources, generated exports, and row-level error reports under workspace-scoped, short-lived or policy-governed object keys. PostgreSQL retains authoritative import/export state, ownership, checksums, progress, and lifecycle metadata.
- Redis is available in the distributed phase but is not an initial Audience correctness dependency. It may later hold measured hot caches, short-lived coordination, or rate-limit state; it never owns contacts, list membership, segment definitions, suppressions, job outcomes, or progress that cannot be rebuilt.

Data and query boundaries:

- Segment definitions are a MailFlow-owned, versioned, typed JSON rule AST. Audience validates allowed fields, operators, nesting, value types, workspace/team authorization, complexity, and estimated cost before compiling it to parameterized SQL. Customers never submit stored or executable SQL.
- Contact normalization is explicit and versioned. Workspace-scoped normalized email and other justified identity keys support candidate detection and uniqueness rules; they do not silently merge records. Merge is an audited domain operation with deterministic survivor and field-provenance rules.
- Search starts in PostgreSQL. B-tree and expression indexes cover exact/prefix filters; `pg_trgm` GiST/GIN indexes cover justified fuzzy, `LIKE`, and `ILIKE` cases; full-text search is used only for fields where token semantics improve relevance. Indexes are chosen from `EXPLAIN (ANALYZE, BUFFERS)` evidence rather than applied to every text column.
- Keyset pagination is preferred for large stable lists. Bulk selection is represented by a filter/snapshot contract plus explicit exclusions instead of sending every selected contact identifier from the browser.
- The accepted `workspace_id` query discipline, composite relational constraints, separate database role, and `FORCE ROW LEVEL SECURITY` policies apply to every Audience table and background path. Team scope is optional and never replaces workspace membership.

Why this stack fits:

- Contacts, lists, tags, suppressions, merges, and segment membership are relational and transaction-sensitive. PostgreSQL provides constraints, transactions, mature indexing, SQL composition, and the accepted tenant-defense model without another operational data store.
- Audience API traffic, database access, object streaming, and broker consumption are primarily I/O-bound. TypeScript/Node.js reuses the platform's validation, authorization, contract generation, tracing, deployment, and testing knowledge while keeping CPU-heavy work out of the API process.
- Hono preserves the accepted small versioned REST/OpenAPI surface; Drizzle supplies typed ordinary persistence while reviewed SQL remains available for set-oriented segmentation and bulk operations.
- RabbitMQ is justified here because Audience is the first independently deployed domain. It decouples producers and consumers across deployment/database boundaries; manual acknowledgements, publisher confirms, inbox idempotency, bounded retries, DLQs, and reconciliation address its at-least-once failure model.
- Separate API and worker processes allow independent concurrency and resource limits while retaining one domain, release artifact, and codebase.

Trade-offs and rejected alternatives:

- Complex live segments can produce expensive SQL and index pressure. Rule complexity limits, query-plan testing, timeouts, materialization for justified segments, read-model monitoring, and asynchronous execution constrain this risk.
- PostgreSQL fuzzy search is less capable than a dedicated search engine for advanced ranking, analyzers, typo behavior across many fields, and very large search workloads. Elasticsearch/OpenSearch or another engine is rejected initially because it adds a derived index, propagation/deletion semantics, tenant-isolation controls, cluster operations, and cost before measured need.
- Python is not selected for the primary service because ordinary CSV streaming, validation, SQL set operations, and queue work do not justify a second language/runtime. It remains an option for a proven statistical, data-quality, or ML-specific worker.
- Go could reduce memory or improve CPU/concurrency efficiency, but current scale does not outweigh polyglot contracts, deployment, observability, and developer-context cost. A measured hotspot may justify a specialized Go worker later without rewriting the service.
- Redis-backed contacts, segment state, or job truth are rejected because loss, eviction, or cache inconsistency cannot change audience correctness. Redis adoption remains narrow and rebuildable.
- Synchronous processing of large imports, exports, merges, or segment calculations is rejected because duration and failure are variable. The API records a durable accepted state and exposes progress through the accepted query/realtime mechanisms.

Re-evaluate when PostgreSQL search misses representative relevance or p95 targets after measured indexing and query work; live segmentation harms transactional SLOs; segment materialization volume creates unacceptable write/storage pressure; imports or exports need a specialized processing runtime; Audience worker CPU or memory repeatedly exhausts safe VPS B headroom; Redis provides a measured material latency benefit for rebuildable data; or privacy, recovery, scale, and deployment needs require further service or database isolation.

Primary references:

- [PostgreSQL `pg_trgm` indexing and similarity search](https://www.postgresql.org/docs/current/pgtrgm.html)
- [PostgreSQL full-text search](https://www.postgresql.org/docs/current/textsearch.html)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Node.js event-loop guidance](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [Hono getting started and runtime support](https://hono.dev/docs/getting-started/basic)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [RabbitMQ reliability and at-least-once behavior](https://www.rabbitmq.com/docs/reliability)
- [RabbitMQ acknowledgements and publisher confirms](https://www.rabbitmq.com/docs/confirms)
- [Cloudflare R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)

#### Audience-to-Campaign snapshot boundary

Campaign never reads the Audience database, resolves a live segment once per recipient, or receives the full recipient set inside an integration event. Launch preparation uses an immutable, destination-bound audience snapshot followed by asynchronous bulk ingestion.

Accepted flow:

1. Campaign Control records the launch intent and transactionally emits an idempotent command such as `AudienceSnapshotRequested`, containing the workspace, campaign and launch identifiers, the selected list/segment version, the requested personalization-field contract, and correlation/causation metadata.
2. Audience authorizes the request, resolves the selected definition against its canonical data, applies current eligibility and suppression rules, and records an immutable `AudienceSnapshot` plus a stable operation key.
3. Audience publishes a minimal `AudienceSnapshotReady` fact containing identifiers, definition version, recipient count, schema version, checksum, creation time, and an eligibility/suppression watermark. It contains no recipient list, addresses, free-form contact data, or expiring presigned URL.
4. Campaign Execution consumes the fact idempotently and downloads the snapshot through an authenticated, audience-restricted, internal bulk API in bounded keyset pages. This is an asynchronous service call and is not part of an interactive browser chain.
5. Campaign validates page ordering, schema version, count, checksum, workspace, snapshot identity, and completion; it then stores the minimal execution-owned recipient snapshot in its own database before moving from `preparing_audience` to `queued` or `running`.
6. After ingestion, campaign sending does not depend on Audience availability. Failed or partial ingestion remains resumable and observable from the last accepted page/checkpoint; reconciliation detects count, checksum, or terminal-state disagreement.

Scheduled-launch semantics:

- Scheduling pins the immutable campaign definition, template, subject, preheader, personalization contract, and segment-rule version. Later edits create new versions and do not silently alter the scheduled launch.
- The recipient snapshot is resolved at the scheduled execution time, not when the user creates the schedule. A segment evaluates current contact data against the pinned rule version; a selected list uses its current eligible membership at execution.
- New matching contacts may be included, while contacts removed from eligibility, suppressed, unsubscribed, deleted, or no longer matching are excluded. Final personalization values are frozen only when this execution-time snapshot is created.
- The scheduling UI shows a timestamped preflight estimate and explicitly states that it is not a guaranteed final count. The final count, exclusions, definition versions, and snapshot timestamp remain auditable.
- `freeze audience now` is not an initial implicit mode. It may be introduced later as an explicit separately authorized product capability with its own retention, consent, staleness, editing, and cancellation semantics.
- Every scheduled launch records an explicitly accepted `max_recipient_count` derived from, but not silently equal to, the preflight estimate. The UI may recommend headroom, while the durable launch record preserves the value and actor that approved it.
- If the final eligible count exceeds that approved maximum, or the `personalization_invalid` rate exceeds the configured operational review threshold, Campaign enters `requires_review` before creating provider-send batches. Approval, cancellation, expiry, and any threshold override are capability-controlled and audited.
- A lower final count caused by eligibility, suppression, unsubscribe, consent, deletion, or ordinary membership change does not by itself block the launch; the execution summary and notifications expose the difference. Zero valid recipients remains a terminal launch failure.
- Plan entitlements, provider/domain rate limits, sender-reputation controls, abuse controls, infrastructure safety ceilings, and emergency kill switches are independent hard limits. User approval cannot override them.
- Percentage and absolute review defaults remain environment/policy configuration, not hard-coded architecture constants. Pilot evidence, billing plans, audience size distribution, incidents, and sender reputation determine their initial and revised values.

Ownership and privacy rules:

- Audience owns the selected definition, contact truth, eligibility decision at snapshot time, snapshot manifest, and bulk-read contract. Campaign owns the immutable execution copy, batches, attempts, delivery state, and its retention lifecycle.
- Campaign copies only the recipient address, stable contact reference, locale, approved fields required by the pinned template/subject/version, and the suppression/version metadata needed for execution. It does not copy notes, full contact records, unused custom fields, segment rules, or Audience-internal metadata.
- The pinned template, subject, and preheader versions declare a typed personalization-field contract. Campaign requests only those fields; Audience resolves and freezes their values, source/schema versions, recipient address, and locale when producing the snapshot.
- Contact edits after snapshot creation do not mutate prepared recipients or change retry output. This makes a launch reproducible and prevents one campaign from containing several accidental versions of ordinary personalization data.
- Snapshot preparation validates every recipient against the pinned typed personalization contract after applying only explicit template fallbacks. A missing required value marks that recipient `personalization_invalid` and excludes it before batch creation; it does not cancel otherwise valid recipients.
- Optional values may become empty only when the template contract explicitly permits an empty value. Unresolved placeholders, implicit empty fallbacks, and stringified `null`/`undefined` values can never reach compilation or provider submission.
- Campaign records exclusion count, stable reason codes, affected field identifiers without leaking values into logs, and an authorized exportable validation report. Template-contract errors block the launch; recipient-data errors remain per-recipient.
- The entire launch is blocked when the template/personalization contract is invalid or no valid recipient remains. Any additional percentage or count-based review threshold is a separate launch-safety policy rather than hidden behavior inside variable rendering.
- Execution-time technical values such as unsubscribe links, tracking identifiers, campaign identifiers, and provider metadata are generated by Campaign under a versioned policy. They are not ordinary Audience personalization fields.
- Suppression, unsubscribe, consent revocation, deletion, and other safety/legal lifecycle changes remain dynamic overrides. They may prevent a pending send even though ordinary address, locale, and personalization values are frozen.
- This PII duplication is deliberate denormalization across service boundaries. It is encrypted in transit and at rest, workspace-scoped, audited, retention-bound, included in export/deletion workflows, and inaccessible through integration-event payloads or logs.
- Already delivered attempts retain only the minimal legally and operationally justified record. Pending recipient data is deleted or irreversibly anonymized when the governing workspace/contact lifecycle requires it and no stronger legal retention applies.
- Audience publishes suppression, unsubscribe, consent, deletion, and eligibility-revocation facts needed by Campaign. Campaign maintains a local execution-time suppression projection and checks it before provider submission; no per-recipient synchronous Audience call is permitted.
- If the suppression projection is missing, invalid, or older than the accepted safety watermark/SLO, Campaign pauses affected sends and fails closed until event consumption or reconciliation restores confidence. Payment entitlement can never override this safety rule.

Transport trade-offs:

- The minimal ready event keeps RabbitMQ payloads bounded and reduces PII exposure, replay cost, broker storage, and schema coupling.
- Paginated internal ingestion is selected first because expected volumes are small, both services initially run on VPS B, transfer is asynchronous, authorization remains at the owning service, and checkpoints permit bounded recovery.
- A per-recipient lookup is rejected because it multiplies latency and makes Audience availability part of every delivery attempt. A direct database join is prohibited by service ownership. A giant recipient event is rejected because it turns the broker into a bulk-PII transport.
- R2 is not the default snapshot transport. Re-evaluate an encrypted, immutable, short-retention R2 manifest/object when measured snapshot size, page count, transfer duration, API resource pressure, or replay cost makes the paginated API materially worse. An event still carries only a durable snapshot/artifact identifier and integrity metadata; consumers obtain access through a scoped mechanism rather than persisting an expiring URL.

The handoff is covered by contract, idempotency, pagination-resume, checksum, duplicate/out-of-order delivery, Audience outage, partial ingestion, suppression-race, stale-projection, cross-tenant, deletion, retention, and distributed trace tests.

#### Confirmed Campaign modular service, stack, and placement

Campaign begins on VPS B as one independently deployed bounded context containing two extraction-ready modules:

- **Campaign Control** owns CRUD, drafts, immutable versions, audience-selection references, validation, test-send intent, scheduling, goals, audit decisions, and the launch command.
- **Campaign Execution** owns batches, recipient execution state, campaign concurrency, campaign throttling/rate limits, semantic retry decisions, pause/resume execution state, progress, and campaign delivery telemetry. It sends versioned durable delivery commands to Mail and consumes Mail's progress and terminal results; it never uses Resend credentials or calls Resend directly.

Selected stack and deployment:

- TypeScript on Node.js 24, Hono, Zod/OpenAPI, PostgreSQL, Drizzle, RabbitMQ, Redis for justified ephemeral controls, Pino, and OpenTelemetry.
- One Campaign repository, immutable image, Compose project, enforceable Infisical service scope and runtime identity, deployment lock, and rollback target on VPS B. If Campaign is the first independently permissioned runtime after Audience, its identity activates the accepted paid-Infisical transition.
- `campaign-api` and one or more Campaign worker containers use the same image with distinct startup commands, resource limits, health checks, and concurrency settings. A worker storm cannot run inside the API event loop.
- One Campaign logical PostgreSQL database initially contains separate `campaign_control` and `campaign_execution` schemas. Each module owns its tables and migrations.
- No cross-schema foreign keys, joins, views, direct repository access, or transaction spanning Control and Execution are permitted. Separate database roles are used where the process responsibilities allow them.
- Launch is an asynchronous boundary: Control transactionally records launch intent plus an outbox event such as `CampaignLaunchRequested`; RabbitMQ delivers it; Execution creates or resumes an idempotent execution in its own transaction. The user-visible state may move through `launching` before `queued` or `running`.
- Execution publishes versioned progress, pause/resume outcome, completion, and failure facts. Control consumes only the projection needed for the campaign dashboard instead of reading execution tables.
- PostgreSQL is canonical for schedules, launches, batches, attempts, and outcomes. Redis may support distributed rate limiting, throttling, leases, and hot ephemeral counters, but losing Redis cannot erase or fabricate campaign execution state.
- RabbitMQ provides at-least-once command/event transport. Campaign outbox/inbox idempotency, stable operation keys, manual acknowledgements, publisher confirms, and campaign reconciliation handle duplicate commands/results. Mail maps the stable delivery operation to Resend idempotency and owns provider retries and unknown-outcome reconciliation.

Why this stack and shape fit:

- Campaign Control and Execution initially share product ownership, release sequence, customer volume, launch/execution lifecycle, and VPS B. A second campaign deployable, database deployment, host, networking path, secret identity, and on-call surface would add cost before independent scale is demonstrated.
- The two modules still have materially different rules, so source dependencies, persistence ownership, runtime commands, queues, metrics, tests, and migrations are separated from the first implementation. Co-location saves infrastructure without creating a distributed monolith inside one database.
- TypeScript/Node.js matches the two-developer platform and the I/O-bound workload of APIs, PostgreSQL, RabbitMQ, Redis, and Mail delivery commands/results. It reuses validation, authentication, contracts, observability, deployment, and test tooling while keeping CPU-heavy or blocking work outside the API process.
- Hono preserves the accepted small REST/OpenAPI service surface. PostgreSQL supplies durable state and tenancy controls; RabbitMQ supplies the already-accepted distributed transport; Redis is restricted to state that can be rebuilt.
- Gateway reaches Campaign through the private VPS A-to-VPS B path. Campaign-to-Audience calls remain versioned, authenticated, deadline-bound service calls even though both deployables share VPS B. No database shortcut is permitted.

Trade-offs and extraction gate:

- Launch and execution are eventually consistent because no cross-module transaction exists. Explicit intermediate states, idempotent consumption, reconciliation, and observable queue age are the accepted controls.
- A single repository and image simplify delivery but can allow accidental coupling. Dependency-boundary linting, architecture tests, schema-access tests, contract tests, and separate module ownership in code review enforce the boundary.
- A shared database simplifies the initial topology but makes future data relocation a migration. The absence of cross-schema joins, foreign keys, and transactions keeps that migration bounded and rehearsable.
- VPS B failure degrades Audience plus both Campaign modules while Mail, Identity, and Billing continue on VPS A. Resource reservations prevent execution workers from starving Audience or Campaign Control.
- Extract Campaign Execution into the Delivery Service when workers need independent horizontal scale; campaign retry/orchestration incidents degrade authoring; queue age or database contention misses its SLO; deployments require independent cadence; or the execution schema needs independent recovery, retention, or database scaling. Extraction includes its own database, image/repository, Infisical identity, placement gate, and stable consumption of the existing Campaign-to-Mail contracts. It does not inherit Resend credentials or provider ownership unless a later explicit ADR transfers that boundary from Mail.
- If combined Audience and Campaign load leaves unsafe VPS B headroom before Delivery extraction is justified, Campaign moves to the next dedicated host available rather than being placed on the critical VPS A by default. It may use VPS C only before Automation production reserves that host; afterward it uses another host such as VPS D.

Primary stack evidence:

- [Node.js event-loop guidance](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [Hono on Node.js](https://hono.dev/docs/getting-started/nodejs)
- [Drizzle ORM PostgreSQL support](https://orm.drizzle.team/docs/get-started-postgresql)
- [RabbitMQ reliability, redelivery, and idempotent-consumer guidance](https://www.rabbitmq.com/docs/reliability)
- [RabbitMQ acknowledgements and publisher confirms](https://www.rabbitmq.com/docs/confirms)
- [Redis data-type and command documentation](https://redis.io/docs/latest/develop/data-types/)

Primary references:

- [OCI networking and regional VCN/subnet model](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/overview.htm)
- [OCI network security groups](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/networksecuritygroups.htm)
- [OCI networking security guidance](https://docs.oracle.com/en-us/iaas/Content/Security/Reference/networking_security.htm)
- [OCI Always Free resources and current allocation rules](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [DigitalOcean VPC](https://docs.digitalocean.com/products/networking/vpc/)
- [DigitalOcean Cloud Firewalls](https://docs.digitalocean.com/products/networking/firewalls/)
- [WireGuard protocol and cryptographic design](https://www.wireguard.com/protocol/)
- [WireGuard quick start](https://www.wireguard.com/quickstart/)

## 17. Delivery, testing, and operations

### CI/CD

- Trunk-based development around `main` with pull-request validation.
- GitHub Actions runs linting, type checks, unit/integration tests, builds immutable SHA-tagged images, and deploys after merge.
- Deployment sequence: build once, deploy to homologation, run smoke/E2E tests, then automatically promote the same artifact to production.
- Use OIDC where supported, protected GitHub environments, deployment concurrency locks, and audited secrets.
- Database changes follow expand-and-contract migrations.
- Rollback restores the previous application artifact; forward-compatible migrations avoid destructive rollback assumptions.

A minimal isolated homologation environment exists before real customer usage, even if the richer staging workflow arrives after the first internal MVP phase.

### Testing

MVP tests include:

- Unit tests for domain and application logic.
- Integration tests against real PostgreSQL.
- RLS and cross-tenant isolation tests.
- API contract tests.
- Worker retry, idempotency, lease-expiry, and reconciliation tests.
- Critical end-to-end browser flows.
- Mocked Resend and other paid/external provider boundaries where deterministic behavior is required.

After extraction, end-to-end and integration environments use real service databases, RabbitMQ, and Redis while external providers remain mocked where appropriate. Contract compatibility and asynchronous-event evolution become CI gates.

#### Selected testing stack

**Vitest** is the shared TypeScript test runner for backend and frontend unit/application tests.

- Why: it is ESM-first, supports TypeScript/JSX directly, integrates with the Vite-based frontend toolchain, has fast watch mode, mocking, projects, sharding, and V8 coverage. A shared runner reduces configuration and cognitive load for two developers.
- Trade-off: backend tests inherit part of the Vite/Vitest ecosystem even though Core does not otherwise need Vite. Tests must avoid Vitest-specific magic that hides Node.js runtime differences.
- Not selected now: Jest would add a second transformer/configuration path and weaker alignment with the frontend toolchain; Node's built-in test runner is intentionally smaller but would require assembling more mocking, coverage, and frontend integration conventions.
- Re-evaluate when: Vitest creates Node compatibility problems, test startup/parallelism becomes a bottleneck, or a future non-TypeScript service needs its native test framework.

**React Testing Library with `user-event`** tests React components and hooks through accessible user-observable behavior.

- Why: it discourages coupling tests to component internals and naturally exercises labels, roles, focus, and accessible interactions relevant to a Gmail-like interface.
- Trade-off: complex editors, drag-and-drop builders, and browser layout behavior cannot be represented faithfully in a simulated DOM and must move to browser tests.
- Not selected now: shallow/component-instance testing would produce brittle tests tied to implementation details.
- Re-evaluate when: TanStack Start or Base UI recommends a more faithful official browser-component harness that materially reduces duplicate E2E coverage.

**Mock Service Worker (MSW)** provides frontend HTTP mocks at the network boundary.

- Why: the same request handlers can support local development, component tests, and selected browser scenarios without coupling mocks to a specific fetch client.
- Trade-off: hand-written handlers can drift from OpenAPI. CI must validate representative fixtures/contracts, and MSW must not replace real integration tests.
- Not selected now: mocking TanStack Query or individual fetch functions would test implementation details and duplicate behavior per client.
- Re-evaluate when: generated OpenAPI mock servers can replace most manual handlers without harming scenario readability.

**Testcontainers for Node.js** provisions real disposable infrastructure for integration tests.

- Why: PostgreSQL-specific RLS, roles, migrations, transactions, `LISTEN/NOTIFY`, and pg-boss cannot be validated by an in-memory substitute. The same approach extends to RabbitMQ and Redis after service extraction.
- Trade-off: Docker is required, cold CI startup is slower, and careless parallel suites consume significant resources. Containers are shared at suite level while each test receives isolated database/schema state.
- Not selected now: SQLite/in-memory database substitutes cannot prove PostgreSQL tenancy or queue behavior; a shared remote test database creates ordering, cleanup, and developer-contention risks.
- Re-evaluate when: CI duration becomes material, at which point image caching, suite sharding, reusable containers, and dedicated ephemeral database branches are measured before changing fidelity.

**Playwright** is the end-to-end browser framework.

- Why: it provides isolated browser contexts, reliable auto-waiting, traces, and Chromium/Firefox/WebKit coverage. It can cross the real Web, Core API, worker, PostgreSQL, and object-storage boundaries that unit tests cannot prove.
- Trade-off: E2E tests are slower and more expensive to diagnose; the suite remains intentionally small and focused on critical journeys.
- Policy: Chromium runs on pull requests. Chromium, Firefox, and WebKit run in homologation or the scheduled cross-browser pipeline.
- Not selected now: Cypress would add another browser architecture without a demonstrated advantage for MailFlow's multi-context, download/upload, and cross-browser requirements.
- Re-evaluate when: measured flakiness, CI cost, or an unsupported browser interaction outweighs Playwright's cross-browser benefit.

#### Testing boundaries and gates

- Most external-provider tests use deterministic port-level fakes. A small controlled contract suite checks the real provider interface without sending to customer addresses.
- OpenAPI artifacts are validated and checked for breaking changes in CI.
- Integration tests apply real reviewed migrations and connect through the same restricted application role used in production.
- RLS, authorization, tenant isolation, idempotency, retries, uncertain delivery, concurrent autosave, purge, backup-deletion reconciliation, and worker lease recovery are mandatory invariants.
- No universal coverage percentage substitutes for risk-based assertions. Coverage reports expose blind spots; merge gates focus on changed critical behavior and required invariants.
- E2E uses dedicated QA identities and workspaces, never customer credentials or production tenant data.

#### Email-provider testing strategy

Email integration uses three deliberately different test layers:

1. A deterministic in-process `FakeEmailProvider` implements the MailFlow-owned provider port for most domain, application, worker, and browser journeys. It can explicitly produce success, validation failure, timeout, `429`, retryable `5xx`, uncertain delivery, duplicate acknowledgement, and reconciliation outcomes.
2. MSW intercepts HTTP at the Resend adapter boundary. These tests verify request/response translation, attachment references, idempotency keys, provider error classification, timeouts, and retry decisions without mocking internal methods of the Resend SDK.
3. A small real-provider contract suite runs against a dedicated homologation API key and Resend's safe test addresses. It exercises delivered, bounced, complained, and suppressed outcomes without sending to customer addresses.

Why this split fits:

- Port-level fakes keep business and retry tests fast, deterministic, and independent of quota or network availability.
- Network-boundary interception proves the adapter's HTTP behavior while remaining resilient to harmless SDK implementation refactors.
- A small real suite detects provider-contract, credential, DNS, webhook, and environment failures that no fake can prove.
- Resend's real test calls consume account quota, so they run after homologation deployment or on a controlled schedule, not on every pull request.

Inbound and webhook policy:

- Automated tests use locally signed raw-body fixtures and the production Resend/Svix verification path.
- Mandatory cases include missing/invalid signatures, stale timestamps, replay, duplicate `svix-id`, retry, out-of-order events, unknown event types, and acknowledgement after idempotent persistence.
- A controlled homologation round trip verifies real inbound receipt, Receiving API retrieval, attachment processing, and final inbox visibility.
- The Resend CLI `webhooks listen` command is a local development aid, not CI infrastructure or an architectural dependency.
- Real contract tests use dedicated test credentials, correlation labels, bounded quota, cleanup where applicable, and no production workspace/customer data.

Trade-offs and rejected alternatives:

- The fake must be maintained against the MailFlow-owned port, but this is intentional: domain tests should depend on MailFlow semantics rather than Resend SDK types.
- MSW fixtures can drift, so the limited real-provider suite remains required.
- Real tests can be slow or fail during a provider outage; they gate homologation/provider readiness, not ordinary unit-level pull-request feedback.
- Mailpit and MailHog are not selected because the production integration uses Resend HTTP APIs, Receiving API, and signed webhooks rather than SMTP. A fake SMTP server would validate a path MailFlow does not execute.
- Directly mocking Resend SDK methods is rejected because it couples tests to adapter implementation details and can pass without validating the actual HTTP contract.

Re-evaluate when MailFlow adds an SMTP provider adapter, a second email API provider, campaign-volume provider certification, or contractual inbox-client rendering requirements. Each provider then receives its own adapter contract suite while the common domain fake remains stable.

Primary references:

- [Vitest features](https://main.vitest.dev/guide/features)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Mock Service Worker](https://mswjs.io/)
- [Testcontainers for Node.js](https://node.testcontainers.org/quickstart/usage/)
- [Playwright test isolation and behavior](https://playwright.dev/docs/writing-tests)
- [Resend safe test addresses](https://resend.com/docs/knowledge-base/what-email-addresses-to-use-for-testing)
- [Resend end-to-end testing guidance](https://resend.com/docs/knowledge-base/end-to-end-testing-with-playwright)
- [Resend webhook delivery semantics](https://resend.com/docs/webhooks/introduction)
- [Resend inbound webhook verification](https://resend.com/docs/knowledge-base/forward-emails-with-resend-inbound)
- [Resend CLI webhook listener](https://resend.com/docs/cli)

### Observability and reliability

- OpenTelemetry begins in the MVP.
- Every request, job, command, and event carries correlation and causation identifiers.
- Logs are structured and exclude email content and other sensitive payloads.
- Product audit records are separate from operational logs.
- Feature flags and server-side kill switches protect risky capabilities.
- Initial SLO target: 99.5% monthly availability, HTTP request p95 below 500 ms, inbound email visible within 60 seconds, and outbound processing beginning within 30 seconds under normal operating conditions.
- Future core services target 99.9% when infrastructure and customer commitments support it.
- Recovery targets: RPO 15 minutes and RTO 4 hours.
- Backups are encrypted, retained according to policy, and periodically restored in a drill.

#### Selected observability stack

- OpenTelemetry SDK instruments Core API and worker boundaries.
- Pino produces structured JSON application logs.
- A vendor-neutral OpenTelemetry Collector runs on the MVP VPS; after Audience extraction, each VPS has a host-local Collector that performs enrichment, redaction, sampling, batching, and export.
- Grafana Cloud Free is the initial backend for metrics, logs, traces, dashboards, alerts, application observability, and synthetic checks.
- Grafana Faro supplies browser real-user monitoring, JavaScript error collection, Web Vitals, browser logs, and client traces, with private source-map uploads.
- Cloudflare's native Worker observability remains the fallback/source for Worker signals when the active Cloudflare plan does not permit external OTLP export. External export is enabled when plan support and cost are acceptable.

Why this stack fits:

- OpenTelemetry keeps instrumentation and correlation portable if the storage/visualization backend changes.
- One Grafana backend correlates infrastructure metrics, structured logs, distributed traces, frontend behavior, and SLO alerts without operating Loki, Tempo, Mimir, or Grafana on the single MVP host.
- The current Grafana Cloud Free allowance includes three active users, which fits the team, and usage allowances well above the controlled pilot baseline.
- Faro supplies browser errors, performance, sessions, and source maps without introducing a second observability vendor.
- Pino is a small, high-throughput structured logger for the Node.js workload; log routing and policy remain in the Collector rather than custom transports in domain code.

Initial telemetry policy:

- Capture every application error and security-relevant failure.
- Begin with approximately 10% head sampling for successful traces and preserve error/slow traces whenever the instrumentation pipeline can make that decision safely.
- Preserve `warn` and `error`; sample high-volume informational logs and never use verbose debug logging by default in production.
- Required metrics include request latency/errors, availability, queue depth/age/retries/DLQ, worker heartbeat, inbound/outbound lag, provider quota/degradation, attachment scanning, CPU, memory, filesystem, and process restarts.
- Initial alerts cover external API failure, elevated error rate, queue delay, missing worker heartbeat, PostgreSQL failure, critical resource pressure, and email-provider degradation.
- Synthetic checks exercise public API availability and a controlled smoke path.
- Correlation and causation identifiers propagate through browser, Worker, API, jobs, and later events.

Privacy and cardinality controls:

- Never emit email bodies, subjects, addresses, recipient lists, attachment filenames, prompts, generated content, authorization headers, cookies, provider payloads, or secrets.
- Faro receives technical/session data only and no email/name metadata. Custom metadata requires explicit allowlisting.
- Do not use raw `workspace_id`, `user_id`, `email_id`, job ID, recipient, or other unbounded values as metric labels.
- Use sampled trace/log attributes for investigation and low-cardinality dimensions for metrics.
- Source maps are uploaded privately during CI and are not served with public assets.

Trade-offs and rejected alternatives:

- Grafana requires more dashboard/query knowledge and may provide less polished exception grouping than Sentry.
- Grafana Free retention is shorter than the desired long-term audit history; audit records remain a product data concern, not telemetry.
- Cloudflare plan limitations can temporarily split Worker investigation between Cloudflare and Grafana.
- Sentry is not selected initially because its current Free tier permits one user and its Team tier adds a second paid telemetry platform. Sharing one account would violate individual accountability.
- Running both Grafana Cloud and Sentry would duplicate SDKs, traces, alert routing, privacy configuration, and investigation workflows before a measured need exists.
- Self-hosting the Grafana stack would consume the same VPS and enlarge its failure/operations surface.

Re-evaluate when Faro error triage demonstrably slows incident resolution, Free retention/ingestion is insufficient, Cloudflare export economics change, more services need centralized on-call workflows, or contractual observability retention/SLA appears. Sentry may then be introduced only for error tracking while OpenTelemetry remains canonical.

Primary references:

- [Grafana Cloud OTLP ingestion](https://grafana.com/docs/grafana-cloud/send-data/otlp/)
- [Grafana Cloud pricing](https://grafana.com/pricing/?tab=free)
- [Grafana Frontend Observability and Faro](https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/)
- [Grafana private source maps](https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/configure/sourcemap-uploads/)
- [Grafana Faro privacy controls](https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/settings-and-policies/data-privacy/)
- [Cloudflare Workers observability](https://developers.cloudflare.com/workers/observability/)
- [Sentry pricing](https://sentry.io/pricing/)

## 18. Geography and localization

- Initial infrastructure uses a US East logical region.
- This supports the initial international customer and remains acceptable for Brazilian users.
- The product UI launches in English.
- Internationalization is built in from the start.
- Timestamps are stored in UTC and rendered in the user's selected timezone.

## 19. Confirmed identifiers and lifecycle conventions

- Use UUIDv7 for entities, events, commands, and jobs where globally sortable identifiers are useful.
- Preserve correlation and causation through synchronous and asynchronous boundaries.
- Use idempotency keys at external side-effect boundaries.
- Keep append-only delivery attempts and minimal tombstones when required for reconciliation and safe deletion.

## 20. Architecture decision status

The architecture decision tree is closed. No conditional validation gate or deliberate deferral below may silently change the accepted service boundaries, tenancy model, trust boundaries, communication rules, lifecycle semantics, or MVP-to-distributed evolution. A material change requires an explicit new architecture decision.

### Confirmed

- MVP and distributed service boundaries, database ownership, tenancy/RLS model, REST/OpenAPI and event-contract rules, outbox/inbox semantics, deployment evolution, and trust boundaries.
- TypeScript/Node.js, Hono, Zod/OpenAPI, PostgreSQL/Drizzle, pg-boss for the MVP, RabbitMQ plus Redis at Audience extraction, Cloudflare/R2, MinIO locally, Neon production PostgreSQL, Infisical, OpenTelemetry, and GitHub Actions.
- React frontend with TanStack Query, Jotai, React Hook Form/Zod, Tailwind CSS, shadcn/ui with Base UI, Tiptap, and the documented visual-builder/workflow/analytics adapters.
- Resend owned solely by Mail, Stripe owned by Billing, OpenRouter owned by AI, and provider credentials never shared across bounded contexts.

### Confirmed with mandatory validation gate and documented fallback

- Better Auth: blocking transaction/session/MFA integration spike; MailFlow authorization ownership remains fixed.
- TanStack Start: Cloudflare, session, SSR/prerender, and productivity spike; fallback is React Router with Vite.
- Puck: lossless `EmailDocument`, accessibility, performance, and Base UI spike; fallback is raw dnd-kit or another adapter.
- MJML: representative compiler/client-compatibility spike; fallback may be the allowlisted React Email adapter while `EmailDocument` remains canonical.
- ClickHouse: mandatory comparison with TimescaleDB; any tenant-isolation failure selects TimescaleDB even if ClickHouse is faster.
- OpenRouter community AI SDK adapter: compatibility spike; fallbacks stay behind the AI-owned provider port.
- `amqplib`: connection/channel/consumer recovery spike; `amqp-connection-manager` may be added inside the adapter if native recovery is insufficient.
- R2 for OpenTofu state: locking and encrypted recovery spike; fallback is a managed backend or versioned object store.
- Token exchange/signing implementation and exact dependency major versions: security and compatibility validation before pinning. Every time-sensitive version or provider-limit claim used for implementation records a `verified_at` date and primary source.

These gates validate adapters and operations. Passing them confirms the preferred implementation; failing them activates the documented fallback without silently changing domain ownership or trust boundaries.

### Deliberately deferred until its trigger

- Exact generation model/provider allowlists and embedding provider/model.
- Physical placement and isolation triggers for later services beyond the accepted first Audience extraction.
- Exact managed KMS, region, SDK, authenticated-encryption implementation, pricing, and operational policy before the first per-workspace credential integration; the envelope-encryption boundary itself is already fixed.

## 21. Decision gates

Re-evaluate an accepted choice when its explicit trigger occurs:

- **OCI Free to paid compute**: daily customer dependency, contractual SLO, reclaim/capacity issues, or sustained resource pressure.
- **Logical to physical database separation**: independent scaling, blast-radius reduction, compliance, noisy-neighbor effects, or service-level recovery requirements.
- **pg-boss to RabbitMQ/Redis**: first independently deployed business service, beginning with Audience.
- **PostgreSQL search to dedicated search/vector storage**: attachment indexing, semantic retrieval, relevance limits, or measured query/load constraints.
- **AI `pgvector` to a dedicated vector database**: retrieval SLO or filtered ANN recall misses after tuning, unsafe index/maintenance cost, ingestion interference, required horizontal scale/isolation, or demonstrably better managed-service total cost and reliability.
- **ClickHouse to TimescaleDB for Analytics**: the mandatory spike or later evidence fails tenant isolation, managed-service cost, representative query-performance advantage, deletion/reconciliation SLO, contractual controls, or operational-burden criteria. Security failure overrides a performance advantage.
- **Apache ECharts to another visualization library**: representative dashboards fail bundle, interaction, accessibility, report-rendering, or maintainability gates; required charts demand disproportionate custom series work; or the delivered analytics scope remains simple enough that Recharts materially lowers total complexity.
- **MJML to React Email or another email compiler**: the representative compiler spike or production evidence shows excessive raw/custom-component pressure, unacceptable output size or worker cost, repeated client-compatibility regressions, inadequate accessibility, or a materially simpler alternative that preserves the MailFlow-owned `EmailDocument` and data-only trust boundary.
- **Puck to raw dnd-kit or another visual-editor engine**: the mandatory spike fails lossless `EmailDocument` adaptation, email-layout nesting, accessibility, Base UI integration, representative performance, upgrade stability, or authoritative-preview error mapping. Puck types never become durable contracts even if it passes.
- **React Flow to another graph editor**: representative workflows fail interaction, accessibility, controlled-state, collaboration, nested-graph, license, or maintainability gates after ordinary optimization. The canonical workflow definition and published runtime representation remain portable.
- **Resend free to paid/custom domains**: free quota pressure, production reputation requirements, or customer custom-domain purchase.
- **Pilot quotas to plan-based policy**: implementation of Plans & Billing. Recalculate workspace quotas and rate limits from plan entitlements, domain verification, usage, and sender reputation; preserve operational safety ceilings and kill switches independently of billing.
- **ClamAV to managed scanning**: operational burden, throughput, latency, signature-management risk, or compliance requirements.
- **Node.js to Bun for backend runtime**: measured compatibility, stability, operational tooling, and meaningful performance or cost benefit.
- **TypeScript to Python/Go for a service**: workload-specific evidence outweighs polyglot operational cost.
- **AI SDK/OpenRouter to another AI integration path**: adapter incompatibility, missing model features, gateway reliability/latency, fees or credit operations, privacy/DPA or residency failure, inadequate provider coverage, or a material direct-provider advantage.
- **OpenRouter to a direct or self-hosted embedding provider**: missing/pinned-model incompatibility, inadequate ZDR/DPA/region controls, gateway reliability or fees, material direct batch/throughput advantage, or measured self-hosting cost/privacy benefit. Changing embedding models always requires versioned re-embedding and retrieval evaluation.
- **TanStack Start to React Router/Vite fallback**: the spike fails stability, Cloudflare deployment, auth/session, SSR/prerender, or team productivity criteria.
- **R2 OpenTofu state to a managed/versioned backend**: the compatibility spike, locking, encrypted snapshot recovery, RPO, team access, drift detection, or audit controls become insufficient.
- **Free to paid RabbitMQ/Redis**: active customer dependency, contractual availability, repeated incidents, projected 70% hard-limit use, unsafe degraded behavior, or business impact greater than managed-service cost.
- **Two-host WireGuard to workload-aware transport**: static peer/key management becomes unsafe, hosts become dynamic or numerous, multiple providers/regions are introduced, or compliance/policy requires certificate-bound workload identity. Compare SPIFFE/SPIRE, application mTLS, managed private networking, and a service mesh at that point.
- **Infisical Free to paid/alternative delivery**: the first independently permissioned runtime after Audience, direct homologation runtime authentication, required path-scoped RBAC inside a service project, required secret versioning/PITR, stronger audit controls, or any other sixth identity. Audience on VPS B uses the fifth identity; VPS A and VPS B never share credentials, and the triggering service depends on delivery order.

## 22. Documentation still to produce

With the architecture decision tree closed, produce:

- Architecture Decision Records for material choices.
- Context, container, component, deployment, data-flow, trust-boundary, and evolution diagrams.
- A dedicated Astro and TypeScript architecture application, managed with Bun and created in its own child directory under the MailFlow workspace. It is static-first, ready for Vercel, and deployed by the project owner rather than by the implementation agent.
- The architecture application is the maintained repository-level source of truth for derived architecture views. It preserves this normative baseline under `docs/architecture/`, adds a stable decision catalog and coverage/drift checks, and must be updated whenever an approved product, service, stack, infrastructure, trust, or lifecycle decision changes.
- The architecture application provides connected, diagrammatic views of the MVP and future modes plus dedicated descriptive pages containing the decisions, motivations, trade-offs, rejected alternatives, validation gates, and re-evaluation triggers. The visual view accelerates understanding; it never replaces the detailed decision record.
- Application UI, code, and persisted documentation are written in English. The implementation is validated and production-ready for the owner's Vercel deployment, but deployment itself remains outside the implementation scope.
- The website must include a dedicated distributed-authentication/trust view showing the private signing-key boundary, public JWKS distribution and cache, separate workload and delegated identities, audience-restricted synchronous calls, local validation at every service, authorization projections, critical synchronous revalidation, and token renewal. The distinct durable RabbitMQ path must show per-service broker credentials/ACLs plus stable authorization IDs/generations and must visibly exclude expiring workload, user, and automation tokens. The diagram must not imply that public-key caching caches an authorization decision.
- The authentication view must show both deployment phases: an MVP in-process Core session check and the distributed `Browser -> Gateway -> Identity` ingress check. It must visibly place the Redis read-through cache inside the Identity ownership boundary, PostgreSQL as canonical fallback, cache invalidation/revocation paths, high-impact canonical checks, and the absence of repeated Identity calls in downstream services.
- The distributed communication view must contrast the accepted shallow interactive path and bounded parallel Gateway composition with a prohibited sequential service chain. It must also show how projections, outbox/events, durable jobs, choreography, and service-owned sagas replace deeper synchronous dependencies.
- The provider-ownership view must show Mail as the sole Resend owner. Campaign/Delivery own campaign execution and exchange versioned commands/results with Mail; they do not hold Resend credentials or call the provider directly.
- The tenant-credential view must separate Infisical platform/deployment secrets from encrypted per-workspace integration credentials in the owning service database, show the provider-neutral `CredentialCipher` boundary and managed-KMS envelope flow, and exclude plaintext secrets from RabbitMQ, Redis, workflow definitions, observability, and shared packages.
- The evolution/deployment view must show the MVP single-host topology separately from the mandatory first distributed topology: VPS A owns edge/Gateway/Identity/Mail/ClamAV, VPS B owns Audience API/worker, the hosts share the selected provider and US region plus provider-private networking but communicate through WireGuard, and managed Neon/RabbitMQ/Redis/R2 dependencies are reached directly by their owning services. It must identify OCI VCN/NSGs as the preferred implementation and DigitalOcean VPC/cloud firewalls as the tested fallback, and show that VPS B failure degrades Audience without representing VPS B as Core high availability.
- Per-service stack cards with reasons, trade-offs, and re-evaluation triggers.
- A non-technical MVP/client Word document stored under `docs/client/`, not rendered or publicly bundled by the architecture application. It contains only MVP delivery scope and delivery ranges, including explicit study, experimentation, understanding, and validation time proportional to feature complexity, and remains suitable for manual PDF export.
- Implementation epics and stories, including extraction/refactoring sprints created by the strangler plan.
