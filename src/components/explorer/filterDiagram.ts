import type { ArchitecturePhase, RelationType } from '../../domain/architecture';
import type { ArchitectureDiagramDefinition } from '../../data/architecture/diagrams';

export type DiagramFilters = {
  phase?: ArchitecturePhase;
  relationTypes: RelationType[];
  serviceId?: string;
  query: string;
};

export function filterDiagram(
  diagram: ArchitectureDiagramDefinition,
  filters: DiagramFilters,
): Pick<ArchitectureDiagramDefinition, 'nodes' | 'edges'> {
  const phaseNodes = diagram.nodes.filter(
    (node) => !filters.phase || node.phases.includes(filters.phase),
  );
  const phaseNodeIds = new Set(phaseNodes.map((node) => node.id));
  let edges = diagram.edges.filter(
    (edge) =>
      (!filters.phase || edge.phases.includes(filters.phase)) &&
      (filters.relationTypes.length === 0 || filters.relationTypes.includes(edge.type)) &&
      phaseNodeIds.has(edge.source) &&
      phaseNodeIds.has(edge.target),
  );

  let selectedIds = new Set(phaseNodeIds);
  if (filters.serviceId) {
    const serviceIds = new Set(
      phaseNodes.filter((node) => node.serviceId === filters.serviceId).map((node) => node.id),
    );
    edges = edges.filter((edge) => serviceIds.has(edge.source) || serviceIds.has(edge.target));
    selectedIds = new Set([...serviceIds, ...edges.flatMap((edge) => [edge.source, edge.target])]);
  }

  const query = filters.query.trim().toLocaleLowerCase('en');
  if (query) {
    const queryIds = new Set(
      phaseNodes
        .filter((node) =>
          [node.id, node.label, node.description, node.serviceId ?? ''].some((value) =>
            value.toLocaleLowerCase('en').includes(query),
          ),
        )
        .map((node) => node.id),
    );
    edges = edges.filter((edge) => queryIds.has(edge.source) || queryIds.has(edge.target));
    const expandedQueryIds = new Set([
      ...queryIds,
      ...edges.flatMap((edge) => [edge.source, edge.target]),
    ]);
    selectedIds = new Set([...selectedIds].filter((id) => expandedQueryIds.has(id)));
  }

  return {
    nodes: phaseNodes.filter((node) => selectedIds.has(node.id)),
    edges: edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)),
  };
}
