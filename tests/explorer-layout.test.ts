import { describe, expect, test } from 'bun:test';

import {
  layoutArchitecture,
  type ArchitectureLayoutEngine,
  type ArchitectureLayoutGraph,
} from '../src/components/explorer/layout/layoutArchitecture';

const graph: ArchitectureLayoutGraph<{ role: string }> = {
  nodes: [
    { id: 'domain', width: 180, height: 80, data: { role: 'domain' } },
    { id: 'api', width: 120, height: 56, parentId: 'domain', data: { role: 'api' } },
    { id: 'worker', width: 120, height: 56, parentId: 'domain', data: { role: 'worker' } },
    { id: 'provider', width: 140, height: 64, data: { role: 'provider' } },
  ],
  edges: [
    { id: 'api-worker', source: 'api', target: 'worker' },
    { id: 'worker-provider', source: 'worker', target: 'provider' },
  ],
};

describe('architecture layout adapter', () => {
  test('returns deterministic positions without overlapping flat nodes', async () => {
    const flatGraph = {
      nodes: graph.nodes.filter((node) => !node.parentId),
      edges: [{ id: 'domain-provider', source: 'domain', target: 'provider' }],
    } satisfies ArchitectureLayoutGraph;

    const first = await layoutArchitecture(flatGraph);
    const second = await layoutArchitecture(flatGraph);

    expect(first.error).toBeUndefined();
    expect(first.nodes.map(({ id, position }) => ({ id, position }))).toEqual(
      second.nodes.map(({ id, position }) => ({ id, position })),
    );

    for (const [index, node] of first.nodes.entries()) {
      for (const other of first.nodes.slice(index + 1)) {
        expect(
          node.position.x + node.width <= other.position.x ||
            other.position.x + other.width <= node.position.x ||
            node.position.y + node.height <= other.position.y ||
            other.position.y + other.height <= node.position.y,
        ).toBe(true);
      }
    }
  });

  test('lays out children locally, contains them, and emits parents first', async () => {
    const result = await layoutArchitecture(graph);
    const parentIndex = result.nodes.findIndex((node) => node.id === 'domain');
    const apiIndex = result.nodes.findIndex((node) => node.id === 'api');
    const workerIndex = result.nodes.findIndex((node) => node.id === 'worker');
    const domain = result.nodes[parentIndex];
    const children = [result.nodes[apiIndex], result.nodes[workerIndex]];

    expect(result.error).toBeUndefined();
    expect(parentIndex).toBeLessThan(apiIndex);
    expect(parentIndex).toBeLessThan(workerIndex);
    expect(domain.width).toBeGreaterThan(180);
    expect(domain.height).toBeGreaterThan(80);

    for (const child of children) {
      expect(child.position.x).toBeGreaterThan(0);
      expect(child.position.y).toBeGreaterThan(0);
      expect(child.position.x + child.width).toBeLessThan(domain.width);
      expect(child.position.y + child.height).toBeLessThan(domain.height);
      expect(child.data).toEqual(graph.nodes.find((node) => node.id === child.id)?.data);
    }
  });

  test('keeps nested child positions relative to their immediate parent', async () => {
    const nested = {
      nodes: [
        { id: 'root', width: 160, height: 80 },
        { id: 'parent', width: 120, height: 60, parentId: 'root' },
        { id: 'child', width: 80, height: 40, parentId: 'parent' },
      ],
      edges: [],
    } satisfies ArchitectureLayoutGraph;

    const result = await layoutArchitecture(nested);
    const root = result.nodes.find((node) => node.id === 'root');
    const parent = result.nodes.find((node) => node.id === 'parent');
    const child = result.nodes.find((node) => node.id === 'child');
    if (!root || !parent || !child) throw new Error('Nested layout nodes missing');

    expect(root.position.x).toBeGreaterThanOrEqual(0);
    expect(parent.position.x).toBeGreaterThan(0);
    expect(child.position.x).toBeGreaterThan(0);
    expect(parent.position.x + parent.width).toBeLessThan(root.width);
    expect(child.position.x + child.width).toBeLessThan(parent.width);
    expect(result.width).toBe(root.position.x + root.width);
    expect(result.height).toBe(root.position.y + root.height);
  });

  test('returns deterministic fallback and exposes ELK failure context', async () => {
    const failingEngine: ArchitectureLayoutEngine = {
      layout: async () => {
        throw new Error('synthetic ELK failure');
      },
    };

    const result = await layoutArchitecture(graph, { engine: failingEngine });
    const reorderedResult = await layoutArchitecture(
      { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() },
      { engine: failingEngine },
    );

    expect(result.error?.message).toContain('synthetic ELK failure');
    expect(result.nodes.map((node) => node.id)).toEqual(['domain', 'api', 'worker', 'provider']);
    expect(new Set(result.nodes.map((node) => `${node.position.x}:${node.position.y}`)).size).toBe(
      result.nodes.length,
    );
    expect(
      reorderedResult.nodes
        .map(({ id, position }) => ({ id, position }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual(
      result.nodes
        .map(({ id, position }) => ({ id, position }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    );

    const nestedResult = await layoutArchitecture(
      {
        nodes: [
          { id: 'root', width: 160, height: 80 },
          { id: 'parent', width: 120, height: 60, parentId: 'root' },
          { id: 'child', width: 80, height: 40, parentId: 'parent' },
        ],
        edges: [],
      },
      { engine: failingEngine },
    );
    const nestedParent = nestedResult.nodes.find((node) => node.id === 'parent');
    const nestedChild = nestedResult.nodes.find((node) => node.id === 'child');
    if (!nestedParent || !nestedChild) throw new Error('Fallback nested nodes missing');
    expect(nestedChild.position.x).toBeGreaterThan(0);
    expect(nestedChild.position.x + nestedChild.width).toBeLessThan(nestedParent.width);
  });
});
