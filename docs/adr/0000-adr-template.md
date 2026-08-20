# ADR-0000: <Short title>

<!-- Copy this file to ADR-NNNN-short-title.md. Replace every placeholder. -->

## Metadata

| Field            | Value                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| ADR status       | `draft` / `accepted` / `superseded` / `rejected`                           |
| Decision state   | `confirmed` / `confirmed_with_validation_gate` / `deferred` / `superseded` |
| Decision ID      | `decision.<bounded-context>.<slug>`                                        |
| Date             | `YYYY-MM-DD`                                                               |
| Owners/reviewers | `<names or roles>`                                                         |
| Effective phase  | `<MVP / first distributed extraction / future / explicit phase>`           |
| Supersedes       | `<ADR and decision ID, or none>`                                           |
| Superseded by    | `<ADR and decision ID, or none>`                                           |

## Baseline provenance

- Baseline path: `docs/architecture/architectureBaseline.md`
- Section IDs and heading paths: `<baseline.* / exact heading path>`
- Source block/range: `<stable block or line range>`
- Baseline SHA-256 at review: `<sha256>`
- Source digest: `<section/block digest>`

If the proposal is not present in the approved baseline, keep this ADR `draft` and identify the required human baseline decision. Do not project it as accepted architecture.

## Context and problem

<What problem or decision pressure exists? State constraints and evidence without inventing requirements.>

## Decision

<State the selected option and its boundaries. Include what is explicitly not selected.>

## Alternatives considered

| Alternative | Outcome                              | Reason                     |
| ----------- | ------------------------------------ | -------------------------- |
| `<option>`  | `rejected` / `deferred` / `fallback` | `<evidence and trade-off>` |

## Consequences and trade-offs

### Benefits

- <benefit>

### Costs and risks

- <cost, risk, or operational consequence>

### Re-evaluation triggers

- <measurable trigger, decision gate, or explicit `none documented`>

## Impact review

- Services and bounded contexts: `<stable IDs>`
- Data ownership/tenancy: `<impact or no impact with evidence>`
- APIs, events, commands, jobs, and contracts: `<impact>`
- Security, authentication, authorization, and trust boundaries: `<impact>`
- Infrastructure, placement, and deployment: `<impact>`
- Lifecycle, retention, deletion, and recovery: `<impact>`
- Diagrams and pages: `<diagram IDs and routes>`
- Stacks and providers: `<stack IDs>`
- Coverage entries: `<baseline refs and manifest IDs>`

## Validation gate

- Required spike/test: `<command, experiment, or evidence>`
- Pass criteria: `<criteria>`
- Documented fallback: `<choice or none>`
- Owner and due trigger: `<role / trigger>`

Passing a gate cannot silently change approved boundaries. A failed gate activates only the documented fallback or opens a new human decision.

## References

- `<primary reference from the baseline or newly approved evidence>`

## Completion evidence

- [ ] Applicable baseline updated.
- [ ] Descriptive content updated.
- [ ] Affected diagrams updated.
- [ ] Related decisions updated.
- [ ] ADR or changelog updated.
- [ ] Coverage tests passing.

## Listening

<Record the material trade-off, selected/rejected alternative, and follow-up risk for this ADR.>
