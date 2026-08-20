# Decision Change Template

Use this template when the meaning of an existing decision remains the same but its approved evidence, scope, state, phase, gate, or consequences changes. If the meaning changes materially, use [Decision Supersession](./decision-supersession.md).

## Identity

- Existing decision ID: `decision.<bounded-context>.<slug>`
- Title: `<title>`
- Current state: `<state>`
- Requested state: `<state>`
- Owner/reviewer: `<role or names>`
- Date: `YYYY-MM-DD`

## Source change

- Previous baseline reference: `<section/block and source digest>`
- New baseline reference: `<section/block and source digest>`
- Previous baseline SHA-256: `<sha256>`
- New baseline SHA-256: `<sha256>`
- Human approval reference: `<review/issue/meeting reference>`
- Change summary: `<what changed and why>`

## Impact review

Complete [the impact-review template](./impact-review.md), including explicit no-impact evidence for every category that remains unchanged.

## Projection updates

- Descriptive page: `<route and changes>`
- Diagrams: `<diagram IDs and changes>`
- Services/bounded contexts: `<IDs and changes>`
- Stacks/providers: `<IDs and changes>`
- Related decisions/gates: `<IDs and changes>`
- Coverage manifest: `<entries and delta>`
- ADR/changelog: `<ADR-NNNN or entry>`

## Validation and completion

- [ ] Applicable baseline updated.
- [ ] Descriptive content updated.
- [ ] Affected diagrams updated.
- [ ] Related decisions updated.
- [ ] Applicable ADR or changelog updated.
- [ ] Coverage tests passing.

## Listening

<Record the selected change, rejected alternatives, and follow-up risk.>
