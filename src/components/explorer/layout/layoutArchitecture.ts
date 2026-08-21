import type { ElkNode } from 'elkjs/lib/elk.bundled.js';

export type ArchitectureLayoutNode<T = unknown> = {
  id: string;
  width: number;
  height: number;
  parentId?: string;
  data?: T;
};

export type ArchitectureLayoutEdge = {
  id?: string;
  source: string;
  target: string;
  data?: unknown;
};

export type ArchitectureLayoutGraph<T = unknown> = {
  nodes: ArchitectureLayoutNode<T>[];
  edges: ArchitectureLayoutEdge[];
};

export type ArchitecturePosition = { x: number; y: number };

export type PositionedArchitectureNode<T = unknown> = ArchitectureLayoutNode<T> & {
  position: ArchitecturePosition;
};

export type ArchitectureLayoutError = {
  message: string;
  cause: unknown;
};

export type ArchitectureLayoutResult<T = unknown> = {
  nodes: PositionedArchitectureNode<T>[];
  edges: ArchitectureLayoutEdge[];
  width: number;
  height: number;
  error?: ArchitectureLayoutError;
};

export type ArchitectureLayoutEngine = {
  layout: (
    graph: ElkNode,
    options?: { layoutOptions?: Record<string, string> },
  ) => Promise<ElkNode>;
};

export type ArchitectureLayoutOptions = {
  engine?: ArchitectureLayoutEngine;
  padding?: number;
  nodeSpacing?: number;
  layerSpacing?: number;
};

type PreparedNode<T> = PositionedArchitectureNode<T> & {
  children?: PreparedNode<T>[];
};

const DEFAULT_PADDING = 24;
const DEFAULT_NODE_SPACING = 32;
const DEFAULT_LAYER_SPACING = 56;

let defaultEnginePromise: Promise<ArchitectureLayoutEngine> | undefined;

async function getDefaultEngine(): Promise<ArchitectureLayoutEngine> {
  defaultEnginePromise ??= (async () => {
    // Bun exposes `self` even without a browser. Remove it while loading ELK so
    // its bundled fake worker selects its synchronous Node-compatible export.
    const runtime = globalThis as typeof globalThis & { self?: unknown; window?: unknown };
    const hadSelf = Object.hasOwn(runtime, 'self');
    const previousSelf = runtime.self;
    if (hadSelf && typeof runtime.window === 'undefined') Reflect.deleteProperty(runtime, 'self');
    try {
      const { default: ElkConstructor } = await import('elkjs/lib/elk.bundled.js');
      return new ElkConstructor();
    } finally {
      if (hadSelf && typeof runtime.window === 'undefined') runtime.self = previousSelf;
    }
  })();
  return defaultEnginePromise;
}

function stableNodes<T>(nodes: ArchitectureLayoutNode<T>[]): ArchitectureLayoutNode<T>[] {
  return [...nodes].sort((left, right) => left.id.localeCompare(right.id));
}

function stableEdges(edges: ArchitectureLayoutEdge[]): ArchitectureLayoutEdge[] {
  return [...edges].sort((left, right) => {
    const leftKey = `${left.id ?? ''}:${left.source}:${left.target}`;
    const rightKey = `${right.id ?? ''}:${right.source}:${right.target}`;
    return leftKey.localeCompare(rightKey);
  });
}

function layoutOptionsFor(
  options: Required<Pick<ArchitectureLayoutOptions, 'nodeSpacing' | 'layerSpacing'>>,
) {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.spacing.nodeNode': String(options.nodeSpacing),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(options.layerSpacing),
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  };
}

function toElkGraph<T>(
  nodes: ArchitectureLayoutNode<T>[],
  edges: ArchitectureLayoutEdge[],
  options: Required<Pick<ArchitectureLayoutOptions, 'nodeSpacing' | 'layerSpacing'>>,
): ElkNode {
  const nodeIds = new Set(nodes.map((node) => node.id));

  return {
    id: 'architecture-layout',
    children: stableNodes(nodes).map((node) => ({
      id: node.id,
      width: Math.max(1, node.width),
      height: Math.max(1, node.height),
    })),
    edges: stableEdges(edges)
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge, index) => ({
        id: edge.id ?? `architecture-edge-${index}`,
        sources: [edge.source],
        targets: [edge.target],
      })),
    layoutOptions: layoutOptionsFor(options),
  };
}

