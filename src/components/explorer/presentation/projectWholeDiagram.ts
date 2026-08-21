import type {
  ArchitectureDiagramEdge,
  ArchitectureDiagramNode,
} from '../../../data/architecture/diagrams';
import type { ArchitecturePhase, RelationType } from '../../../domain/architecture';
import { architectureDomains, classifyArchitectureNodes } from './wholeArchitectureTaxonomy';
import type { ArchitectureDomain, ArchitectureLayer } from './types';

const phaseOrder: readonly ArchitecturePhase[] = ['mvp', 'first_distributed', 'future'];

const domainLayers = {
  'actors-channels': 'actors',
  'edge-security': 'edge-security',
  'identity-tenancy': 'product',
  'mail-delivery': 'product',
  'audience-campaign': 'product',
  'content-workflow': 'product',
  'automation-runtime': 'orchestration',
  'analytics-ai': 'product',
  billing: 'product',
  'data-messaging': 'data-platform',
  'platform-operations': 'data-platform',
  'external-providers': 'providers',
} satisfies Record<ArchitectureDomain, ArchitectureLayer>;

type DiagramSubset = Pick<
  import('../../../data/architecture/diagrams').ArchitectureDiagramDefinition,
  'nodes' | 'edges'
>;

export type WholeDomainProjectionNode = {
  id: string;
  kind: 'domain';
  label: string;
  domain: ArchitectureDomain;
  layer: ArchitectureLayer;
  expanded: boolean;
  canonicalNodeIds: string[];
  canonicalNodeCount: number;
  nodeCount: number;
  internalEdgeCount: number;
  externalEdgeCount: number;
  phases: ArchitecturePhase[];
  phaseNodeCounts: Record<ArchitecturePhase, number>;
};

export type WholeEntityProjectionNode = {
  id: string;
  kind: 'entity';
  label: string;
  domain: ArchitectureDomain;
  layer: ArchitectureLayer;
  canonicalNodeId: string;
  node: ArchitectureDiagramNode;
  phases: ArchitecturePhase[];
};

export type WholeProjectionNode = WholeDomainProjectionNode | WholeEntityProjectionNode;

export type WholeProjectionEdge = {
  id: string;
  kind: 'boundary' | 'canonical';
  source: string;
  target: string;
  label: string;
  type: RelationType;
  relationType: RelationType;
  prohibited: boolean;
  count: number;
  canonicalEdgeIds: string[];
  sourceEdgeIds?: string[];
  sourceDiagramIds?: string[];
  relationshipIds?: string[];
  phases: ArchitecturePhase[];
};

export type WholeDiagramProjection = {
  nodes: WholeProjectionNode[];
  edges: WholeProjectionEdge[];
  expandedDomain?: ArchitectureDomain;
};

export type ProjectWholeDiagramOptions = {
  expandedDomain?: ArchitectureDomain;
};

type ClassifiedNode = {
  node: ArchitectureDiagramNode;
  domain: ArchitectureDomain;
  layer: ArchitectureLayer;
};

