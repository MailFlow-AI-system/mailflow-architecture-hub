# Branch and Commit Policy

## Branches

- `main` is the protected integration branch.
- Use `codex/<scope>-<slug>` for focused implementation, documentation, validation, or spike work.
- Keep a branch limited to one coherent architectural outcome and its required tests or records.
- Do not use the parent workspace `/home/lfrca/mentoria/MailFlow` as a repository or branch root; the repository root is this project subdirectory.

## Commits

- Commit subjects and bodies are written in English.
- Prefer one focused commit per task when the change is reviewable as a unit.
- Keep architecture content, infrastructure/configuration, dependency upgrades, generated output, and unrelated refactors in separate commits.
- Do not commit `docs/client/` material, secrets, customer data, or build output.
- Do not commit generated `dist/`, coverage, or machine-local artifacts unless a project rule explicitly requires them.

## Gates before integration

The author attaches the relevant validation evidence to the review. The integration maintainer verifies the authority, impact, projection, coverage, privacy/security, validation, and integration gates in [the architecture change process](./architecture-change-process.md). A failed gate blocks integration; it is not converted into an untracked follow-up.

## Listening

The policy keeps the history explainable: a reviewer can identify the architectural decision, its evidence, and its validation without disentangling unrelated repository maintenance.
