import type { ArchitecturePhase, RelationType } from '../../../domain/architecture';

export type DiagramNodeKind =
  | 'actor'
  | 'service'
  | 'module'
  | 'data_store'
  | 'queue'
  | 'provider'
  | 'infrastructure'
  | 'security_boundary';

export type ArchitectureDiagramNode = {
  id: string;
  label: string;
  kind: DiagramNodeKind;
  phases: ArchitecturePhase[];
  description: string;
  serviceId?: string;
  stackIds?: string[];
  decisionIds: string[];
  trustBoundaryIds?: string[];
  group?: string;
  /** Focused views where this canonical node appears. */
  sourceDiagramIds?: string[];
  /** Original node IDs before whole-architecture aggregation. */
  sourceNodeIds?: string[];
};

export type ArchitectureDiagramEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  type: RelationType;
  phases: ArchitecturePhase[];
  decisionIds: string[];
  trustBoundaryId?: string;
  confidentialData?: string[];
  prohibited?: boolean;
  /** Focused views where this canonical relationship appears. */
  sourceDiagramIds?: string[];
  /** Original relationship IDs before whole-architecture aggregation. */
  sourceEdgeIds?: string[];
  /** Registry relationship IDs backing the source edges. */
  relationshipIds?: string[];
};

export type ArchitectureDiagramDefinition = {
  id: string;
  title: string;
  purpose: string;
  phases: ArchitecturePhase[];
  sourceRanges: Array<{ startLine: number; endLine: number }>;
  decisionIds: string[];
  serviceIds: string[];
  trustBoundaryIds: string[];
  nodes: ArchitectureDiagramNode[];
  edges: ArchitectureDiagramEdge[];
};
