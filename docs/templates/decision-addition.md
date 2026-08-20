# Decision Addition Template

Use this template for a decision that is not already represented. A proposal without human-approved baseline authority remains `draft` and must not be rendered as accepted architecture.

## Identity and state

- Decision ID: `decision.<bounded-context>.<slug>`
- Title: `<short title>`
- State: `draft` until approved, then `confirmed`, `confirmed_with_validation_gate`, or `deferred`
- Phase: `<MVP / first distributed extraction / future>`
- Owner/reviewer: `<role or names>`
- Date: `YYYY-MM-DD`

## Baseline authority

- Baseline path: `docs/architecture/architectureBaseline.md`
- Section and heading path: `<baseline.* / exact path>`
- Source block/range: `<stable block or line range>`
- Baseline SHA-256: `<sha256>`
- Source digest: `<digest>`
- Human approval reference: `<review/issue/meeting reference>`

## Decision content

### Problem and context

<Describe the problem and constraints using only approved or explicitly evidenced information.>

### Selected decision

<Describe the choice, ownership, boundaries, and phase.>

### Alternatives considered and rejected

| Alternative     | Why it was not selected | Evidence                          |
| --------------- | ----------------------- | --------------------------------- |
| `<alternative>` | `<reason>`              | `<baseline or primary reference>` |

### Benefits, trade-offs, and risks

- Benefits: `<...>`
- Trade-offs: `<...>`
- Risks/operational consequences: `<...>`

### Re-evaluation gate

- Trigger: `<measurable trigger or deferred condition>`
- Validation: `<required spike/test>`
- Fallback: `<documented fallback, if any>`

## Affected projections

- Service IDs: `<...>`
- Stack IDs: `<...>`
- Diagram IDs: `<...>`
- Page routes: `<...>`
- Related decision IDs: `<...>`
- Coverage manifest entries: `<...>`

## Completion evidence

- ADR: `<ADR-NNNN or pending while draft>`
- Baseline diff/checksum: `<link or review evidence>`
- Coverage delta: `<before / after / unresolved>`
- Validation commands/results: `<...>`

## Listening

<Record why this option was selected, which alternative was rejected, and what remains to be watched.>
