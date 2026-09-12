# ADR-0001: RabbitMQ as the post-MVP asynchronous substrate

## Metadata

| Field            | Value                                                 |
| ---------------- | ----------------------------------------------------- |
| ADR status       | `accepted`                                            |
| Decision state   | `confirmed_with_validation_gate`                      |
| Decision ID      | `decision.messaging.rabbitmq-distributed-transport`   |
| Date             | `2026-08-27`                                          |
| Owners/reviewers | MailFlow architecture owner                           |
| Effective phase  | First distributed extraction, beginning with Audience |
| Supersedes       | None                                                  |
| Superseded by    | None                                                  |

## Baseline provenance

- Baseline path: `docs/architecture/architectureBaseline.md`
- Section IDs and heading paths: `baseline.architectural-evolution`, `baseline.communication-and-contracts`, and `baseline.mvp-asynchronous-processing-and-realtime-updates`
- Source ranges and SHA-256 digests:
  - Lines 52-69: `908327a8d8a58583df70b8d03d79072b16754f71ff1fd1353c6c1382c42e128b`
  - Lines 142-149: `c6119ccc44de4f8f4d20c3adcd956b4d3300096ee40937394d250a0f53171779`
  - Lines 483-503: `26c83a3b909265e495cb73c90bc830d07e1a26e993e2135391358126339ac556`
- Baseline SHA-256 at review: `7f47204afc730b5310d5e8e1527d1d89c75d2ced068e7b46ea9e232d3ffa4013`
- Human approval: explicit architecture review request to establish RabbitMQ, recorded on 2026-08-27.

## Context and problem

Placement update (2026-09-12): [ADR-0002](./ADR-0002-railway-mvp-compute.md) supersedes this
record's VPS placement assumptions. Railway hosts the MVP services; paid VPS placement follows a
scale and operations review. The RabbitMQ decision, ownership boundaries, and equivalence gates
in this record remain in force. References to VPS A below describe the earlier placement context.

The MVP intentionally uses pg-boss because Mail domain state and internal job creation can commit in one PostgreSQL transaction without a broker. The first distributed architecture introduces RabbitMQ and horizontal workers, creating a choice between retaining two durable-job engines permanently or converging on one asynchronous substrate after the MVP.

A distributed MailFlow needs one explicit transport and worker model for both private service-owned jobs and cross-service messages. It must preserve transactional publication, durable scheduling, idempotency, and reconciliation without turning RabbitMQ into the canonical database or coupling Redis to job execution.

## Decision

RabbitMQ is the mandatory post-MVP substrate for both private service-owned durable work queues and versioned events or commands that cross independently deployed service boundaries. The decision becomes effective when Audience is extracted and the blocking equivalence and client-recovery gates pass.

Mail migrates its existing pg-boss jobs behind the unchanged internal job port:

- Internal queues such as send, provider fetch, attachment scan, reconciliation, and later service-owned jobs use private RabbitMQ queues and competing consumers. Their names and payloads are implementation contracts, not integration APIs.
- Cross-service intent uses producer-owned versioned schemas, a PostgreSQL transactional outbox, RabbitMQ publisher confirms, consumer inbox/idempotency, bounded retries, DLQ, and reconciliation.
- PostgreSQL remains authoritative for domain state, pending outbox rows, scheduled-dispatch timestamps, inbox/idempotency records, attempt history, and reconciliation state. A database transaction never claims to atomically include RabbitMQ.
- pg-boss remains available only as the cutover rollback path until every migrated queue reconciles and the acceptance window closes; it is then removed from the runtime stack.

Every later independently deployed service follows the same execution model. Redis has a separate lifecycle and remains limited to rebuildable cache, distributed rate limiting, presence, and realtime fan-out; it is not part of job migration, a durable queue, or canonical domain storage.

## Alternatives considered

| Alternative                                                | Outcome  | Reason                                                                                                                                                  |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep transport unspecified until each extraction           | Rejected | Produces incompatible service choices, duplicated operations, and migration at every new boundary.                                                      |
| Keep pg-boss permanently for service-local jobs            | Rejected | Creates two retry, DLQ, telemetry, scaling, and recovery models after horizontal workers already require RabbitMQ operations.                           |
| Migrate every pg-boss job after an equivalence gate        | Selected | Converges on one horizontally scalable worker substrate while PostgreSQL outbox, scheduling, inbox, and reconciliation preserve the required semantics. |
| Run RabbitMQ in the MVP                                    | Rejected | Adds deployment, monitoring, recovery, and resource cost before any distributed capability needs it.                                                    |
| Use PostgreSQL polling or pg-boss across service databases | Rejected | Violates service data ownership and couples independently deployed services through database access.                                                    |
| Select Kafka as the initial distributed backbone           | Rejected | MailFlow needs work queues, command routing, acknowledgements, retries, and DLQ semantics before a high-throughput retained event log.                  |

## Consequences and trade-offs

### Benefits

- One transport, worker-scaling model, security model, telemetry model, and recovery discipline for post-MVP asynchronous execution.
- Mail workers scale horizontally as competing consumers without sharing a pg-boss polling workload.
- Private jobs remain private while cross-service messages retain producer-owned versioned contracts.
- Existing ports and handler semantics survive the migration, limiting domain-code churn.