type DomainAccumulator = {
  domain: ArchitectureDomain;
  layer: ArchitectureLayer;
  nodes: ClassifiedNode[];
  internalEdges: ArchitectureDiagramEdge[];
  externalEdges: ArchitectureDiagramEdge[];
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sortedPhases(values: readonly ArchitecturePhase[]): ArchitecturePhase[] {
  return [...new Set(values)].sort(
    (left, right) => phaseOrder.indexOf(left) - phaseOrder.indexOf(right),
  );
}

function emptyPhaseCounts(): Record<ArchitecturePhase, number> {
  return { mvp: 0, first_distributed: 0, future: 0 };
}

function domainNodeId(domain: ArchitectureDomain): string {
  return `domain.${domain}`;
}

function classifyNodes(subset: DiagramSubset): Map<string, ClassifiedNode> {
  const classified = classifyArchitectureNodes(
    [...subset.nodes].sort((left, right) => left.id.localeCompare(right.id)),
  );
  return new Map(
    classified.map(({ node, classification }) => [
      node.id,
      { node, domain: classification.domain, layer: classification.layer },
    ]),
  );
}

function createDomainAccumulators(
  classifiedNodes: Map<string, ClassifiedNode>,
): Map<ArchitectureDomain, DomainAccumulator> {
  const result = new Map<ArchitectureDomain, DomainAccumulator>();
  for (const classified of classifiedNodes.values()) {
    const current = result.get(classified.domain);
    if (current) {
      current.nodes.push(classified);
      continue;
    }
    result.set(classified.domain, {
      domain: classified.domain,
      layer: classified.layer,
      nodes: [classified],
      internalEdges: [],
      externalEdges: [],
    });
  }
  return result;
}

function phaseNodeCounts(nodes: readonly ClassifiedNode[]): Record<ArchitecturePhase, number> {
  const counts = emptyPhaseCounts();
  for (const { node } of nodes) {
    for (const phase of node.phases) counts[phase] += 1;
  }
  return counts;
}

function edgePhases(edges: readonly ArchitectureDiagramEdge[]): ArchitecturePhase[] {
  return sortedPhases(edges.flatMap((edge) => edge.phases));
}

function sourceProvenance<T extends ArchitectureDiagramEdge>(edges: readonly T[]) {
  const sourceEdgeIds = uniqueSorted(edges.flatMap((edge) => edge.sourceEdgeIds ?? []));
  const sourceDiagramIds = uniqueSorted(edges.flatMap((edge) => edge.sourceDiagramIds ?? []));
  const relationshipIds = uniqueSorted(edges.flatMap((edge) => edge.relationshipIds ?? []));
  return {
    ...(sourceEdgeIds.length ? { sourceEdgeIds } : {}),
    ...(sourceDiagramIds.length ? { sourceDiagramIds } : {}),
    ...(relationshipIds.length ? { relationshipIds } : {}),
  };
}

function edgeAggregationKey(
  sourceDomain: ArchitectureDomain,
  targetDomain: ArchitectureDomain,
  edge: ArchitectureDiagramEdge,
): string {
  return [sourceDomain, targetDomain, edge.type, edge.prohibited ? 'prohibited' : 'allowed'].join(
    '|',
  );
}

function boundaryEdgeId(
  sourceDomain: ArchitectureDomain,
  targetDomain: ArchitectureDomain,
  edge: ArchitectureDiagramEdge,
): string {
  return `edge.boundary.${sourceDomain}.${targetDomain}.${edge.type}.${edge.prohibited ? 'prohibited' : 'allowed'}`;
}

function aggregateBoundaryEdges(
  edges: readonly ArchitectureDiagramEdge[],
  classifiedNodes: Map<string, ClassifiedNode>,
): WholeProjectionEdge[] {
  const groups = new Map<string, ArchitectureDiagramEdge[]>();
  for (const edge of [...edges].sort((left, right) => left.id.localeCompare(right.id))) {
    const source = classifiedNodes.get(edge.source);
    const target = classifiedNodes.get(edge.target);
    if (!source || !target || source.domain === target.domain) continue;
    const key = edgeAggregationKey(source.domain, target.domain, edge);
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const [sourceDomain, targetDomain] = key.split('|') as [
        ArchitectureDomain,
        ArchitectureDomain,
      ];
      const first = group[0];
      return {
        id: boundaryEdgeId(sourceDomain, targetDomain, first),
        kind: 'boundary' as const,
        source: domainNodeId(sourceDomain),
        target: domainNodeId(targetDomain),
        label: first.label,
        type: first.type,
        relationType: first.type,
        prohibited: Boolean(first.prohibited),
        count: group.length,
        canonicalEdgeIds: uniqueSorted(group.map((edge) => edge.id)),
        ...sourceProvenance(group),
        phases: edgePhases(group),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function canonicalEdge(edge: ArchitectureDiagramEdge): WholeProjectionEdge {
  return {
    id: edge.id,
    kind: 'canonical',
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: edge.type,
    relationType: edge.type,
    prohibited: Boolean(edge.prohibited),
    count: 1,
    canonicalEdgeIds: [edge.id],
    ...sourceProvenance([edge]),
    phases: sortedPhases(edge.phases),
  };
}

export function projectWholeDiagram(
  subset: DiagramSubset,
  options: ProjectWholeDiagramOptions = {},
): WholeDiagramProjection {
  const classifiedNodes = classifyNodes(subset);
  const domains = createDomainAccumulators(classifiedNodes);
  const sortedEdges = [...subset.edges].sort((left, right) => left.id.localeCompare(right.id));

  for (const edge of sortedEdges) {
    const source = classifiedNodes.get(edge.source);
    const target = classifiedNodes.get(edge.target);
    if (!source || !target) {
      throw new Error(`whole presentation edge has unresolved endpoint: ${edge.id}`);
    }
    const sourceDomain = domains.get(source.domain);
    const targetDomain = domains.get(target.domain);
    if (!sourceDomain || !targetDomain) {
      throw new Error(`whole presentation edge has unresolved domain: ${edge.id}`);
    }
    if (source.domain === target.domain) sourceDomain.internalEdges.push(edge);
    else {
      sourceDomain.externalEdges.push(edge);
      targetDomain.externalEdges.push(edge);
    }
  }

  const expandedDomain = options.expandedDomain;
  const nodes: WholeProjectionNode[] = [];
  for (const domain of architectureDomains) {
    const accumulator = domains.get(domain);
    if (!accumulator) continue;
    const nodeIds = uniqueSorted(accumulator.nodes.map(({ node }) => node.id));
    const phases = sortedPhases(accumulator.nodes.flatMap(({ node }) => node.phases));
    nodes.push({
      id: domainNodeId(domain),
      kind: 'domain',
      label: domain,
      domain,
      layer: domainLayers[domain],
      expanded: domain === expandedDomain,
      canonicalNodeIds: nodeIds,
      canonicalNodeCount: nodeIds.length,
      nodeCount: nodeIds.length,
      internalEdgeCount: accumulator.internalEdges.length,
      externalEdgeCount: accumulator.externalEdges.length,
      phases,
      phaseNodeCounts: phaseNodeCounts(accumulator.nodes),
    });
    if (domain === expandedDomain) {
      nodes.push(
        ...accumulator.nodes
          .sort((left, right) => left.node.id.localeCompare(right.node.id))
          .map(({ node, layer }) => ({
            id: node.id,
            kind: 'entity' as const,
            label: node.label,
            domain,
            layer,
            canonicalNodeId: node.id,
            node,
            phases: sortedPhases(node.phases),
          })),
      );
    }
  }

  const internalEdges = expandedDomain
    ? (domains.get(expandedDomain)?.internalEdges ?? []).map(canonicalEdge)
    : [];
  const boundaryEdges = aggregateBoundaryEdges(sortedEdges, classifiedNodes);
  return {
    nodes,
    edges: [...boundaryEdges, ...internalEdges].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    ...(expandedDomain ? { expandedDomain } : {}),
  };
}
