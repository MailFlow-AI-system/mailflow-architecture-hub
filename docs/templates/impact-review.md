# Architecture Impact Review Template

Use this review before changing a confirmed decision, activating a validation fallback, or changing a service/communication/data/trust boundary.

## Change identity

- Change/decision ID: `<stable ID>`
- ADR: `<ADR-NNNN>`
- Requester/owner: `<role or names>`
- Date: `YYYY-MM-DD`
- Baseline SHA-256 before/after: `<...> / <...>`
- Review status: `pending` / `approved` / `blocked`

## Source and reason

- Exact baseline sections/blocks: `<...>`
- Problem/evidence: `<...>`
- Proposed outcome: `<...>`
- Alternatives considered: `<...>`
- Human approval reference: `<...>`

## Impact matrix

| Area                                  | Impacted IDs/paths | Change  | Explicit no-impact evidence or follow-up |
| ------------------------------------- | ------------------ | ------- | ---------------------------------------- |
| Services and ownership                | `<...>`            | `<...>` | `<...>`                                  |
| Data ownership and tenancy            | `<...>`            | `<...>` | `<...>`                                  |
| APIs, events, commands, jobs          | `<...>`            | `<...>` | `<...>`                                  |
| Authentication, authorization, trust  | `<...>`            | `<...>` | `<...>`                                  |
| Infrastructure, placement, deployment | `<...>`            | `<...>` | `<...>`                                  |
| Lifecycle, retention, purge, recovery | `<...>`            | `<...>` | `<...>`                                  |
| Stacks and provider ownership         | `<...>`            | `<...>` | `<...>`                                  |
| Diagrams and pages                    | `<...>`            | `<...>` | `<...>`                                  |
| Coverage and drift checks             | `<...>`            | `<...>` | `<...>`                                  |
| Privacy and client boundary           | `<...>`            | `<...>` | `<...>`                                  |

## Gates and validation

- Decision state and phase: `<...>`
- Validation gate/trigger: `<...>`
- Documented fallback: `<...>`
- Tests and commands: `<...>`
- Coverage before/after/unresolved delta: `<...>`
- Reviewer decisions: `<authority / identity / impact / projection / coverage / privacy / validation / integration>`

## Six-condition completion evidence

- [ ] Applicable baseline updated.
- [ ] Descriptive content updated.
- [ ] Affected diagrams updated.
- [ ] Related decisions updated.
- [ ] Applicable ADR or changelog updated.
- [ ] Coverage tests passing.

## Listening

<Record the meaningful trade-off, selected/rejected alternatives, and remaining risk.>