async function runElk<T>(
  nodes: ArchitectureLayoutNode<T>[],
  edges: ArchitectureLayoutEdge[],
  engine: ArchitectureLayoutEngine,
  options: Required<Pick<ArchitectureLayoutOptions, 'nodeSpacing' | 'layerSpacing'>>,
): Promise<Map<string, ArchitecturePosition> & { width?: number; height?: number }> {
  const result = await engine.layout(toElkGraph(nodes, edges, options), {
    layoutOptions: layoutOptionsFor(options),
  });
  const positions = new Map<string, ArchitecturePosition>() as Map<string, ArchitecturePosition> & {
    width?: number;
    height?: number;
  };

  for (const node of result.children ?? []) {
    positions.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
  }
  positions.width = result.width ?? 0;
  positions.height = result.height ?? 0;
  return positions;
}

function directChildOf(
  nodeId: string,
  containerId: string,
  parentById: Map<string, string | undefined>,
): string | undefined {
  let current = nodeId;
  const seen = new Set<string>();
  while (parentById.has(current) && !seen.has(current)) {
    seen.add(current);
    const parentId = parentById.get(current);
    if (parentId === containerId) return current;
    if (!parentId) return undefined;
    current = parentId;
  }
  return undefined;
}

function rootOf(nodeId: string, parentById: Map<string, string | undefined>): string {
  let current = nodeId;
  const seen = new Set<string>();
  while (parentById.get(current) && !seen.has(current)) {
    seen.add(current);
    current = parentById.get(current) as string;
  }
  return current;
}

async function layoutWithElk<T>(
  graph: ArchitectureLayoutGraph<T>,
  options: Required<Pick<ArchitectureLayoutOptions, 'padding' | 'nodeSpacing' | 'layerSpacing'>>,
  engine: ArchitectureLayoutEngine,
): Promise<ArchitectureLayoutResult<T>> {
  const nodes = graph.nodes.map((node) => ({ ...node }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const parentById = new Map(
    nodes.map((node) => [
      node.id,
      node.parentId && nodeById.has(node.parentId) ? node.parentId : undefined,
    ]),
  );
  const childrenByParent = new Map<string, ArchitectureLayoutNode<T>[]>();
  for (const node of stableNodes(nodes)) {
    const parentId = parentById.get(node.id);
    if (parentId) childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), node]);
  }

  const preparedById = new Map<string, PreparedNode<T>>();
  const localPositionsByParent = new Map<string, Map<string, ArchitecturePosition>>();
  const visiting = new Set<string>();

  async function prepare(node: ArchitectureLayoutNode<T>): Promise<PreparedNode<T>> {
    const existing = preparedById.get(node.id);
    if (existing) return existing;
    if (visiting.has(node.id)) throw new Error(`Cyclic parent relationship at ${node.id}`);
    visiting.add(node.id);

    const children = childrenByParent.get(node.id) ?? [];
    const preparedChildren = [] as PreparedNode<T>[];
    for (const child of children) preparedChildren.push(await prepare(child));

    let width = Math.max(1, node.width);
    let height = Math.max(1, node.height);
    let localPositions: Map<string, ArchitecturePosition> | undefined;
    if (preparedChildren.length > 0) {
      const childIds = new Set(preparedChildren.map((child) => child.id));
      const localEdges = graph.edges.flatMap((edge) => {
        const source = directChildOf(edge.source, node.id, parentById);
        const target = directChildOf(edge.target, node.id, parentById);
        if (!source || !target || !childIds.has(source) || !childIds.has(target)) return [];
        return [{ ...edge, source, target }];
      });
      localPositions = await runElk(preparedChildren, localEdges, engine, options);
      for (const child of preparedChildren) {
        const position = localPositions.get(child.id) ?? { x: 0, y: 0 };
        width = Math.max(width, position.x + child.width + options.padding * 2);
        height = Math.max(height, position.y + child.height + options.padding * 2);
      }
      localPositionsByParent.set(node.id, localPositions);
    }

    const prepared: PreparedNode<T> = {
      ...node,
      width,
      height,
      position: { x: 0, y: 0 },
      children: preparedChildren,
    };
    preparedById.set(node.id, prepared);
    visiting.delete(node.id);
    return prepared;
  }

  const roots = stableNodes(nodes.filter((node) => !parentById.get(node.id)));
  const preparedRoots = [] as PreparedNode<T>[];
  for (const root of roots) preparedRoots.push(await prepare(root));

  const rootIds = new Set(preparedRoots.map((node) => node.id));
  const rootEdges = graph.edges.flatMap((edge) => {
    const source = rootOf(edge.source, parentById);
    const target = rootOf(edge.target, parentById);
    if (!rootIds.has(source) || !rootIds.has(target) || source === target) return [];
    return [{ ...edge, source, target }];
  });
  const rootPositions = await runElk(preparedRoots, rootEdges, engine, options);
  const positioned: PositionedArchitectureNode<T>[] = [];

  function emit(node: PreparedNode<T>, position: ArchitecturePosition): void {
    const positionedNode = { ...node, position } as PositionedArchitectureNode<T>;
    delete (positionedNode as PreparedNode<T>).children;
    positioned.push(positionedNode);
    const localPositions = localPositionsByParent.get(node.id);
    for (const child of node.children ?? []) {
      const local = localPositions?.get(child.id) ?? { x: 0, y: 0 };
      emit(child, {
        x: options.padding + local.x,
        y: options.padding + local.y,
      });
    }
  }

  for (const root of preparedRoots) emit(root, rootPositions.get(root.id) ?? { x: 0, y: 0 });
  const width = Math.max(
    0,
    ...preparedRoots.map((root) => {
      const position = rootPositions.get(root.id) ?? { x: 0, y: 0 };
      return position.x + root.width;
    }),
  );
  const height = Math.max(
    0,
    ...preparedRoots.map((root) => {
      const position = rootPositions.get(root.id) ?? { x: 0, y: 0 };
      return position.y + root.height;
    }),
  );
  return { nodes: positioned, edges: [...graph.edges], width, height };
}

