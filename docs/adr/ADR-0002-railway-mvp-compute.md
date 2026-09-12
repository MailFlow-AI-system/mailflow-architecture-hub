# ADR-0002: Railway as the MVP compute platform

## Metadata

| Field            | Value                                                                              |
| ---------------- | ---------------------------------------------------------------------------------- |
| ADR status       | `accepted`                                                                         |
| Decision state   | `confirmed`                                                                        |
| Decision ID      | `decision.platform.compute-placement`                                              |
| Date             | `2026-09-12`                                                                       |
| Owners/reviewers | MailFlow architecture owner                                                        |
| Effective phase  | MVP                                                                                |
| Supersedes       | None; revises the existing `decision.platform.compute-placement` baseline decision |
| Superseded by    | None                                                                               |

## Baseline provenance

- Baseline path: `docs/architecture/architectureBaseline.md`
- Section IDs and heading paths: `baseline.infrastructure` / `## 16. Infrastructure`; `baseline.infrastructure.backend-compute` / `### Backend compute`; `baseline.infrastructure.mvp-deployment-topology` / `### MVP deployment topology`; `baseline.infrastructure.secrets-management` / `### Secrets management`; `baseline.delivery-testing-and-operations.ci-cd` / `### CI/CD`
- Baseline before this commit: SHA-256 `22486b0560ff42fd63b42475df9ec98fb4315175ccc41a51ad238a814c2bbea4`, 364,047 bytes, 2,609 lines, 47,117 words (RabbitMQ prerequisite commit).
- Baseline after this decision: SHA-256 `9ca1c8e52adec6e4d2a6e6426dfdee6b035b9c9417acbe948c3c4c6dce88ea9d`, 370,617 bytes, 2,615 lines, 47,950 words.
- Baseline source change evidence: `docs/architecture/architectureBaseline.md` passed `git diff --check`; the before/after source diff is retained in the working tree for review. Existing RabbitMQ changes remain in the same working tree and are preserved.
- Human approval: explicit architecture instruction on 2026-09-12 to move the MVP compute and services from the VPS plan to Railway, accept the operating cost, and retain a future VPS migration when the system scales.

## Context and problem

The earlier compute plan centered on an OCI or DigitalOcean VPS. OCI account creation was not practical for the project, DigitalOcean has no recurring free tier, and the evaluated Northflank free tier could not support the complete three-environment API, worker, and ClamAV arrangement without paid capacity. The MVP needs isolated development, staging, and production execution while the team is still small and the product has not yet produced measured host-level scale or availability requirements.

Railway provides the required environment and persistent-service model inside an already paid account. The user has configured the `mailflow-core` project with three environments and six services, and accepted the operational cost while preserving the option to migrate to paid VPS compute after scale evidence justifies host operations.

## Decision

Railway is the accepted compute and native CD platform for the MailFlow MVP:

- The `mailflow-core` Railway project has isolated `development`, `staging`, and `production` environments.
- Each environment has a separate API service and worker service: `dev-api-core`/`dev-api-worker`, `staging-api-core`/`staging-api-worker`, and `api-core`/`api-worker`.
- The API services use the Railway-generated public domains `mailflow-core-api-dev.up.railway.app`, `mailflow-core-api-staging.up.railway.app`, and `mailflow-core-api.up.railway.app`. Worker services have no public domain or HTTP ingress.
- Railway and the corresponding Neon environments use US East (Virginia). Neon remains the external PostgreSQL provider; R2, Resend, Cloudflare frontend delivery, and the existing service ownership boundaries remain unchanged.
- Infisical remains the source of truth in project `MailFlow-AI`. Each Infisical environment uses `/mailflow-core`; the three Railway App Connections use environment-scoped Project Tokens, and six service-level Secret Syncs deliver `DATABASE_URL` to the matching API and worker services. `APP_ENV` remains ordinary Railway configuration isolated by environment.
- The selected Dockerfile remains the portable API/worker build contract. It is retained for runtime control and a future VPS migration, even though Railway can build without one. Dockerfile and GitHub Actions CI implementation and validation are tracked by the CI/CD work.
- Railway native auto-deploy and Wait for CI are configured for all six services. GitHub Actions owns CI quality gates; Railway owns native build and CD after the CI result permits a deployment.
- ClamAV remains mandatory before an attachment becomes available. The planned MVP ClamAV workload is private and has no public ingress; it has not yet been provisioned. A local container is a future VPS implementation option.

