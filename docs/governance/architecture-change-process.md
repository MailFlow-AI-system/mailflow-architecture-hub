# Architecture Change Process

## Scope

This process applies when an approved product, service, stack, infrastructure, security, communication, tenancy, lifecycle, or operational decision changes. It also applies when an implementation spike activates a documented fallback or changes the evidence attached to a conditional decision.

The process preserves the authority model in [Source-of-Truth Governance](./source-of-truth.md). It does not authorize an agent to alter approved architecture without human approval.

## Change lifecycle

### Add a decision

1. Start from [the decision-addition template](../templates/decision-addition.md).
2. Search the baseline and existing IDs for an existing decision or overlapping scope.
3. Record the problem, selected option, rejected alternatives, evidence, trade-offs, affected entities, state, phase, and explicit baseline references.
4. Obtain human approval for the baseline change. A new record with no approved baseline source remains `draft`.
5. Add or update the ADR, structured projection, diagrams, pages, and coverage manifest.
6. Run every applicable review gate and the six-condition completion checklist.

### Change a decision

Use [the decision-change template](../templates/decision-change.md). Preserve the stable decision ID when the meaning remains the same. Record the old and new baseline references, the reason, impact review, changed gates, affected projections, and evidence. If the meaning, authority, or contract changes materially, create a new decision and supersede the old one instead of rewriting history.

### Supersede a decision

Use [the decision-supersession template](../templates/decision-supersession.md). Create the successor record first, link `supersedes` and `superseded_by`, preserve the predecessor page and ADR, and state the effective phase. A superseded decision remains queryable and must not be removed from coverage history. Do not use supersession to hide an undocumented change.

## Required six-condition completion checklist

A change is complete only when all six conditions below are true:

1. The applicable baseline is updated.
2. The descriptive content is updated.
3. The affected diagrams are updated.
4. The related decisions are updated.
5. The applicable ADR or changelog is updated.
6. The coverage tests are passing.

These are the exact completion conditions. Review evidence may contain additional checks, but additional checks do not replace, merge, or renumber these six conditions.

## Review gates

The orchestrator or maintainer records a pass/fail decision for each applicable gate:

1. **Authority gate:** baseline references are precise; human approval exists for an architectural change; no component or diagram invents a decision.
2. **Identity gate:** stable IDs are unique, relations are typed, and renamed/split/merged records preserve history.
3. **Impact gate:** services, stacks, phases, data boundaries, trust boundaries, contracts, gates, pages, and diagrams are listed and reviewed.
4. **Projection gate:** structured content and diagrams consume canonical records and all changed links resolve.
5. **Coverage gate:** the manifest has no unclassified changed baseline block, missing decision page, orphan node/edge, unknown service, duplicate entry, or unlinked gate.
6. **Privacy and security gate:** no `docs/client/` content, customer data, secrets, or unsupported access path enters public content or build output.
7. **Validation gate:** relevant type, lint, format, unit, integrity, route/link, accessibility, responsive, interaction, build, and E2E checks pass.
8. **Integration gate:** the branch is reviewable, the commit is focused and in English, and unrelated infrastructure/refactor/content changes are excluded.

## Impact review

Complete [the impact-review template](../templates/impact-review.md) before changing a confirmed decision. The review must explicitly identify what remains unchanged. “No impact” requires evidence, not omission.

## Baseline sync and coverage delta

Before editing a baseline-backed record, run the repository’s checksum/import command or its documented equivalent and retain the output in the change review. At minimum record:

```text
path
sha256_before / sha256_after
bytes_before / bytes_after
lines_before / lines_after
words_before / words_after
diff_blocks_added / removed / changed
coverage_before / coverage_after / unresolved_delta
```

If the baseline did not change, record the unchanged checksum and explain why the change is a projection, evidence, or presentation correction. If it did change, the coverage delta must be visible and all affected records must be reviewed. Never overwrite the baseline during an import without a recoverable diff and human approval.

## Diagram update rule

Update diagrams only through their typed node and relationship records. Each node and edge must have a stable ID, an origin decision or baseline reference, an applicable phase, and links to descriptive pages. A visual layout adjustment that does not change architecture still records its source records and passes link/accessibility checks. See [Diagram Governance](./diagram-governance.md).

## Branches and commits

Use `main` as the integration branch and `codex/<scope>-<slug>` for focused work branches. Commits and commit bodies are in English. Prefer one focused commit per coherent task. Do not mix architecture content, infrastructure, dependency upgrades, and unrelated refactors in one commit. Review gates run before integration; a failing gate blocks merge rather than being waived silently.

## Client-document boundary

The commercial `.docx` is created in a separate task. Do not create it here, import it, render it, copy it to `public/`, or allow it into `dist/`. `docs/client/` remains private and is excluded from architecture content and public validation targets.

## Listening

The process separates authority changes from projection work so a polished diagram cannot make an unapproved decision appear real. The six conditions are intentionally short and auditable; the review gates provide the deeper evidence without changing the completion contract.
