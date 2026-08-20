import {
  ArchitectureRegistrySchema,
  DecisionSchema,
  DiagramSchema,
  RelationshipIdSchema,
  RelationshipSchema,
  ServiceSchema,
  createSourceAnchor,
  type ArchitectureRegistry,
  type Decision,
  type EntityRef,
  type NarrativeText,
  type Service,
} from '../../../domain/architecture';
import type {
  ArchitectureDiagramDefinition,
  ArchitectureDiagramEdge,
  ArchitectureDiagramNode,
} from '../diagrams';

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sourceExcerpt(sourceText: string, startLine: number, endLine: number): string {
  return sourceText
    .split(/(?<=\n)/u)
    .slice(startLine - 1, endLine)
    .join('');
}

function rangesOverlap(
  left: { startLine: number; endLine: number },
  right: { startLine: number; endLine: number },
): boolean {
  return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

function relationshipId(edgeId: string): string {
  return RelationshipIdSchema.parse(
    edgeId.startsWith('relation.') ? edgeId : `relation.diagram.${edgeId}`,
  );
}

function nodeEntityRef(node: ArchitectureDiagramNode, diagramId: string): EntityRef {
  if (node.serviceId) return { kind: 'service', id: node.serviceId } as EntityRef;
  if (node.stackIds?.[0]) return { kind: 'stack', id: node.stackIds[0] } as EntityRef;
  if (node.trustBoundaryIds?.[0]) {
    return { kind: 'trust_boundary', id: node.trustBoundaryIds[0] } as EntityRef;
  }
  if (node.decisionIds[0]) return { kind: 'decision', id: node.decisionIds[0] } as EntityRef;
  return { kind: 'diagram', id: diagramId } as EntityRef;
}

function documented(items: readonly string[], note?: string): NarrativeText {
  const values = unique(items.map((item) => item.trim()).filter(Boolean));
  return values.length > 0
    ? { status: 'documented', items: values }
    : {
        status: 'not_documented',
        items: [],
        note: note ?? 'Not documented in the active baseline.',
      };
}

function decisionText(decisions: readonly Decision[], pattern?: RegExp): string[] {
  return unique(
    decisions.flatMap((decision) => {
      const items = [decision.summary, ...decision.narrative.evidence.items];
      return pattern ? items.filter((item) => pattern.test(item)) : items;
    }),
  );
}

function serviceDiagramContext(
  service: Service,
  diagrams: readonly ArchitectureDiagramDefinition[],
) {
  const appearances = diagrams.flatMap((diagram) => {
    const serviceNodes = diagram.nodes.filter((node) => node.serviceId === service.id);
    if (serviceNodes.length === 0) return [];
    const nodeIds = new Set(serviceNodes.map((node) => node.id));
    const edges = diagram.edges.filter(
      (edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target),
    );
    return [{ diagram, serviceNodes, nodeIds, edges }];
  });
  return appearances;
}

function enrichService(
  service: Service,
  registry: ArchitectureRegistry,
  diagrams: readonly ArchitectureDiagramDefinition[],
): Service {
  const appearances = serviceDiagramContext(service, diagrams);
  const linkedDecisions = registry.decisions.filter((decision) =>
    service.decisionIds.includes(decision.id),
  );
  const contracts = appearances.flatMap(({ diagram, nodeIds, edges }) =>
    edges.flatMap((edge) => {
      const isSource = nodeIds.has(edge.source);
      const counterpartId = isSource ? edge.target : edge.source;
      const counterpart = diagram.nodes.find((node) => node.id === counterpartId);
      if (!counterpart) return [];
      const kind =
        edge.type === 'sync_rest'
          ? 'rest_api'
          : edge.type === 'async_command'
            ? 'async_command'
            : edge.type === 'job'
              ? 'job'
              : edge.type === 'provider_call'
                ? 'provider'
                : undefined;
      if (!kind) return [];
      return [
        {
          name: `${edge.label} · ${counterpart.label}`,
          kind,
          direction: isSource
            ? edge.type === 'sync_rest' || edge.type === 'provider_call'
              ? ('requested' as const)
              : ('published' as const)
            : edge.type === 'sync_rest' || edge.type === 'provider_call'
              ? ('owned' as const)
              : ('consumed' as const),
          status: 'documented' as const,
          notes: documented([edge.label]),
        },
      ];
    }),
  );
  const events = appearances.flatMap(({ diagram, nodeIds, edges }) =>
    edges.flatMap((edge) => {
      if (edge.type !== 'event') return [];
      const isSource = nodeIds.has(edge.source);
      const counterpart = diagram.nodes.find((node) =>
        isSource ? node.id === edge.target : node.id === edge.source,
      );
      return [
        {
          name: `${edge.label}${counterpart ? ` · ${counterpart.label}` : ''}`,
          kind: 'async_event' as const,
          direction: isSource ? ('published' as const) : ('consumed' as const),
          status: 'documented' as const,
          notes: documented([edge.label]),
        },
      ];
    }),
  );
  const dependencies = appearances.flatMap(({ diagram, nodeIds, edges }) =>
    edges.flatMap((edge) => {
      const isSource = nodeIds.has(edge.source);
      const counterpart = diagram.nodes.find((node) =>
        isSource ? node.id === edge.target : node.id === edge.source,
      );
      if (!counterpart) return [];
      return [
        {
          target: counterpart.label,
          ...(counterpart.serviceId
            ? { targetEntity: { kind: 'service' as const, id: counterpart.serviceId } }
            : {}),
          phase: edge.phases[0] ?? service.phase,
          status: 'documented' as const,
          reason: documented([edge.label]),
        },
      ];
    }),
  );
  const dataOwned = appearances.flatMap(({ diagram, nodeIds, edges }) =>
    edges.flatMap((edge) => {
      if (edge.type !== 'data') return [];
      const counterpartId = nodeIds.has(edge.source) ? edge.target : edge.source;
      const counterpart = diagram.nodes.find((node) => node.id === counterpartId);
      return counterpart ? [`${counterpart.label}: ${counterpart.description}`] : [];
    }),
  );
  const placementEdges = appearances.flatMap(({ diagram, nodeIds, edges }) =>
    edges.flatMap((edge) => {
      const counterpartId = nodeIds.has(edge.source) ? edge.target : edge.source;
      const counterpart = diagram.nodes.find((node) => node.id === counterpartId);
      return counterpart?.kind === 'infrastructure'
        ? [{ label: counterpart.label, condition: edge.label, phases: edge.phases }]
        : [];
    }),
  );
  const roleSource = [
    service.responsibility,
    ...appearances.flatMap((item) => item.serviceNodes.map((node) => node.description)),
  ];
  const processRoles = (
    [
      ['api', /\bAPI\b|HTTP|REST/iu],
      ['worker', /\bworker\b|consumer|processing/iu],
      ['scheduler', /scheduler|scheduled|cron/iu],
      ['webhook', /webhook|inbound/iu],
      ['compiler', /compiler|compile|render/iu],
    ] as const
  ).flatMap(([role, pattern]) => {
    const responsibilities = roleSource.filter((item) => pattern.test(item));
    return responsibilities.length
      ? [{ role, status: 'documented' as const, responsibilities: unique(responsibilities) }]
      : [];
  });
  const reassessment = unique(linkedDecisions.flatMap((decision) => decision.reassessmentTriggers));
  const gateCriteria = registry.gates
    .filter((gate) => gate.decisionIds.some((id) => service.decisionIds.includes(id)))
    .map((gate) => gate.criterion);
  const securityPattern = /security|secret|credential|tenant|confidential|isolation|abuse/iu;
  const authenticationPattern = /authentication|session|token|JWKS|workload|identity/iu;
  const authorizationPattern = /authorization|permission|capabilit|RBAC|role|entitlement/iu;

  return ServiceSchema.parse({
    ...service,
    dataOwned: unique(dataOwned),
    apiContracts: uniqueBy(contracts, (item) => `${item.kind}:${item.direction}:${item.name}`),
    eventsPublished: uniqueBy(
      events.filter((item) => item.direction === 'published'),
      (item) => item.name,
    ),
    eventsConsumed: uniqueBy(
      events.filter((item) => item.direction === 'consumed'),
      (item) => item.name,
    ),
    dependencies: uniqueBy(
      dependencies,
      (item) => `${item.phase}:${item.target}:${item.reason.items[0]}`,
    ),
    processRoles,
    placement: placementEdges.length
      ? {
          status: 'documented',
          phases: unique(placementEdges.flatMap((item) => item.phases)),
          locations: unique(placementEdges.map((item) => item.label)),
          conditions: unique(placementEdges.map((item) => item.condition)),
        }
      : service.placement,
    stackMotivation: documented(
      decisionText(linkedDecisions.filter((decision) => decision.stackIds.length > 0)),
      'No service-specific stack motivation is classified in the baseline.',
    ),
    stackTradeOffs: documented(
      decisionText(linkedDecisions, /trade-off|tradeoff|cost|complex|limit|risk/iu),
    ),
    stackAlternatives: documented(
      decisionText(linkedDecisions, /alternative|fallback|instead|versus|rejected|deferred/iu),
    ),
    extractionTriggers: documented(reassessment),
    migrationTriggers: documented([...reassessment, ...gateCriteria]),
    security: documented(decisionText(linkedDecisions, securityPattern)),
    authentication: documented(decisionText(linkedDecisions, authenticationPattern)),
    authorization: documented(decisionText(linkedDecisions, authorizationPattern)),
  });
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function integrateArchitectureDiagrams(
  baseRegistry: ArchitectureRegistry,
  definitions: readonly ArchitectureDiagramDefinition[],
  sourceText: string,
  sourcePath: string,
): ArchitectureRegistry {
  const relationships = definitions.flatMap((definition) => {
    const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
    return definition.edges.map((edge: ArchitectureDiagramEdge) => {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (!source || !target) throw new Error(`diagram edge has unresolved endpoints: ${edge.id}`);
      const sourceAnchors = unique(
        edge.decisionIds.flatMap(
          (decisionId) =>
            baseRegistry.decisions.find((decision) => decision.id === decisionId)?.sourceAnchors ??
            [],
        ),
      );
      return RelationshipSchema.parse({
        id: relationshipId(edge.id),
        type: edge.type,
        phase: edge.phases[0] ?? definition.phases[0],
        source: nodeEntityRef(source, definition.id),
        target: nodeEntityRef(target, definition.id),
        diagramId: definition.id,
        visualSourceNodeId: edge.source,
        visualTargetNodeId: edge.target,
        label: edge.prohibited ? `PROHIBITED: ${edge.label}` : edge.label,
        sourceAnchors,
        decisionIds: unique(edge.decisionIds),
        confidentiality: edge.confidentialData?.length ? 'tenant_confidential' : 'internal',
        trustBoundaryId: edge.trustBoundaryId,
      });
    });
  });
  const relationshipsByDiagram = new Map<string, string[]>();
  for (const relationship of relationships) {
    if (!relationship.diagramId) continue;
    const ids = relationshipsByDiagram.get(relationship.diagramId) ?? [];
    ids.push(relationship.id);
    relationshipsByDiagram.set(relationship.diagramId, ids);
  }
  const diagrams = definitions.map((definition) =>
    DiagramSchema.parse({
      id: definition.id,
      title: definition.title,
      purpose: definition.purpose,
      phase: definition.phases[0],
      phases: definition.phases,
      pagePath: `/explorer/${definition.id}/`,
      sourceAnchors: definition.sourceRanges.map((range) =>
        createSourceAnchor({
          source: sourcePath,
          startLine: range.startLine,
          endLine: range.endLine,
          excerpt: sourceExcerpt(sourceText, range.startLine, range.endLine),
          heading: definition.title,
        }),
      ),
      decisionIds: unique([
        ...definition.decisionIds,
        ...baseRegistry.decisions
          .filter((decision) =>
            decision.sourceAnchors.some((source) =>
              definition.sourceRanges.some((range) => rangesOverlap(source.range, range)),
            ),
          )
          .map((decision) => decision.id),
        ...definition.nodes.flatMap((node) => node.decisionIds),
        ...definition.edges.flatMap((edge) => edge.decisionIds),
      ]),
      serviceIds: unique([
        ...definition.serviceIds,
        ...definition.nodes.flatMap((node) => node.serviceId ?? []),
      ]),
      relationshipIds: relationshipsByDiagram.get(definition.id) ?? [],
      trustBoundaryIds: unique([
        ...definition.trustBoundaryIds,
        ...definition.nodes.flatMap((node) => node.trustBoundaryIds ?? []),
        ...definition.edges.flatMap((edge) => edge.trustBoundaryId ?? []),
      ]),
      nodeIds: definition.nodes.map((node) => node.id),
      staticOutline: [
        ...definition.nodes.map((node) => `${node.label}: ${node.description}`),
        ...definition.edges.map((edge) => `${edge.label}: ${edge.source} to ${edge.target}`),
      ],
    }),
  );
  const diagramIdsByDecision = new Map<string, string[]>();
  const diagramIdsByService = new Map<string, string[]>();
  for (const diagram of diagrams) {
    for (const id of diagram.decisionIds) {
      diagramIdsByDecision.set(id, unique([...(diagramIdsByDecision.get(id) ?? []), diagram.id]));
    }
    for (const id of diagram.serviceIds) {
      diagramIdsByService.set(id, unique([...(diagramIdsByService.get(id) ?? []), diagram.id]));
    }
  }
  const relationshipIdsByDecision = new Map<string, string[]>();
  for (const relationship of relationships) {
    for (const id of relationship.decisionIds) {
      relationshipIdsByDecision.set(
        id,
        unique([...(relationshipIdsByDecision.get(id) ?? []), relationship.id]),
      );
    }
  }
  const decisions = baseRegistry.decisions.map((decision) =>
    DecisionSchema.parse({
      ...decision,
      diagramIds: diagramIdsByDecision.get(decision.id) ?? [],
    }),
  );
  const services = baseRegistry.services.map((service) =>
    enrichService(
      ServiceSchema.parse({
        ...service,
        diagramIds: diagramIdsByService.get(service.id) ?? [],
      }),
      { ...baseRegistry, decisions, diagrams, relationships },
      definitions,
    ),
  );
  const coverage = baseRegistry.coverage.map((record) => {
    const diagramIds = unique([
      ...record.diagramIds,
      ...record.decisionIds.flatMap((id) => diagramIdsByDecision.get(id) ?? []),
      ...record.serviceIds.flatMap((id) => diagramIdsByService.get(id) ?? []),
    ]);
    const relationshipIds = unique([
      ...record.relationshipIds,
      ...record.decisionIds.flatMap((id) => relationshipIdsByDecision.get(id) ?? []),
    ]);
    return {
      ...record,
      diagramIds,
      relationshipIds,
      pageRoutes: unique([
        '/coverage/',
        ...record.decisionIds.map((id) => `/decisions/${id}/`),
        ...record.serviceIds.map((id) => `/services/${id}/`),
        ...diagramIds.map((id) => `/explorer/${id}/`),
        ...record.stackIds.map((id) => `/stacks/${id}/`),
        ...(record.gateIds.length ? ['/gates/'] : []),
      ]),
    };
  });

  return ArchitectureRegistrySchema.parse({
    ...baseRegistry,
    decisions,
    services,
    diagrams,
    relationships,
    coverage,
  });
}
