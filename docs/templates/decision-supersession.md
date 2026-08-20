# Decision Supersession Template

Use this template when a material change needs a new decision identity. Preserve the predecessor for history and coverage; do not rewrite it into the successor.

## Relationship

- Predecessor decision ID: `decision.<bounded-context>.<old-slug>`
- Successor decision ID: `decision.<bounded-context>.<new-slug>`
- Predecessor ADR: `<ADR-NNNN>`
- Successor ADR: `<ADR-NNNN>`
- Effective phase: `<phase>`
- Approval reference: `<human approval>`

## Reason for supersession

<Explain the material change and why preserving the old meaning is no longer correct.>

## New decision

<State the successor choice, boundaries, ownership, and state.>

## Baseline provenance and delta

- Baseline path: `docs/architecture/architectureBaseline.md`
- Previous section/block and digest: `<...>`
- New section/block and digest: `<...>`
- Previous SHA-256: `<sha256>`
- New SHA-256: `<sha256>`
- Diff blocks: `<added / removed / changed>`
- Coverage delta: `<before / after / unresolved>`

## Impact review

- Services/data/tenancy: `<...>`
- Contracts and communication: `<...>`
- Security/trust: `<...>`
- Infrastructure/placement: `<...>`
- Lifecycle/retention/recovery: `<...>`
- Diagrams/pages/stacks/gates: `<IDs and routes>`

## Required historical links

- Predecessor record state becomes `superseded`.
- Successor record links `supersedes: <predecessor>`.
- Predecessor record links `superseded_by: <successor>`.
- Coverage retains both records and states the effective phase.
- Existing links are redirected only when the stable identity remains discoverable.

## Completion evidence

- [ ] Applicable baseline updated.
- [ ] Descriptive content updated.
- [ ] Affected diagrams updated.
- [ ] Related decisions updated.
- [ ] Applicable ADR or changelog updated.
- [ ] Coverage tests passing.

## Listening

<Record why the predecessor was superseded, which alternative was rejected, and what follow-up evidence is required.>
