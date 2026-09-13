# Railway and RabbitMQ Coverage Review

Status: approved by the MailFlow architecture owner on 2026-09-12.

## Review scope

- PR: https://github.com/MailFlow-AI-system/mailflow-architecture-hub/pull/1
- Baseline SHA-256: `9ca1c8e52adec6e4d2a6e6426dfdee6b035b9c9417acbe948c3c4c6dce88ea9d`.
- Approve Railway for the MVP across development, staging, and production, with separate API and worker services, Infisical Secret Sync, external Neon, and future paid VPS migration.
- Preserve the RabbitMQ job-equivalence and migration gates, the pg-boss MVP and rollback boundary, independent Redis adoption, service-owned data, authorization, and provider ownership.
- Treat Dockerfile, CI/CD, scanner, and observability implementation evidence as separate delivery work; panel configuration does not establish deployment health.
- This review covers source classification and projection traceability. It does not authorize a deployment or merge.

## Coverage delta

- Current records reviewed and approved: 362. Unresolved records after regeneration: 0.
- Historical removed records retained by the manifest: 209. Of these, 180 have identical content digests in current records under new identities. The other 29 are infrastructure sections or blocks superseded by the Railway placement decision and future VPS reference; historical entries remain available for comparison.
- The complete record keys, source ranges, source digests, and linked decisions are retained in [the coverage manifest](../architecture/coverageManifest.json).

| Baseline area                                        | Records approved |
| ---------------------------------------------------- | ---------------- |
| Document preamble                                    | 2                |
| Current MVP infrastructure decision                  | 4                |
| 2. Architectural evolution                           | 9                |
| 4. Communication and contracts                       | 13               |
| 7. Authentication and service identity               | 5                |
| 10. Attachments and email-content security           | 3                |
| 11. MVP asynchronous processing and realtime updates | 8                |
| 13. AI and RAG security boundary                     | 15               |
| 14. Backend stack                                    | 7                |
| 16. Infrastructure                                   | 268              |
| 17. Delivery, testing, and operations                | 15               |
| 20. Architecture decision status                     | 8                |
| 21. Decision gates                                   | 3                |
| 22. Documentation still to produce                   | 2                |

## Approval record

- Reviewer: MailFlow architecture owner.
- Approval date: 2026-09-12.
- Evidence: explicit response approving both Railway and RabbitMQ after the owner was asked to approve the exact baseline and its 362 coverage records. The response translates to "Yes, approve both."
- Conversation reference: `01a0964e-888b-7023-b9c0-86160cf2d28c`.
- The approval covers the baseline digest above and the retained removal history. It does not automatically approve subsequent source changes.
- The agent recorded the owner approval; it did not act as the human reviewer.

## Listening

The CI failure is an intentional governance gate. Recording explicit owner approval preserves the requirement without disabling validation or attributing an automated review to a human. Later source-digest changes must invalidate the affected approvals.
