import type {
  ArchitectureDiagramDefinition,
  ArchitectureDiagramEdge,
  ArchitectureDiagramNode,
} from './types';

const phaseOrder = ['mvp', 'first_distributed', 'future'] as const;

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sortPhases(phases: readonly ArchitectureDiagramNode['phases'][number][]) {
  return unique(phases).sort((left, right) => phaseOrder.indexOf(left) - phaseOrder.indexOf(right));
}

function sourceRelationshipId(edgeId: string): string {
  return edgeId.startsWith('relation.') ? edgeId : `relation.diagram.${edgeId}`;
}

function nodeKey(node: ArchitectureDiagramNode): string {
  return node.serviceId ?? node.id;
}

function mergeNode(
  current: ArchitectureDiagramNode,
  incoming: ArchitectureDiagramNode,
  diagramId: string,
): ArchitectureDiagramNode {
  return {
    ...current,
    phases: sortPhases([...current.phases, ...incoming.phases]),
    description: unique([current.description, incoming.description]).join(' '),
    decisionIds: unique([...current.decisionIds, ...incoming.decisionIds]),
    stackIds: unique([...(current.stackIds ?? []), ...(incoming.stackIds ?? [])]),
    trustBoundaryIds: unique([
      ...(current.trustBoundaryIds ?? []),
      ...(incoming.trustBoundaryIds ?? []),
    ]),
    sourceDiagramIds: unique([...(current.sourceDiagramIds ?? []), diagramId]),
    sourceNodeIds: unique([...(current.sourceNodeIds ?? []), incoming.id]),
  };
}

function edgeKey(edge: ArchitectureDiagramEdge, source: string, target: string): string {
  return [source, target, edge.type, edge.label, edge.prohibited ? 'prohibited' : 'allowed'].join(
    '|',
  );
}

function mergeEdge(
  current: ArchitectureDiagramEdge,
  incoming: ArchitectureDiagramEdge,
  diagramId: string,
  source: string,
  target: string,
): ArchitectureDiagramEdge {
  return {
    ...current,
    source,
    target,
    phases: sortPhases([...current.phases, ...incoming.phases]),
    decisionIds: unique([...current.decisionIds, ...incoming.decisionIds]),
    confidentialData: unique([
      ...(current.confidentialData ?? []),
      ...(incoming.confidentialData ?? []),
    ]),
    sourceDiagramIds: unique([...(current.sourceDiagramIds ?? []), diagramId]),
    sourceEdgeIds: unique([...(current.sourceEdgeIds ?? []), incoming.id]),
    relationshipIds: unique([
      ...(current.relationshipIds ?? []),
      sourceRelationshipId(incoming.id),
    ]),
  };
}

/**
 * Build the navigable whole-system projection from focused canonical views.
 *
 * Focused diagrams remain the source of truth. This function only normalizes
 * repeated service nodes and equivalent typed relationships for one canvas,
 * while retaining the focused view and source relationship IDs as provenance.
 */
export function composeWholeArchitecture(
  definitions: readonly ArchitectureDiagramDefinition[],
): ArchitectureDiagramDefinition {
  const nodesByKey = new Map<string, ArchitectureDiagramNode>();
  const nodeIdsBySourceId = new Map<string, string>();
  const edgesByKey = new Map<string, ArchitectureDiagramEdge>();

  for (const definition of definitions) {
    for (const node of definition.nodes) {
      const key = nodeKey(node);
      const current = nodesByKey.get(key);
      if (current) {
        nodesByKey.set(key, mergeNode(current, node, definition.id));
        nodeIdsBySourceId.set(`${definition.id}:${node.id}`, current.id);
      } else {
        nodesByKey.set(key, {
          ...node,
          phases: sortPhases(node.phases),
          sourceDiagramIds: [definition.id],
          sourceNodeIds: [node.id],
          stackIds: node.stackIds ? [...node.stackIds] : undefined,
          trustBoundaryIds: node.trustBoundaryIds ? [...node.trustBoundaryIds] : undefined,
        });
        nodeIdsBySourceId.set(`${definition.id}:${node.id}`, node.id);
      }
    }
  }

  for (const definition of definitions) {
    for (const edge of definition.edges) {
      const source = nodeIdsBySourceId.get(`${definition.id}:${edge.source}`);
      const target = nodeIdsBySourceId.get(`${definition.id}:${edge.target}`);
      if (!source || !target) {
        throw new Error(
          `whole architecture edge has unresolved endpoint: ${definition.id}/${edge.id}`,
        );
      }
      const key = edgeKey(edge, source, target);
      const current = edgesByKey.get(key);
      if (current) {
        edgesByKey.set(key, mergeEdge(current, edge, definition.id, source, target));
      } else {
        edgesByKey.set(key, {
          ...edge,
          source,
          target,
          phases: sortPhases(edge.phases),
          sourceDiagramIds: [definition.id],
          sourceEdgeIds: [edge.id],
          relationshipIds: [sourceRelationshipId(edge.id)],
          decisionIds: [...edge.decisionIds],
          confidentialData: edge.confidentialData ? [...edge.confidentialData] : undefined,
        });
      }
    }
  }

  const nodes = [...nodesByKey.values()];
  const edges = [...edgesByKey.values()];
  return {
    id: 'diagram.architecture.whole',
    title: 'MailFlow complete architecture',
    purpose:
      'Explore every canonical service, boundary, data store, provider, and typed relationship in one pannable architecture canvas.',
    phases: [...phaseOrder],
    sourceRanges: unique(
      definitions.flatMap((definition) =>
        definition.sourceRanges.map((range) => `${range.startLine}:${range.endLine}`),
      ),
    ).map((range) => {
      const [startLine, endLine] = range.split(':').map(Number);
      return { startLine, endLine };
    }),
    decisionIds: unique(definitions.flatMap((definition) => definition.decisionIds)),
    serviceIds: unique(definitions.flatMap((definition) => definition.serviceIds)),
    trustBoundaryIds: unique(definitions.flatMap((definition) => definition.trustBoundaryIds)),
    nodes,
    edges,
  };
}