This decision does not change the modular Core boundary, separate API/worker processes, PostgreSQL ownership, pg-boss MVP job semantics, RabbitMQ migration gate, Redis lifecycle, provider ownership, or application-level workload authorization.

The production branch mapping (`production` versus the existing `main`) remains unresolved and must be decided before branch protection and final Railway branch mappings are documented. The earlier build-once and same-digest promotion policy also remains open: Railway native auto-deploy may rebuild per environment, so it cannot be described as immutable digest promotion without a separate CI/CD decision and evidence.

## Alternatives considered

| Alternative                                   | Outcome                                        | Reason                                                                                                                                                                            |
| --------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCI Always Free or paid VPS                   | Rejected for the current MVP; future candidate | Account creation was impractical for the project. A future paid OCI migration remains possible only after a fresh provider and capacity review.                                   |
| DigitalOcean VPS                              | Rejected for the current MVP; future candidate | It is operationally portable but has no recurring free tier, and its host operations are not justified before measured scale.                                                     |
| Northflank free tier                          | Rejected                                       | The free service/job allowance cannot support the complete isolated API, worker, and private scanning topology across three environments without paid capacity.                   |
| Railway native environments and deployments   | Selected                                       | The existing paid account provides the required environment separation and persistent API/worker services with a small operational surface.                                       |
| Build once and promote a GHCR image by digest | Deferred/open                                  | It preserves artifact identity but requires an additional registry and deployment orchestration path. The current Railway auto-deploy configuration does not prove this property. |

## Consequences and trade-offs

### Benefits

- The MVP has explicit environment separation without waiting for VPS provisioning or host administration.
- API and worker release boundaries remain separate while sharing one repository and portable image recipe.
- External Neon, R2, Resend, and Infisical boundaries remain portable and independent of Railway.
- The account boundary between the user's GitHub/Railway account and the MailFlow Infisical project is acceptable because the integration uses explicit environment-scoped Railway Project Tokens; GitHub repository ownership and secret ownership remain separate concerns.
- A later VPS migration can retain the application image, external state, service ownership, and environment contracts.

### Costs and risks

- Railway charges for the resources used by the three environments; the project accepts this cost during the MVP.
- Native Railway auto-deploy can rebuild services independently, so a successful deployment does not establish same-digest promotion across API and worker or across environments.
- Railway's platform failure and networking semantics differ from a self-managed host; host-level tuning, private-network controls, Caddy, Cloudflare Tunnel, blue/green slots, and host-local collectors remain future VPS concerns.
- Secret Sync changes can trigger service restarts or redeployments outside a merge flow and require environment-specific validation.
- The current Railway panel configuration is not evidence that Dockerfile, CI, health checks, ClamAV, or worker job processing are implemented and healthy.

### Re-evaluation triggers

- Daily customer dependency, a contractual availability target, sustained CPU/memory or worker pressure, a measured Railway cost profile that exceeds the value of managed operations, provider control or portability requirements, or an incident pattern that requires host-level isolation.
- A future migration must select and revalidate the provider, region, sizing, private network, ingress, secret delivery, deployment, backup, monitoring, and rollback design. OCI and DigitalOcean remain candidates rather than predetermined choices.

## Impact review

