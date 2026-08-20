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
