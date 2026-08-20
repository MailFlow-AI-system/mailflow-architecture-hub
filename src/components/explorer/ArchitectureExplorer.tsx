import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import '@xyflow/react/dist/style.css';
import './architectureExplorer.css';

import type { ArchitecturePhase, RelationType } from '../../domain/architecture';
import type { ArchitectureDiagramDefinition } from '../../data/architecture/diagrams';
import { filterDiagram } from './filterDiagram';

const relationColors: Record<RelationType, string> = {
  sync_rest: '#91e3d6',
  event: '#d9ff69',
  async_command: '#ff9769',
  job: '#c5a6ff',
  data: '#8bb8ff',
  authentication: '#ffe48d',
  authorization: '#ffb4cf',
  infrastructure: '#8f9ba3',
  provider_call: '#ff826e',
  ownership: '#f5f2ea',
  dependency: '#b6c1c7',
  phase_transition: '#d9ff69',
  trust_boundary: '#ffcf70',
};

const kindColumn = {
  actor: 0,
  security_boundary: 0,
  module: 1,
  service: 1,
  queue: 2,
  data_store: 2,
  infrastructure: 3,
  provider: 3,
} as const;

function initialParam(name: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URL(window.location.href).searchParams.get(name) ?? undefined;
}

export function ArchitectureExplorer({ diagram }: { diagram: ArchitectureDiagramDefinition }) {
  const [phase, setPhase] = useState<ArchitecturePhase | undefined>(() => {
    const value = initialParam('phase');
    return diagram.phases.includes(value as ArchitecturePhase)
      ? (value as ArchitecturePhase)
      : diagram.phases[0];
  });
  const [relationTypes, setRelationTypes] = useState<RelationType[]>(() => {
    const requested = initialParam('types')?.split(',') ?? [];
    return requested.filter((type): type is RelationType => type in relationColors);
  });
  const [serviceId, setServiceId] = useState(() => initialParam('service'));
  const [query, setQuery] = useState(() => initialParam('q') ?? '');
  const [selectedId, setSelectedId] = useState(() => initialParam('node'));
  const filtered = useMemo(
    () => filterDiagram(diagram, { phase, relationTypes, serviceId, query }),
    [diagram, phase, query, relationTypes, serviceId],
  );
  const adjacent = useMemo(() => {
    if (!selectedId) return new Set<string>();
    return new Set([
      selectedId,
      ...filtered.edges
        .filter((edge) => edge.source === selectedId || edge.target === selectedId)
        .flatMap((edge) => [edge.source, edge.target]),
    ]);
  }, [filtered.edges, selectedId]);
  const selectedNode = diagram.nodes.find((node) => node.id === selectedId);
  const relationOptions = [...new Set(diagram.edges.map((edge) => edge.type))];
  const services = [...new Set(diagram.nodes.flatMap((node) => node.serviceId ?? []))];

  const nodes = useMemo<Node[]>(() => {
    const columnCounts = new Map<number, number>();
    return filtered.nodes.map((node) => {
      const column = kindColumn[node.kind];
      const row = columnCounts.get(column) ?? 0;
      columnCounts.set(column, row + 1);
      const muted = selectedId ? !adjacent.has(node.id) : false;
      return {
        id: node.id,
        position: { x: column * 310, y: row * 150 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { label: node.label },
        className: `architecture-node architecture-node--${node.kind}`,
        ariaLabel: `${node.label}. ${node.description}`,
        style: { opacity: muted ? 0.2 : 1 },
      };
    });
  }, [adjacent, filtered.nodes, selectedId]);

  const edges = useMemo<Edge[]>(
    () =>
      filtered.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.prohibited ? `PROHIBITED · ${edge.label}` : edge.label,
        type: 'smoothstep',
        ariaLabel: `${edge.label}. ${edge.type.replaceAll('_', ' ')}${edge.prohibited ? '. Prohibited.' : ''}`,
        style: {
          stroke: edge.prohibited ? '#ff826e' : relationColors[edge.type],
          strokeDasharray: edge.prohibited ? '7 5' : edge.type === 'event' ? '3 4' : undefined,
          opacity:
            selectedId && !adjacent.has(edge.source) && !adjacent.has(edge.target) ? 0.12 : 0.82,
        },
        labelStyle: { fill: '#d6d4cc', fontSize: 10 },
      })),
    [adjacent, filtered.edges, selectedId],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    phase ? url.searchParams.set('phase', phase) : url.searchParams.delete('phase');
    relationTypes.length
      ? url.searchParams.set('types', relationTypes.join(','))
      : url.searchParams.delete('types');
    serviceId ? url.searchParams.set('service', serviceId) : url.searchParams.delete('service');
    query ? url.searchParams.set('q', query) : url.searchParams.delete('q');
    selectedId ? url.searchParams.set('node', selectedId) : url.searchParams.delete('node');
    history.replaceState(null, '', url);
  }, [phase, query, relationTypes, selectedId, serviceId]);

  function toggleRelation(type: RelationType) {
    setRelationTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  return (
    <div className="architecture-explorer">
      <section className="explorer-filters" aria-label="Diagram filters">
        <label>
          Phase
          <select
            value={phase}
            onChange={(event) => setPhase(event.target.value as ArchitecturePhase)}
          >
            {diagram.phases.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Service
          <select
            value={serviceId ?? ''}
            onChange={(event) => setServiceId(event.target.value || undefined)}
          >
            <option value="">All services</option>
            {services.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="explorer-query">
          Find node
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
            placeholder="Label or responsibility"
          />
        </label>
        <fieldset>
          <legend>Relationship types</legend>
          {relationOptions.map((type) => (
            <label key={type}>
              <input
                type="checkbox"
                checked={relationTypes.includes(type)}
                onChange={() => toggleRelation(type)}
              />
              {type.replaceAll('_', ' ')}
            </label>
          ))}
        </fieldset>
      </section>
      <div className="explorer-workspace">
        <section
          className="explorer-canvas"
          aria-label={`${diagram.title} interactive diagram`}
          onKeyDownCapture={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const target = event.target as HTMLElement;
            const node = target.closest<HTMLElement>('.react-flow__node');
            const nodeId = node?.dataset.id;
            if (!nodeId) return;
            event.preventDefault();
            setSelectedId(nodeId === selectedId ? undefined : nodeId);
          }}
        >
          {nodes.length === 0 ? (
            <div className="explorer-empty">
              <strong>No elements match these filters.</strong>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setServiceId(undefined);
                  setRelationTypes([]);
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              onNodeClick={(_, node) => setSelectedId(node.id === selectedId ? undefined : node.id)}
              onPaneClick={() => setSelectedId(undefined)}
              fitView
              minZoom={0.15}
              maxZoom={1.8}
              deleteKeyCode={null}
              nodesFocusable
              edgesFocusable
              autoPanOnNodeFocus
            >
              <Background variant={BackgroundVariant.Dots} color="#52616a" gap={28} />
              <MiniMap
                pannable
                zoomable
                aria-label="Diagram minimap"
                nodeColor="#d9ff69"
                maskColor="rgba(4, 9, 12, .68)"
              />
              <Controls showInteractive={false} aria-label="Diagram zoom controls" />
            </ReactFlow>
          )}
        </section>
        <aside className="explorer-inspector" aria-live="polite">
          {selectedNode ? (
            <>
              <p className="explorer-kicker">{selectedNode.kind.replaceAll('_', ' ')}</p>
              <h2>{selectedNode.label}</h2>
              <p>{selectedNode.description}</p>
              {selectedNode.serviceId && (
                <a href={`/services/${selectedNode.serviceId}/`}>Open service →</a>
              )}
              <h3>Source decisions</h3>
              <ul>
                {selectedNode.decisionIds.map((id) => (
                  <li key={id}>
                    <a href={`/decisions/${id}/`}>{id}</a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="explorer-kicker">Inspector</p>
              <h2>Select a node</h2>
              <p>
                Selection highlights immediate dependencies and exposes source decisions. Filters
                are persisted in the URL.
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

export default ArchitectureExplorer;
