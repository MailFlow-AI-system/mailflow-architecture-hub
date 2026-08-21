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
import { useEffect, useMemo, useRef, useState } from 'react';
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

const wholeKindColumn = {
  actor: 0,
  security_boundary: 0,
  service: 1,
  module: 2,
  queue: 3,
  data_store: 4,
  infrastructure: 5,
  provider: 6,
} as const;

export type ExplorerScopeOption = {
  id: string;
  label: string;
  phase?: ArchitecturePhase;
};

type ArchitectureExplorerProps = {
  diagram: ArchitectureDiagramDefinition;
  scopeOptions?: readonly ExplorerScopeOption[];
  scopeParam?: string;
  variant?: 'focused' | 'whole';
};

function initialParam(name: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URL(window.location.href).searchParams.get(name) ?? undefined;
}

export function ArchitectureExplorer({
  diagram,
  scopeOptions = [],
  scopeParam = 'phase',
  variant = 'focused',
}: ArchitectureExplorerProps) {
  const [phase, setPhase] = useState<ArchitecturePhase | undefined>(() => {
    const value = initialParam('phase');
    return diagram.phases.includes(value as ArchitecturePhase)
      ? (value as ArchitecturePhase)
      : diagram.phases[0];
  });
  const [scope, setScope] = useState(() => {
    const requested = initialParam(scopeParam);
    return scopeOptions.some((option) => option.id === requested)
      ? requested
      : (scopeOptions[0]?.id ?? '');
  });
  const [relationTypes, setRelationTypes] = useState<RelationType[]>(() => {
    const requested = initialParam('types')?.split(',') ?? [];
    return requested.filter((type): type is RelationType => type in relationColors);
  });
  const [serviceId, setServiceId] = useState(() => initialParam('service'));
  const [query, setQuery] = useState(() => initialParam('q') ?? '');
  const [selectedId, setSelectedId] = useState(() => initialParam('node'));
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false);
  const canvasRef = useRef<HTMLElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const activePhase = scopeOptions.length
    ? scopeOptions.find((option) => option.id === scope)?.phase
    : phase;
  const phaseProjection = useMemo(
    () => filterDiagram(diagram, { phase: activePhase, relationTypes: [], query: '' }),
    [activePhase, diagram],
  );
  const filtered = useMemo(
    () => filterDiagram(diagram, { phase: activePhase, relationTypes, serviceId, query }),
    [activePhase, diagram, query, relationTypes, serviceId],
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
  const selectedNode = filtered.nodes.find((node) => node.id === selectedId);
  const relationOptions = useMemo(
    () => [...new Set(phaseProjection.edges.map((edge) => edge.type))],
    [phaseProjection.edges],
  );
  const services = useMemo(
    () => [
      ...new Set(phaseProjection.nodes.flatMap((node) => (node.serviceId ? [node.serviceId] : []))),
    ],
    [phaseProjection.nodes],
  );

  const nodes = useMemo<Node[]>(() => {
    const columnCounts = new Map<number, number>();
    return filtered.nodes.map((node) => {
      const column = variant === 'whole' ? wholeKindColumn[node.kind] : kindColumn[node.kind];
      const row = columnCounts.get(column) ?? 0;
      columnCounts.set(column, row + 1);
      const muted = selectedId ? !adjacent.has(node.id) : false;
      return {
        id: node.id,
        position: { x: column * 390, y: row * 190 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { label: node.label },
        className: `architecture-node architecture-node--${node.kind}`,
        ariaLabel: `${node.label}. ${node.description}`,
        style: { opacity: muted ? 0.2 : 1 },
      };
    });
  }, [adjacent, filtered.nodes, selectedId, variant]);

  const edges = useMemo<Edge[]>(
    () =>
      filtered.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        ariaLabel: `${edge.label}. ${edge.type.replaceAll('_', ' ')}${edge.prohibited ? '. Prohibited.' : ''}`,
        style: {
          stroke: edge.prohibited ? '#ff826e' : relationColors[edge.type],
          strokeDasharray: edge.prohibited ? '7 5' : edge.type === 'event' ? '3 4' : undefined,
          opacity:
            selectedId && !adjacent.has(edge.source) && !adjacent.has(edge.target) ? 0.12 : 0.82,
        },
      })),
    [adjacent, filtered.edges, selectedId],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    if (scopeOptions.length) {
      scope ? url.searchParams.set(scopeParam, scope) : url.searchParams.delete(scopeParam);
      url.searchParams.delete('phase');
    } else {
      phase ? url.searchParams.set('phase', phase) : url.searchParams.delete('phase');
    }
    relationTypes.length
      ? url.searchParams.set('types', relationTypes.join(','))
      : url.searchParams.delete('types');
    serviceId ? url.searchParams.set('service', serviceId) : url.searchParams.delete('service');
    query ? url.searchParams.set('q', query) : url.searchParams.delete('q');
    selectedId ? url.searchParams.set('node', selectedId) : url.searchParams.delete('node');
    history.replaceState(null, '', url);
  }, [phase, query, relationTypes, scope, scopeOptions.length, scopeParam, selectedId, serviceId]);

  useEffect(() => {
    if (selectedId && !filtered.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(undefined);
    }
  }, [filtered.nodes, selectedId]);

  useEffect(() => {
    if (serviceId && !services.includes(serviceId)) {
      setServiceId(undefined);
    }
  }, [serviceId, services]);

  useEffect(() => {
    setRelationTypes((current) => {
      const available = current.filter((type) => relationOptions.includes(type));
      return available.length === current.length ? current : available;
    });
  }, [relationOptions]);

  useEffect(() => {
    if (!isCanvasFullscreen) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsCanvasFullscreen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = [
        ...(canvasRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      requestAnimationFrame(() => expandButtonRef.current?.focus());
    };
  }, [isCanvasFullscreen]);

  function toggleRelation(type: RelationType) {
    setRelationTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  return (
    <div
      className={`architecture-explorer architecture-explorer--${variant}${isCanvasFullscreen ? ' architecture-explorer--fullscreen' : ''}`}
    >
      <section
        className="explorer-filters"
        aria-label="Diagram filters"
        aria-hidden={isCanvasFullscreen || undefined}
      >
        {scopeOptions.length ? (
          <label>
            Architecture scope
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              {scopeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
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
        )}
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
          ref={canvasRef}
          className={`explorer-canvas${isCanvasFullscreen ? ' explorer-canvas--fullscreen' : ''}`}
          role={isCanvasFullscreen ? 'dialog' : undefined}
          aria-label={`${diagram.title} interactive diagram${isCanvasFullscreen ? ' fullscreen' : ''}`}
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
          {isCanvasFullscreen ? (
            <button
              ref={closeButtonRef}
              className="explorer-fullscreen-toggle"
              type="button"
              aria-label="Close fullscreen canvas"
              title="Close fullscreen canvas"
              onClick={() => setIsCanvasFullscreen(false)}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          ) : (
            <button
              ref={expandButtonRef}
              className="explorer-fullscreen-toggle"
              type="button"
              aria-label="Expand architecture canvas"
              title="Expand architecture canvas"
              onClick={() => setIsCanvasFullscreen(true)}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
              </svg>
            </button>
          )}
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
              fitView={variant === 'focused'}
              defaultViewport={variant === 'whole' ? { x: 48, y: 48, zoom: 0.62 } : undefined}
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
        <aside
          className="explorer-inspector"
          aria-live="polite"
          aria-hidden={isCanvasFullscreen || undefined}
        >
          {selectedNode ? (
            <>
              <p className="explorer-kicker">{selectedNode.kind.replaceAll('_', ' ')}</p>
              <h2>{selectedNode.label}</h2>
              <p>{selectedNode.description}</p>
              {selectedNode.serviceId && (
                <a href={`/services/${selectedNode.serviceId}/`}>Open service →</a>
              )}
              {selectedNode.sourceDiagramIds && selectedNode.sourceDiagramIds.length > 0 && (
                <>
                  <h3>Focused source views</h3>
                  <ul>
                    {selectedNode.sourceDiagramIds.map((id) => (
                      <li key={id}>
                        <a href={`/explorer/${id}/`}>{id}</a>
                      </li>
                    ))}
                  </ul>
                </>
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
