import type { ArchitectureDiagramDefinition } from '../../../data/architecture/diagrams';

export type FocusedDiagramProjection = Pick<ArchitectureDiagramDefinition, 'nodes' | 'edges'>;

/**
 * Keep dedicated diagrams flat. This adapter gives the renderer a stable,
 * presentation-owned value without introducing domain clustering.
 */
export function projectFocusedDiagram(
  subset: Pick<ArchitectureDiagramDefinition, 'nodes' | 'edges'>,
): FocusedDiagramProjection {
  return {
    nodes: [...subset.nodes].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...subset.edges].sort((left, right) => left.id.localeCompare(right.id)),
  };
}
