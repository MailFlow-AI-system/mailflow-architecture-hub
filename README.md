# MailFlow Architecture Hub

The official visual and descriptive source of truth for MailFlow architecture. This repository
preserves the approved narrative baseline, projects it into typed decisions and connected diagrams,
and fails validation when those views drift.

The workspace parent is `/home/lfrca/mentoria/MailFlow`. It is only a grouping directory. The Astro
application and Git repository root is the child directory
`/home/lfrca/mentoria/MailFlow/mailflow-architecture-hub`.

## Purpose

This repository exists to:

1. Preserve every MailFlow architecture decision.
2. Make the architecture easier to understand visually.
3. Explain motivation, alternatives, evidence, and trade-offs.
4. Support study, review, challenge, and approved change.
5. Trace decisions to services, stacks, gates, diagrams, and baseline lines.
6. Detect silent divergence between approved and implemented architecture.
7. Serve as technical portfolio and study material.
8. Record evolution from the modular MVP to distributed topologies.
9. Accept baseline updates without rebuilding the application structure.
10. Make baseline, structured content, and diagram drift observable.

## Authority model

`docs/architecture/architectureBaseline.md` is the active initial narrative authority. It is not an
abandoned import. Typed catalogs under `src/data/architecture/` are maintained, testable projections
used by UI components. Components never redefine decisions, and library-specific graph types never
become canonical contracts.

The baseline parser preserves the full source, section hierarchy, block ranges, source digests, and a
stable identity map. The catalog maps every parsed section and structural block. The diagram validator
requires every node and edge to name source decisions and valid endpoints.

When the baseline changes, its checksum and block digests change before the derived catalog can be
considered current. Run the full validation and inspect `/coverage/` after every import.

## Runtime and commands

Use Bun exclusively. The repository commits `bun.lock` and does not mix npm, pnpm, or Yarn.

```bash
bun install
bun run dev
bun run check
bun run lint
bun run format:check
bun test
bun run build
bun run preview
bun run test:e2e
bun run test:a11y
bun run coverage:check
bun run validate
```

`bun run build` creates the static Astro site and Pagefind index. `bun run validate` adds type,
format, unit, integrity, production-build, route, and private-document checks. Playwright E2E and
accessibility gates run separately and in CI.

## Content architecture

- `docs/architecture/architectureBaseline.md` — active narrative authority.
- `docs/architecture/coverageManifest.json` — generated, reviewable coverage snapshot and baseline delta.
- `src/data/architecture/catalog/` — decision, service, stack, gate, trust, and coverage seeds.
- `src/data/architecture/diagrams/` — presentation-independent nodes, typed relations, and views.
- `src/domain/architecture/` — Zod schemas, stable IDs, parsing, compilation, and integrity rules.
- `docs/adr/` — ADR process and template.
- `docs/templates/` — decision and impact-review templates plus the change checklist.
- `docs/governance/` — lifecycle, drift, diagram, branch, and source-of-truth policy.
- `docs/client/` — private commercial material; never imported, copied to `public/`, or built.

The React Flow renderer is an isolated Astro island. Static descriptive outlines and all entity pages
remain useful without JavaScript.

## Add a decision

1. Start with `docs/templates/decision-addition.md` and an impact review.
2. Obtain human approval for material architecture changes.
3. Update the applicable narrative in the active baseline.
4. Add a stable `decision.<area>.<choice>` seed with exact line anchors, phase, status, and references.
5. Link affected services, stacks, gates, trust boundaries, and related decisions.
6. Update affected data-driven diagram views; never put decision prose in a visual component.
7. Add an ADR for a material choice and complete the architecture change checklist.
8. Run all validation and review the coverage delta.

## Change or supersede a decision

Use `docs/templates/decision-change.md` for a compatible change. Preserve the stable ID when the
decision identity is unchanged. Use `docs/templates/decision-supersession.md` for replacement: mark
the old decision `superseded`, point `supersededByDecisionId` to the approved replacement, and retain
both records for history. Rejected alternatives and fallbacks are not automatically superseded
decisions.