- Services and bounded contexts: `service.identity-workspace`, `service.mail`, and the Core API/worker remain one modular backend repository; future independently deployed services retain their own domain and data ownership.
- Data ownership/tenancy: unchanged. Railway hosts processes only; Neon remains the canonical external PostgreSQL boundary, and no service gains cross-database access.
- APIs, events, commands, jobs, and contracts: API/worker commands remain separate; pg-boss remains the MVP queue behind its internal port; RabbitMQ and outbox/inbox semantics remain gated for the first distributed extraction. Public API domains change only the ingress hostname.
- Security, authentication, authorization, and trust boundaries: Infisical remains the deployment secret authority; `DATABASE_URL` is delivered per environment and service; `APP_ENV` is non-secret Railway configuration; no host identity, public worker route, bearer token in durable messages, or cross-service authorization shortcut is introduced.
- Infrastructure, placement, and deployment: current compute changes from the earlier VPS pilot wording to Railway in US East (Virginia), with six services and native CD. Dockerfile portability and a future VPS reference are retained; OCI/DigitalOcean, Cloudflare Tunnel, Caddy, blue/green, WireGuard, and host-local collectors are future options only.
- Lifecycle, retention, deletion, and recovery: canonical data remains in Neon/R2/provider systems; application rollback remains distinct from database recovery; a future VPS migration requires rehearsed backup and restore evidence.
- Diagrams and pages: current and future deployment views must distinguish Railway MVP from the future VPS reference; the affected architecture application projections and generated routes require synchronization by the application owner.
- Stacks and providers: Railway is current compute/CD; Dockerfile, GitHub Actions, Node.js, Neon, R2, Resend, Infisical, ClamAV, and OpenTelemetry remain bounded by their existing decisions. OCI and DigitalOcean are historical future candidates.
- Coverage entries: baseline section 16, baseline section 17, and the affected infrastructure/stack/phase records in the consolidation; before/after checksum and size evidence is recorded above.

## Validation gate

- Required spike/test: implement and run the GitHub Actions CI workflow and selected Dockerfile; deploy the same commit to Railway development after CI approval; verify API startup, `/health/live`, `/health/ready` against the development Neon database, worker startup, Secret Sync presence without exposing values, and failed-CI deployment blocking.
- Pass criteria: lint, format, typecheck, tests, build, and image smoke checks pass; each API is reachable at its environment-specific domain; readiness confirms the matching Neon database; workers have no public route and start with the worker command; CI failure prevents the Railway deployment; no secret appears in artifacts or logs.
- Documented fallback: retain Railway native build/CD for the MVP while resolving a failing image or CI check; a future paid VPS migration is the compute fallback when its re-evaluation triggers pass. Do not claim immutable same-digest promotion unless the separate CI/CD decision selects and validates it.
- Owner and due trigger: MailFlow backend/DevOps owner, before the first staging or production release.

Passing this gate validates the implementation and deployment flow; it does not activate RabbitMQ, Redis, a future VPS topology, or a different service ownership model.

## References

- [Railway environments](https://docs.railway.com/environments)
- [Railway deployments and builds](https://docs.railway.com/deployments)
- [Railway GitHub auto-deploys](https://docs.railway.com/deployments/github-autodeploys)
- [Infisical Railway integration](https://infisical.com/docs/integrations/app-connections/railway)
- [Infisical Railway Secret Sync](https://infisical.com/docs/integrations/secret-syncs/railway)
- `docs/architecture/architectureBaseline.md`, Sections 16 and 17
- `docs/architecture/architectureConsolidation.md`, Sections 4, 12, 13, and 15

## Completion evidence

- [x] Applicable baseline updated.
- [x] Descriptive consolidation updated.
- [x] Affected diagrams and generated architecture pages synchronized and checked locally.
- [x] Related decision record added.
- [x] Catalog integrity, 48 unit tests, Astro type checks, lint, formatting, diagram digests, static build, privacy, and route checks pass.
- [ ] Human coverage review: the regenerated manifest records 362 baseline-delta records requiring review; `coverage:check` deliberately remains blocked until those records are reviewed.

## Listening

Railway was selected because the MVP needs three isolated environments and persistent API/worker execution before the team has evidence that operating VPS hosts is worth its cost. The project accepts Railway's operational cost and keeps the Dockerfile and external state boundaries portable. OCI and DigitalOcean remain future candidates rather than promises. The main follow-up risk is artifact identity: Railway native auto-deploy may rebuild each service and environment, so the earlier same-digest promotion policy remains an explicit CI/CD decision. The branch representing production also remains unresolved until the repository and Railway branch mappings are finalized.
