# Source-of-Truth Governance

## Purpose

The MailFlow architecture repository preserves the approved architecture and exposes maintainable projections of it. It is the repository-level source of truth for the architecture application, but it does not silently replace the approved narrative baseline with UI code or a diagram file.

The active narrative authority is:

```text
docs/architecture/architectureBaseline.md
```

The baseline remains active and authoritative. It is not an abandoned historical snapshot. The current import records the following evidence:

| Field    | Initial import                                                     |
| -------- | ------------------------------------------------------------------ |
| SHA-256  | `4dfc6a5ea4fc217d8f6de83e033ad0d2375244aef1bd37d263520d8a479575fc` |
| Size     | 360,504 bytes                                                      |
| Lines    | 2,609                                                              |
| Words    | approximately 46,667                                               |
| Imported | 2026-08-20                                                         |

The checksum is evidence of the import, not a claim that the baseline can never change. A later approved baseline change must produce a visible source diff and coverage delta.

## Authority and projections

The repository uses one authority and several derived projections:

1. The baseline records the approved narrative, conditions, alternatives, evidence, and decision gates.
2. Structured decision, service, stack, phase, gate, and relationship records translate that narrative into stable data for navigation and validation.
3. Diagram models project those records into bounded views. A diagram is never an independent decision source.
4. Descriptive pages render structured records and link back to their baseline origins. Components contain presentation logic only.
5. Coverage and integrity reports prove which baseline material has been classified and where it is projected.

When projections disagree with the baseline, the repository is in a drift state. The merge is blocked until a human approves either a baseline update or a corrected projection. An agent must not resolve a conflict by silently choosing whichever source is easier to edit.

No decision, service responsibility, relationship, stack, phase, or gate may be invented to fill an empty projection. Missing baseline evidence is recorded as `not documented in baseline`, and any proposal remains unapproved until a human architecture decision updates the baseline and its records.

## Stable identity

Every durable record has an identity that does not change when its title or page route changes:

- Decisions use `decision.<bounded-context>.<slug>`.
- Services use `service.<bounded-context>.<slug>`.
- Stacks use `stack.<technology-or-capability>.<slug>`.
- Diagrams use `diagram.<view>.<phase>`.
- Gates use `gate.<decision-or-capability>.<slug>`.
- Baseline sections use `baseline.<section-slug>` and preserve a heading path plus a source block/range.
- Relations use `relation.<source-id>.<type>.<target-id>`.

IDs are lowercase, opaque to presentation, unique within their namespace, and never reused for a different meaning. Renaming an entity updates labels and aliases while retaining its ID. Splitting or merging entities requires an explicit change record and a coverage migration map.

## Decision lifecycle

Architecture decision records and projections distinguish record workflow from architecture state:

- `draft`: being prepared and not an approved architecture decision.
- `confirmed`: approved without a conditional implementation gate.
- `confirmed_with_validation_gate`: approved choice with a mandatory validation gate and documented fallback.
- `deferred`: intentionally postponed until a documented trigger.
- `superseded`: replaced by a later approved decision; retained for history and traceability.

Only a human-approved change may move an architectural decision between states. Passing an implementation spike activates a documented fallback or confirms a documented choice; it does not silently reopen service boundaries, tenancy, trust boundaries, lifecycle rules, or the MVP evolution.

## Update lifecycle

Every architectural update follows this order:

1. Identify the affected baseline sections, existing IDs, services, relations, diagrams, pages, stacks, and gates.
2. Capture the current baseline checksum and produce a section-aware diff. If the baseline is changing, obtain human approval and record the new checksum.
3. Create or update the decision record and its provenance before changing a projection.
4. Update structured content and affected diagrams from the records, not from copied prose in components.
5. Update pages, links, coverage metadata, and the ADR/changelog entry.
6. Run integrity, coverage, link, accessibility, and relevant behavior checks.
7. Pass the review gates and merge with a focused English commit.

The six required completion conditions are defined exactly in [the architecture change process](./architecture-change-process.md). A change is incomplete if any condition is missing, even when the application builds.

## Baseline synchronization

The import/synchronization process records, before and after each sync:

- SHA-256, byte size, line count, word count, and timestamp.
- Heading/section identity and source block identifiers.
- Added, removed, and changed blocks, with a human-readable diff.
- Affected decision, service, stack, relation, diagram, page, and gate IDs.
- Coverage status before and after the change.

A changed baseline block must not disappear into a regenerated aggregate file. The coverage report exposes the delta and marks unresolved records as requiring review. The baseline remains in `docs/architecture/architectureBaseline.md` after synchronization.

## Privacy boundary

`docs/client/` is private commercial material. It is not architecture authority, is not imported into content collections, is not copied to `public/`, and must not appear in `dist/`. The approved future `.docx` is added separately. No customer data, credentials, secrets, or private client material belongs in architecture projections, fixtures, diagrams, or generated assets.

## Listening

The baseline stays active because projections need a stable narrative authority while the architecture evolves. Stable IDs, provenance, and measurable coverage make the visual application maintainable without creating a competing source of truth.