No conditional gate, spike result, dependency upgrade, or provider change may silently alter service
ownership, tenancy, trust boundaries, lifecycle semantics, or the accepted evolution path.

## Update diagrams

Edit the relevant definition in `src/data/architecture/diagrams/`. Reuse canonical service, stack,
decision, and trust-boundary IDs. Every node and edge requires at least one source decision, explicit
phases, and a typed relationship. Prohibited flows must be marked rather than implied. Run the diagram
integrity test, inspect the static outline, then test pan/zoom, filters, URL deep links, keyboard use,
reduced motion, desktop, and mobile layouts.

## Create an ADR

Copy `docs/adr/0000-adr-template.md`, assign the next stable number, and record context, decision,
alternatives, consequences, evidence, status, affected IDs, and baseline anchors. ADRs explain
material reasoning; they do not replace the baseline or structured projection.

## Coverage and drift audit

```bash
bun test tests/architecture/catalog-integrity.test.ts
bun test tests/architecture/diagram-integrity.test.ts
bun run diagram-sources:check
bun run coverage:check
bun run build
bun run validate:routes
bun run validate:privacy
```

The audit detects unclassified baseline content, duplicate/conflicting IDs, missing pages, dangling
service/stack/gate/trust references, undocumented service stacks, unlinked gates, stale diagram
anchors, missing edge endpoints, phase contradictions, broken routes, and accidental publication of
private client material. Context-only source material is explicitly `not_applicable`, never silently
treated as a decision. Coverage records begin as `machine_classified`; human review must be marked
explicitly and is never inferred from a green build. Each manifest record includes its repository
path, heading path, exact range, digest, entity links, routes, and review state.

After an approved baseline update, update its recorded fingerprint, review every affected diagram,
then run `bun run diagram-sources:update` and `bun run coverage:update`. Changed and added source
records are reset to a required machine-review state. Record the reviewer and date, rerun
`bun run coverage:update`, and commit the regenerated manifests only after the change checklist is
complete. CI fails on unresolved baseline deltas or drift in the checked-in manifest, baseline
checksum, persisted diagram provenance, structured catalog, diagrams, or page routes.

An architecture change is complete only when the applicable baseline, descriptive content, affected
diagrams, related decisions, ADR/changelog, and coverage tests are all updated.

## Static Vercel publication

The application uses Astro's static output. No `@astrojs/vercel` adapter is installed because the
confirmed feature set needs no on-demand rendering, Server Islands, server Actions, Sessions, or
Vercel middleware. In Vercel, import this child repository, select Bun, use `bun run build`, and publish
`dist/`. Run `bun run validate` before publishing.

Deployment and remote Vercel project creation are intentionally outside this delivery. The owner
performs the manual deployment after reviewing the validated output.

## Git conventions

- Use `codex/<topic>` or another agreed focused branch from `main`.
- Write code, filenames, documentation, and commits in English.
- Prefer one focused commit per task.
- Do not combine content extraction, infrastructure, and unrelated refactors in one commit.
- Pass the relevant wave gate before integration.

## Private client documents

Commercial documents are private and outside the public application. The approved `.docx` will be
created separately and later stored under `docs/client/`. It must not be imported by Astro, copied to
`public/`, included in `dist/`, or linked from a public page.

## Listening

The design keeps one active narrative authority and generates navigable projections around it. A
A single giant diagram as the only representation was rejected because it obscures phases and ownership. The complete canvas is a derived navigation layer; focused diagrams remain the legible views for detailed analysis. Duplicated decision prose
inside UI components was rejected because it creates undetectable drift. Static Astro output with
localized React hydration was selected because it keeps descriptive content durable while providing a
focused interactive explorer. A Vercel adapter and ELK runtime dependency remain unnecessary until a
confirmed feature or measured layout problem justifies them.