function fallbackLayout<T>(
  graph: ArchitectureLayoutGraph<T>,
  options: Required<Pick<ArchitectureLayoutOptions, 'padding' | 'nodeSpacing'>>,
): ArchitectureLayoutResult<T> {
  const nodes = graph.nodes.map((node) => ({ ...node }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const parentById = new Map(
    nodes.map((node) => [
      node.id,
      node.parentId && nodeById.has(node.parentId) ? node.parentId : undefined,
    ]),
  );
  const childrenByParent = new Map<string, ArchitectureLayoutNode<T>[]>();
  for (const node of stableNodes(nodes)) {
    const parentId = parentById.get(node.id);
    if (parentId) childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), node]);
  }
  const dimensions = new Map<string, { width: number; height: number }>();
  const positions = new Map<string, ArchitecturePosition>();

  function measure(node: ArchitectureLayoutNode<T>): { width: number; height: number } {
    const children = childrenByParent.get(node.id) ?? [];
    const childSizes = children.map(measure);
    const width = Math.max(
      1,
      node.width,
      ...childSizes.map((size) => size.width + options.padding * 2),
    );
    const height = Math.max(
      1,
      node.height,
      childSizes.reduce((sum, size) => sum + size.height, 0) +
        Math.max(0, childSizes.length - 1) * options.nodeSpacing +
        options.padding * 2,
    );
    const size = { width, height };
    dimensions.set(node.id, size);
    return size;
  }

  function place(node: ArchitectureLayoutNode<T>, position: ArchitecturePosition): void {
    positions.set(node.id, position);
    let childY = options.padding;
    for (const child of childrenByParent.get(node.id) ?? []) {
      place(child, { x: options.padding, y: childY });
      childY += (dimensions.get(child.id)?.height ?? 0) + options.nodeSpacing;
    }
  }

  const roots = stableNodes(nodes.filter((node) => !parentById.get(node.id)));
  let rootX = 0;
  for (const root of roots) {
    const size = measure(root);
    place(root, { x: rootX, y: 0 });
    rootX += size.width + options.nodeSpacing;
  }
  const positioned: PositionedArchitectureNode<T>[] = [];
  function emit(node: ArchitectureLayoutNode<T>): void {
    positioned.push({
      ...node,
      ...dimensions.get(node.id),
      position: positions.get(node.id) ?? { x: 0, y: 0 },
    });
    for (const child of childrenByParent.get(node.id) ?? []) emit(child);
  }
  for (const root of roots) emit(root);
  const rootNodes = positioned.filter((node) => !parentById.get(node.id));
  return {
    nodes: positioned,
    edges: [...graph.edges],
    width: Math.max(0, ...rootNodes.map((node) => node.position.x + node.width)),
    height: Math.max(0, ...rootNodes.map((node) => node.position.y + node.height)),
  };
}

export async function layoutArchitecture<T = unknown>(
  graph: ArchitectureLayoutGraph<T>,
  options: ArchitectureLayoutOptions = {},
): Promise<ArchitectureLayoutResult<T>> {
  const resolved = {
    padding: options.padding ?? DEFAULT_PADDING,
    nodeSpacing: options.nodeSpacing ?? DEFAULT_NODE_SPACING,
    layerSpacing: options.layerSpacing ?? DEFAULT_LAYER_SPACING,
  };
  try {
    return await layoutWithElk(graph, resolved, options.engine ?? (await getDefaultEngine()));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      ...fallbackLayout(graph, resolved),
      error: { message: `ELK layout failed: ${message}`, cause },
    };
  }
}
