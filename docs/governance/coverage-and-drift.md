# Coverage and Drift Governance

## Coverage objective

Coverage proves that every meaningful baseline section, subsection, and decision is classified and connected to the maintained architecture projections. “All decisions” does not mean one unreadable canvas. It means that each source item has a traceable place in one or more bounded views, a descriptive page when required, and an auditable status.

The coverage manifest is a machine-readable contract owned by the architecture content implementation. This document defines the contract; it does not create a competing copy of the manifest.

## Manifest record

Each baseline coverage entry contains at least:

| Field               | Requirement                                                                             |
| ------------------- | --------------------------------------------------------------------------------------- |
| `baselineRef`       | Repository path, stable section ID, heading path, source block/range, and source digest |
| `decisionIds`       | Related stable decision IDs; empty only for explicitly classified context material      |
| `serviceIds`        | Affected or owning stable service IDs                                                   |
| `diagramIds`        | Views where the source is represented                                                   |
| `pageRoutes`        | Descriptive pages, if the source requires a page                                        |
| `stackIds`          | Related technology/capability records                                                   |
| `status`            | `confirmed`, `confirmed_with_validation_gate`, `deferred`, or `superseded`              |
| `gateIds`           | Re-evaluation or validation gates, when applicable                                      |
| `primaryReferences` | Evidence links present in the baseline, without invented sources                        |
| `relationIds`       | Related decisions and typed relationships                                               |
| `phase`             | The architectural phase in which the record applies                                     |
| `review`            | Reviewer, review date, and unresolved notes                                             |

The manifest also records its own baseline SHA-256, byte/line/word counts, import timestamp, schema version, and previous-manifest reference. A source digest is tied to a section or block rather than only to the whole file so a small baseline change produces a useful delta.

## Required validation

Coverage validation fails when it finds any of the following:

- A decision without a descriptive page or stable identity.
- A diagram node or connection without an origin decision or baseline reference.
- A service without documented stack or ownership.
- A broken diagram, decision, service, stack, gate, or page link.
- Duplicate entries, duplicate IDs, or conflicting IDs.
- A reference to a service, decision, diagram, stack, or gate that does not exist.
- A decision gate without a related decision.
- A relevant baseline section or subsection that is not classified.
- A diagram whose phase contradicts the source record’s declared phase.
- Structured content whose source reference is missing, stale, or no longer resolves.
- A projection that contains claims absent from the baseline without an approved ADR and baseline update.

Warnings may identify an intentionally context-only section, an explicit `not documented in baseline` field, or a deferred gate, but warnings must be reviewed and cannot conceal an unresolved source change.

## Baseline synchronization and delta

Every synchronization records:

```text
baseline_path
before.sha256 / after.sha256
before.bytes / after.bytes
before.lines / after.lines
before.words / after.words
blocks.added / removed / changed
records.affected
coverage.before / after
coverage.unresolved_delta
```

If the checksum changes, the synchronizer classifies each added, removed, or changed block. A changed block marks linked records for review even when the final wording appears equivalent. Removed records are retained in history with an explicit removal/supersession reason; they are not silently deleted.

If only a projection changes, the unchanged baseline checksum is recorded and the change is classified as content, diagram layout, route, or validation maintenance. This prevents a projection correction from appearing to be a new architectural decision.

## Duplication and drift

The baseline, structured records, pages, and diagrams necessarily repeat small labels and summaries. Duplication is controlled as follows:

1. The baseline owns narrative decision text, rationale, alternatives, and gates.
2. Structured records own typed identity, relationships, status, phase, and source references.
3. Pages render records and link to the baseline; they do not restate long narrative blocks by hand.
4. Diagrams own only layout metadata and concise labels; they link to records and pages.
5. Components own no architecture claim.

Where a concise summary is duplicated for usability, the record includes a source digest and the validator checks that the source remains current. A changed source with an unchanged projection is drift, not a harmless documentation omission.

## Coverage report

The application should expose a report or internal route showing at least:

- classified and unclassified baseline sections;
- decisions by status and phase;
- decisions without pages, gates, evidence, or relations;
- services without ownership, stack, or phase;
- diagram nodes/edges without origins;
- broken and duplicate links/IDs;
- current baseline checksum and the latest delta;
- unresolved items blocking a complete architecture update.

The report is a projection of the manifest. It is not permission to publish private client content.

## Listening

The manifest is intentionally more detailed than a page index: it makes omissions and contradictory phase views detectable. The rules allow context-only baseline material but require that classification to be explicit rather than silently dropped.
