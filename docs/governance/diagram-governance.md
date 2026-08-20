# Diagram Governance

## Role of diagrams

Diagrams accelerate understanding of MailFlow’s context, services, communication, data, trust, infrastructure, and evolution. They are bounded projections of canonical architecture records. They never replace the baseline or descriptive decision pages.

Use multiple connected views, phases, filters, layers, drill-down, and deep links instead of one giant canvas. At minimum, the maintained views must be able to represent the MVP, first distributed topology, future topology, bounded contexts, data/tenancy, authentication/trust, durable messaging, provider ownership, lifecycle, infrastructure, and decision gates described by the baseline.

## Canonical diagram model

Each diagram model contains:

- a stable `diagramId`, title, purpose, phase, and source references;
- typed nodes with stable `nodeId`, entity kind, label, ownership, phase, page route, and related decisions;
- typed edges with stable `relationId`, source/target node IDs, communication kind, direction, phase, source decision/baseline references, and related page/gate;
- trust-boundary and layer metadata;
- legend and accessibility labels;
- optional layout coordinates that are not architecture meaning.

The visual library is an adapter behind project-owned types. Library-specific node or edge types must not become the canonical architecture contract. Components may calculate layout and interaction state, but they cannot redefine ownership, data access, communication, or decision status.

## Relationship provenance

Every relationship identifies why it exists. Use the narrowest source reference available:

- baseline section/block for a narrative relationship;
- decision ID for an approved decision;
- service/contract record for a versioned interface;
- explicit gate ID for a conditional or future relation.

An edge with no provenance is invalid. A relationship shown only for illustration is labeled as such and is not presented as an approved architecture fact.

## Communication vocabulary

Render communication semantics distinctly and consistently:

- synchronous REST/API calls;
- durable commands;
- events/facts;
- jobs and scheduled work;
- data ownership or bulk reads;
- authentication and authorization paths;
- provider calls;
- infrastructure/network relationships.

The legend must not rely on color alone. Use line style, arrow shape, labels, patterns, or accessible text. The distributed authentication view must distinguish workload tokens, delegated assertions, JWKS validation, local authorization, and durable RabbitMQ credentials; it must not imply that a cached public key is a cached authorization decision.

## Phases and trust boundaries

Every node and edge declares the phase it belongs to. The application must provide at least separate MVP, first extraction/distributed, and future modes where the baseline requires different topology. A future-only relationship must not appear in an MVP view without an explicit phase marker.

Trust boundaries are first-class records. Show where private keys, browser sessions, delegated assertions, workload tokens, provider credentials, tenant data, and external providers are allowed to cross. Do not put confidential payloads into diagrams or fixture data.

## Update procedure

1. Start with the impact review and identify affected diagram IDs.
2. Update the underlying decision/service/relation records first.
3. Add, remove, or change diagram nodes and edges only through those records.
4. Preserve deep links and stable IDs; if a node is split or merged, retain a migration map.
5. Update phase, trust-boundary, legend, page, and decision links.
6. Run referential-integrity, coverage, interaction, keyboard, reduced-motion, responsive, and accessibility checks.
7. Review the rendered view at desktop and small viewport sizes for readability and empty/error states.

A layout-only adjustment still runs link and accessibility checks. A semantic change additionally requires the six-condition completion checklist in [the change process](./architecture-change-process.md).

## Drift checks

Validation must detect:

- unknown nodes or targets;
- duplicate node or relation IDs;
- edges without decision/baseline origin;
- services without pages, stacks, ownership, or phases;
- links to missing decision/service/diagram routes;
- contradictory phase declarations;
- visual records whose source digest is stale;
- diagrams that expose `docs/client/` or confidential values;
- filter/deep-link state that selects an entity not present in the active phase.

## Listening

The model separates meaning from layout so the diagram library can change without changing the architecture contract. Provenance and phase metadata make a visual contradiction detectable instead of leaving it to reviewer memory.
