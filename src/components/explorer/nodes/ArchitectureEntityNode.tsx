import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import type { DiagramNodeKind } from '../../../data/architecture/diagrams';
import type { ArchitectureDomain, ArchitectureLayer } from '../presentation/types';

export type ArchitectureEntityNodeData = {
  label: string;
  kind: DiagramNodeKind;
  domain?: ArchitectureDomain | string;
  layer?: ArchitectureLayer | string;
  description?: string;
  serviceId?: string;
  muted?: boolean;
};

export type ArchitectureEntityNode = Node<ArchitectureEntityNodeData, 'architectureEntity'>;

function displayValue(value: string | undefined, fallback: string): string {
  return value?.replaceAll('_', ' ') || fallback;
}

export function ArchitectureEntityNode({ data, selected }: NodeProps<ArchitectureEntityNode>) {
  const kind = displayValue(data.kind, 'entity');
  const domain = displayValue(data.domain, 'unassigned domain');
  const layer = data.layer ? displayValue(data.layer, 'unassigned layer') : undefined;

  return (
    <div
      className={`architecture-entity-node${data.muted ? ' architecture-node--muted' : ''}`}
      data-selected={selected || undefined}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="architecture-node__handle"
        aria-hidden="true"
      />
      <span className="architecture-node__eyebrow">
        {kind} · {domain}
      </span>
      <strong className="architecture-node__title">{data.label}</strong>
      {layer ? <span className="architecture-node__metadata">{layer}</span> : null}
      <Handle
        type="source"
        position={Position.Right}
        className="architecture-node__handle"
        aria-hidden="true"
      />
    </div>
  );
}

export const architectureEntityNodeTypes = {
  architectureEntity: ArchitectureEntityNode,
} as const;

export default ArchitectureEntityNode;
