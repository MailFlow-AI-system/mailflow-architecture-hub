import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import type { ArchitectureDomain, ArchitectureLayer } from '../presentation/types';

export type ArchitectureDomainNodeData = {
  domain: ArchitectureDomain | string;
  layer: ArchitectureLayer | string;
  label?: string;
  title?: string;
  nodeCount: number;
  connectionCount: number;
  expanded: boolean;
  muted?: boolean;
};

export type ArchitectureDomainNode = Node<ArchitectureDomainNodeData, 'architectureDomain'>;

function displayValue(value: string): string {
  return value.replaceAll(/[-_]/g, ' ');
}

export function ArchitectureDomainNode({ data, selected }: NodeProps<ArchitectureDomainNode>) {
  const title = displayValue(data.title ?? data.label ?? data.domain);
  const state = data.expanded ? 'Expanded domain' : 'Collapsed domain';

  return (
    <button
      type="button"
      className={`architecture-domain-node${data.muted ? ' architecture-node--muted' : ''}`}
      data-expanded={data.expanded}
      data-selected={selected || undefined}
      aria-label={`${title}. ${state}. ${data.nodeCount} nodes and ${data.connectionCount} connections.`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="architecture-node__handle"
        aria-hidden="true"
      />
      <span className="architecture-node__eyebrow">
        {displayValue(data.layer)} · {displayValue(data.domain)}
      </span>
      <strong className="architecture-node__title">{title}</strong>
      <span className="architecture-node__metadata">
        {data.nodeCount} canonical nodes · {data.connectionCount} canonical connections
      </span>
      <span className="architecture-node__state" aria-live="polite">
        {state}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        className="architecture-node__handle"
        aria-hidden="true"
      />
    </button>
  );
}

export const architectureDomainNodeTypes = {
  architectureDomain: ArchitectureDomainNode,
} as const;

export default ArchitectureDomainNode;
