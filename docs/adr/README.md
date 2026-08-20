# Architecture Decision Records

## Role

ADRs record the decision process, evidence, and approved change history. They complement the active baseline; they do not become a second narrative source of truth. A decision page and diagram link to both the ADR and the precise baseline reference.

## Naming and identity

Use a monotonically assigned filename such as `ADR-0001-short-title.md`. The filename is a history identifier, not the canonical decision identity. Every ADR also declares a stable `decisionId` such as `decision.identity.service-tokens` and the relevant `baselineRef` values.

Do not reuse an ADR number or decision ID for a different meaning. A superseding ADR links both directions and retains the predecessor.

## Status

Record workflow status (`draft`, `accepted`, `superseded`, or `rejected`) separately from architecture state (`confirmed`, `confirmed_with_validation_gate`, `deferred`, or `superseded`). A draft ADR is not an approved decision. A rejected proposal is retained as evidence and must not appear as an accepted projection.

## Process

1. Copy [the ADR template](./0000-adr-template.md).
2. Search the baseline and existing decisions for overlap.
3. Fill provenance, context, alternatives, consequences, evidence, impact, state, phase, and gates.
4. Obtain human approval and update the applicable baseline before marking the ADR accepted.
5. Update structured content, diagrams, pages, and coverage.
6. Run the six-condition completion checklist and all applicable review gates.

For ordinary baseline-backed changes use the templates in `docs/templates/`. For a purely implementation-level choice that does not alter approved architecture, explain why no baseline decision changes and still link the relevant source decision.

## Listening

Separating ADR identity from decision identity allows history to remain stable while a decision’s title or page route evolves. Keeping ADRs subordinate to the active baseline prevents parallel narrative authorities.
