# Architecture Change Checklist

Copy this checklist into the change review. It is an execution checklist; the normative lifecycle is in [Architecture Change Process](../governance/architecture-change-process.md).

## Before editing

- [ ] Confirm this is an architecture change, projection correction, layout-only change, or validation-only change.
- [ ] Search for existing decision, service, stack, diagram, gate, relation, and baseline IDs.
- [ ] Read the affected baseline sections in full.
- [ ] Record baseline path, checksum, size, line/word counts, section/block references, and source digests.
- [ ] Confirm human approval is required or document why the approved baseline remains unchanged.
- [ ] Create a focused `codex/<scope>-<slug>` branch.
- [ ] Complete the impact review.

## During editing

- [ ] Use the existing stable ID when meaning is unchanged.
- [ ] Create a successor and explicit links when the decision is superseded.
- [ ] Keep baseline narrative authority active.
- [ ] Keep architecture claims out of visual components.
- [ ] Update structured records before pages or diagrams.
- [ ] Give every node and edge a decision or baseline origin.
- [ ] Declare phase, ownership, stack, contracts, gates, and affected routes.
- [ ] Keep `docs/client/` private and outside content imports, `public/`, and `dist/`.
- [ ] Do not invent missing baseline facts, timelines, stacks, customer details, or requirements.

## Required six-condition completion gate

- [ ] The applicable baseline is updated.
- [ ] The descriptive content is updated.
- [ ] The affected diagrams are updated.
- [ ] The related decisions are updated.
- [ ] The applicable ADR or changelog is updated.
- [ ] The coverage tests are passing.

## Validation and integration

- [ ] Baseline checksum/diff and coverage delta are attached.
- [ ] Referential-integrity and duplicate-ID checks pass.
- [ ] Coverage has no unclassified changed sections or orphan projections.
- [ ] Relevant typecheck, lint, format, unit, link/route, accessibility, responsive, interaction, build, and E2E checks pass.
- [ ] `docs/client/` does not appear in `dist/`.
- [ ] The review gates are recorded as pass/fail.
- [ ] Commits are focused and written in English.
- [ ] Unrelated infrastructure, dependency, and refactor changes are excluded.
- [ ] No deployment or remote Vercel project was created unless separately authorized.

## Listening

<Record the material decision, selected/rejected alternatives, and follow-up risk.>
