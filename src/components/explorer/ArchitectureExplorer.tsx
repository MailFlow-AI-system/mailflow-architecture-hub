import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import './architectureExplorer.css';
import './architectureNodes.css';

import type { ArchitecturePhase, RelationType } from '../../domain/architecture';
import type {
  ArchitectureDiagramDefinition,
  ArchitectureDiagramNode,
} from '../../data/architecture/diagrams';
import { filterDiagram } from './filterDiagram';
import { ArchitectureLegend, relationColors } from './ArchitectureLegend';
import { useArchitectureLayout } from './layout/useArchitectureLayout';
import {
  architectureDomainNodeTypes,
  type ArchitectureDomainNodeData,
} from './nodes/ArchitectureDomainNode';
import {
  architectureEntityNodeTypes,
  type ArchitectureEntityNodeData,
} from './nodes/ArchitectureEntityNode';
import { projectFocusedDiagram } from './presentation/projectFocusedDiagram';
import {
  projectWholeDiagram,
  type WholeDiagramProjection,
  type WholeProjectionEdge,
} from './presentation/projectWholeDiagram';
import {
  architectureDomains,
  classifyArchitectureNode,
} from './presentation/wholeArchitectureTaxonomy';
import type { ArchitectureDomain } from './presentation/types';
import type { ArchitectureLayoutGraph } from './layout/layoutArchitecture';

export type ExplorerScopeOption = { id: string; label: string; phase?: ArchitecturePhase };
type ArchitectureExplorerProps = {
  diagram: ArchitectureDiagramDefinition;
  scopeOptions?: readonly ExplorerScopeOption[];
  scopeParam?: string;
  variant?: 'focused' | 'whole';
};
type ExplorerNodeData = ArchitectureDomainNodeData | ArchitectureEntityNodeData;
type ExplorerNode = Node<ExplorerNodeData>;

const nodeTypes = { ...architectureDomainNodeTypes, ...architectureEntityNodeTypes };
function initialParam(name: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URL(window.location.href).searchParams.get(name) ?? undefined;
}

function domainFromId(value: string | undefined): ArchitectureDomain | undefined {
  return architectureDomains.includes(value as ArchitectureDomain)
    ? (value as ArchitectureDomain)
    : undefined;
}

function nodeMatches(node: ArchitectureDiagramNode, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('en');
  if (!normalized) return false;
  return [node.id, node.label, node.description, node.serviceId ?? ''].some((value) =>
    value.toLocaleLowerCase('en').includes(normalized),
  );
}