### Costs and risks

- The direct same-PostgreSQL transaction between domain state and pg-boss enqueue is replaced by a transactional outbox plus confirmed publication, so relay lag and duplicate publication become explicit failure modes.
- Mail temporarily operates both engines during cutover and must reconcile before removing pg-boss.
- Work queues require explicit policies for priority, prefetch, consumer timeout, retries, DLQ/redrive, delayed dispatch, graceful drain, and poison jobs.
- RabbitMQ availability now affects internal asynchronous execution as well as service integration, increasing the importance of quorum durability, capacity monitoring, and recovery tests.

### Re-evaluation triggers

- RabbitMQ cannot meet measured throughput, ordering, retention, replay, tenancy, or recovery requirements after ordinary tuning.
- A workload requires a retained event log or stream-processing semantics that commands and integration events cannot supply.
- RabbitMQ fails the blocking job-equivalence gate for a required Mail workload and the failure cannot be corrected without violating an accepted boundary.

## Impact review

- Services and bounded contexts: `service.mail` is adapted first; `service.audience` is the first independent consumer/producer; all later extracted services adopt the same cross-boundary rule.
- Data ownership/tenancy: unchanged. PostgreSQL remains authoritative and service-owned; no broker payload authorizes cross-database access.
- APIs, events, commands, jobs, and contracts: cross-service events and commands use producer-owned versioned schemas; internal RabbitMQ queues remain private implementation contracts behind service-owned job ports.
- Security, authentication, authorization, and trust boundaries: use environment isolation, per-service credentials and ACLs, stable authorization evidence, least-privilege routes, and no expiring user or workload token in durable messages.
- Infrastructure, placement, and deployment: RabbitMQ enters at Audience extraction as a managed dependency reached directly by owning services; Mail API and workers remain on VPS A and can scale independently. Redis activation is independent.
- Lifecycle, retention, deletion, and recovery: PostgreSQL outbox/inbox and reconciliation retain canonical intent; broker retention, retries, DLQ, and redrive remain bounded and observable.
- Diagrams and pages: `diagram.topology.first-distributed`, `diagram.security.outbox-inbox-reconciliation.first-distributed`, `diagram.capability.mail-provider-ownership`, `/communication/`, `/evolution/`, `/services/service.mail/`, and the generated decision page.
- Stacks and providers: `stack.rabbitmq`, `stack.amqplib`, `stack.rabbitmq-acl`, and `stack.postgresql`; `stack.pgboss` is transitional MVP and rollback-only during migration. `stack.redis` has an independent decision and gate.
- Coverage entries: baseline ranges 52-69, 142-149, 483-503, 2537-2542, and 2564-2570.

## Validation gate

- Required spike/test: `gate.messaging.rabbitmq-job-equivalence` plus `gate.messaging.amqplib-recovery`, using real disposable RabbitMQ and PostgreSQL instances and representative Mail job classes.
- Pass criteria: transactional outbox publication, quorum durability, publisher confirms, manual acknowledgements, bounded retry/backoff with jitter, priority, prefetch, consumer timeout/heartbeats, DLQ/redrive, PostgreSQL-backed scheduled dispatch, duplicate handling, idempotency, reconciliation, observability, graceful drain, reconnect/topology restoration, and horizontal competing-worker scale all pass under process and broker interruption.
- Documented fallback: retain pg-boss and do not cut over the failing job class. `amqp-connection-manager` may be added inside the MailFlow-owned adapter if native amqplib recovery is insufficient. Neither fallback changes service ownership or introduces Redis into job execution.
- Owner and due trigger: MailFlow backend owner, before Audience production extraction.

## References

- [RabbitMQ reliability guide](https://www.rabbitmq.com/docs/reliability)
- [RabbitMQ work queues tutorial](https://www.rabbitmq.com/tutorials/tutorial-two-javascript)
- [RabbitMQ publisher confirms and consumer acknowledgements](https://www.rabbitmq.com/docs/confirms)
- [RabbitMQ quorum queues](https://www.rabbitmq.com/docs/quorum-queues)
- [RabbitMQ access control](https://www.rabbitmq.com/docs/access-control)
- [RabbitMQ production checklist](https://www.rabbitmq.com/docs/production-checklist)

## Completion evidence

- [x] Applicable baseline updated.
- [x] Descriptive content updated.
- [x] Affected diagrams updated.
- [x] Related decisions updated.
- [x] ADR updated.
- [x] Coverage tests passing.

## Listening

The approved revision favors one post-MVP execution substrate because horizontal workers make two permanent queue engines more costly than useful. The rejected permanent dual-stack option preserved pg-boss transaction convenience but duplicated retry, DLQ, telemetry, and recovery behavior. Transactional safety is retained explicitly in PostgreSQL through outbox, schedule, inbox, and reconciliation records, while RabbitMQ supplies delivery and competing-worker scale. Private jobs and versioned integration contracts still remain separate even though they share the broker. Redis is deliberately decoupled and follows only ephemeral-state needs.