function edgeLabel(
  edge: { label: string; type: RelationType; count: number },
  contextual: boolean,
) {
  const relation = edge.type.replaceAll('_', ' ');
  if (!contextual && edge.count === 1) return undefined;
  return `${edge.count > 1 ? `${edge.count} × ` : ''}${edge.label} · ${relation}`;
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
  const [relationTypes, setRelationTypes] = useState<RelationType[]>(() =>
    (initialParam('types')?.split(',') ?? []).filter(
      (type): type is RelationType => type in relationColors,
    ),
  );
  const [serviceId, setServiceId] = useState(() => initialParam('service'));
  const [query, setQuery] = useState(() => initialParam('q') ?? '');
  const [selectedId, setSelectedId] = useState(() => initialParam('node'));
  const [expandedDomain, setExpandedDomain] = useState<ArchitectureDomain | undefined>(() =>
    domainFromId(initialParam('domain')),
  );
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<ExplorerNode> | null>(null);
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
  const directQueryMatches = useMemo(
    () => phaseProjection.nodes.filter((node) => nodeMatches(node, query)),
    [phaseProjection.nodes, query],
  );
  const baseWholeProjection = useMemo(
    () => (variant === 'whole' ? projectWholeDiagram(filtered) : undefined),
    [filtered, variant],
  );
  const availableDomains = useMemo(
    () =>
      new Set(
        baseWholeProjection?.nodes
          .filter((node) => node.kind === 'domain')
          .map((node) => node.domain),
      ),
    [baseWholeProjection],
  );
  const validExpandedDomain =
    variant === 'whole' && expandedDomain && availableDomains.has(expandedDomain)
      ? expandedDomain
      : undefined;
  const projection = useMemo<WholeDiagramProjection>(() => {
    if (variant === 'whole')
      return projectWholeDiagram(filtered, { expandedDomain: validExpandedDomain });
    const focused = projectFocusedDiagram(filtered);
    return {
      nodes: focused.nodes.map((node) => {
        const classification = classifyArchitectureNode(node);
        return {
          id: node.id,
          kind: 'entity' as const,
          label: node.label,
          domain: classification.domain,
          layer: classification.layer,
          canonicalNodeId: node.id,
          node,
          phases: [...node.phases],
        };
      }),
      edges: focused.edges.map((edge): WholeProjectionEdge => ({
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
        sourceEdgeIds: edge.sourceEdgeIds,
        sourceDiagramIds: edge.sourceDiagramIds,
        relationshipIds: edge.relationshipIds,
        phases: [...edge.phases],
      })),
    };
  }, [filtered, validExpandedDomain, variant]);
  const renderedNodes = projection.nodes;
  const renderedNodeIds = useMemo(
    () => new Set(renderedNodes.map((node) => node.id)),
    [renderedNodes],
  );
  const renderedAdjacent = useMemo(() => {
    if (!selectedId) return new Set<string>();
    return new Set([
      selectedId,
      ...projection.edges
        .filter((edge) => edge.source === selectedId || edge.target === selectedId)
        .flatMap((edge) => [edge.source, edge.target]),
    ]);
  }, [projection.edges, selectedId]);
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
  const layoutGraph = useMemo<ArchitectureLayoutGraph<ExplorerNodeData>>(
    () => ({
      nodes: renderedNodes.map((node) =>
        node.kind === 'domain'
          ? {
              id: node.id,
              width: 336,
              height: node.expanded ? 160 : 128,
              data: {
                domain: node.domain,
                layer: node.layer,
                title: node.label,
                nodeCount: node.canonicalNodeCount,
                connectionCount: node.internalEdgeCount + node.externalEdgeCount,
                expanded: node.expanded,
                muted: selectedId ? !renderedAdjacent.has(node.id) : false,
              },
            }
          : {
              id: node.id,
              width: 272,
              height: 88,
              parentId: variant === 'whole' ? `domain.${node.domain}` : undefined,
              data: {
                label: node.label,
                kind: node.node.kind,
                domain: node.domain,
                layer: node.layer,
                description: node.node.description,
                serviceId: node.node.serviceId,
                muted: selectedId ? !renderedAdjacent.has(node.id) : false,
              },
            },
      ),
      edges: projection.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
    }),
    [projection.edges, renderedAdjacent, renderedNodes, selectedId, variant],
  );
  const layoutOptions = useMemo(() => ({ padding: 28, nodeSpacing: 32, layerSpacing: 64 }), []);
  const layoutState = useArchitectureLayout(layoutGraph, layoutOptions);
  const positionedNodes = useMemo<ExplorerNode[]>(() => {
    if (!layoutState.layout) return [];
    return layoutState.layout.nodes.map((node) => ({
      id: node.id,
      type: node.data && 'nodeCount' in node.data ? 'architectureDomain' : 'architectureEntity',
      position: node.position,
      parentId: node.parentId,
      extent: node.parentId ? 'parent' : undefined,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      width: node.width,
      height: node.height,
      data: node.data as ExplorerNodeData,
      ariaLabel:
        node.data && 'nodeCount' in node.data
          ? `${node.data.title ?? node.data.domain}. Architecture domain.`
          : `${node.data?.label ?? node.id}. Architecture entity.`,
    }));
  }, [layoutState.layout]);
  const positionedNodeMap = useMemo(
    () => new Map(positionedNodes.map((node) => [node.id, node])),
    [positionedNodes],
  );
  const edges = useMemo<Edge[]>(
    () =>
      projection.edges
        .filter((edge) => positionedNodeMap.has(edge.source) && positionedNodeMap.has(edge.target))
        .map((edge) => {
          const contextual = Boolean(
            selectedId && (renderedAdjacent.has(edge.source) || renderedAdjacent.has(edge.target)),
          );
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            type: 'smoothstep',
            label: edgeLabel(edge, edge.kind === 'boundary' || contextual),
            ariaLabel: `${edge.label}. ${edge.type.replaceAll('_', ' ')}${edge.prohibited ? '. Prohibited.' : ''}`,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: edge.prohibited ? '#ff826e' : relationColors[edge.type],
            },
            style: {
              stroke: edge.prohibited ? '#ff826e' : relationColors[edge.type],
              strokeDasharray: edge.prohibited ? '7 5' : edge.type === 'event' ? '3 4' : undefined,
              opacity:
                selectedId &&
                !renderedAdjacent.has(edge.source) &&
                !renderedAdjacent.has(edge.target)
                  ? 0.12
                  : 0.82,
            },
          };
        }),
    [positionedNodeMap, projection.edges, renderedAdjacent, selectedId],
  );
  const selectedProjectionNode = renderedNodes.find((node) => node.id === selectedId);
  const selectedCanonicalNode =
    selectedProjectionNode?.kind === 'entity'
      ? selectedProjectionNode.node
      : filtered.nodes.find((node) => node.id === selectedId);

  useEffect(() => {
    if (expandedDomain && !availableDomains.has(expandedDomain)) setExpandedDomain(undefined);
  }, [availableDomains, expandedDomain]);
  useEffect(() => {
    if (variant !== 'whole' || directQueryMatches.length !== 1 || !query.trim()) return;
    const match = directQueryMatches[0];
    setExpandedDomain(classifyArchitectureNode(match).domain);
    setSelectedId(match.id);
  }, [directQueryMatches, query, variant]);
  useEffect(() => {
    if (variant !== 'whole' || !selectedId || expandedDomain) return;
    const selectedCanonical = phaseProjection.nodes.find((node) => node.id === selectedId);
    if (selectedCanonical) setExpandedDomain(classifyArchitectureNode(selectedCanonical).domain);
  }, [expandedDomain, phaseProjection.nodes, selectedId, variant]);
  useEffect(() => {
    if (!selectedId || renderedNodeIds.has(selectedId)) return;
    if (variant === 'whole' && filtered.nodes.some((node) => node.id === selectedId)) return;
    setSelectedId(undefined);
  }, [filtered.nodes, renderedNodeIds, selectedId, variant]);
  useEffect(() => {
    if (serviceId && !services.includes(serviceId)) setServiceId(undefined);
  }, [serviceId, services]);
  useEffect(() => {
    setRelationTypes((current) => {
      const available = current.filter((type) => relationOptions.includes(type));
      return available.length === current.length ? current : available;
    });
  }, [relationOptions]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (scopeOptions.length) {
      scope ? url.searchParams.set(scopeParam, scope) : url.searchParams.delete(scopeParam);
      url.searchParams.delete('phase');
    } else phase ? url.searchParams.set('phase', phase) : url.searchParams.delete('phase');
    relationTypes.length
      ? url.searchParams.set('types', relationTypes.join(','))
      : url.searchParams.delete('types');
    serviceId ? url.searchParams.set('service', serviceId) : url.searchParams.delete('service');
    query ? url.searchParams.set('q', query) : url.searchParams.delete('q');
    selectedId ? url.searchParams.set('node', selectedId) : url.searchParams.delete('node');
    validExpandedDomain
      ? url.searchParams.set('domain', validExpandedDomain)
      : url.searchParams.delete('domain');
    history.replaceState(null, '', url);
  }, [
    phase,
    query,
    relationTypes,
    scope,
    scopeOptions.length,
    scopeParam,
    selectedId,
    serviceId,
    validExpandedDomain,
  ]);
  useEffect(() => {
    if (layoutState.layout && flowInstance) flowInstance.fitView({ padding: 0.14, duration: 0 });
  }, [flowInstance, layoutState.layout]);
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
  function handleNodeActivation(nodeId: string) {
    const node = renderedNodes.find((item) => item.id === nodeId);
    if (node?.kind === 'domain') {
      setExpandedDomain((current) => (current === node.domain ? undefined : node.domain));
      setSelectedId(node.id);
      return;
    }
    setSelectedId((current) => (current === nodeId ? undefined : nodeId));
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
            handleNodeActivation(nodeId);
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
          <ArchitectureLegend />
          {layoutState.loading ? (
            <p className="explorer-status" role="status">
              Arranging architecture canvas…
            </p>
          ) : null}
          {layoutState.error ? (
            <p className="explorer-status explorer-status--error" role="alert">
              Automatic layout unavailable. Showing deterministic fallback.
            </p>
          ) : null}
          {renderedNodes.length === 0 ? (
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
            <ReactFlow<ExplorerNode>
              nodes={positionedNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              onInit={setFlowInstance}
              onNodeClick={(_, node) => handleNodeActivation(node.id)}
              onPaneClick={() => setSelectedId(undefined)}
              fitView={false}
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
          {selectedProjectionNode?.kind === 'domain' ? (
            <>
              <p className="explorer-kicker">Architecture domain</p>
              <h2>{selectedProjectionNode.label}</h2>
              <p>
                {selectedProjectionNode.canonicalNodeCount} canonical nodes and{' '}
                {selectedProjectionNode.internalEdgeCount +
                  selectedProjectionNode.externalEdgeCount}{' '}
                canonical connections.
              </p>
              <p>
                {selectedProjectionNode.expanded
                  ? 'Domain expanded. Select an entity for detailed evidence.'
                  : 'Activate domain to reveal its entities and internal relationships.'}
              </p>
            </>
          ) : selectedCanonicalNode ? (
            <>
              <p className="explorer-kicker">{selectedCanonicalNode.kind.replaceAll('_', ' ')}</p>
              <h2>{selectedCanonicalNode.label}</h2>
              <p>{selectedCanonicalNode.description}</p>
              {selectedCanonicalNode.serviceId && (
                <a href={`/services/${selectedCanonicalNode.serviceId}/`}>Open service →</a>
              )}
              {selectedCanonicalNode.sourceDiagramIds?.length ? (
                <>
                  <h3>Focused source views</h3>
                  <ul>
                    {selectedCanonicalNode.sourceDiagramIds.map((id) => (
                      <li key={id}>
                        <a href={`/explorer/${id}/`}>{id}</a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <h3>Source decisions</h3>
              <ul>
                {selectedCanonicalNode.decisionIds.map((id) => (
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
