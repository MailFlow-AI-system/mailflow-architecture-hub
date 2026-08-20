import { describe, expect, test } from 'bun:test';

import { composeWholeArchitecture } from '../src/data/architecture/diagrams/composeWholeArchitecture';
import type { ArchitectureDiagramDefinition } from '../src/data/architecture/diagrams';

const makeDiagram = (
  id: string,
  nodeId: string,
  serviceId: string,
  edgeId: string,
): ArchitectureDiagramDefinition => ({
  id,
  title: id,
  purpose: 'Test view',
  phases: ['mvp', 'future'],
  sourceRanges: [{ startLine: 1, endLine: 2 }],
  decisionIds: ['decision.test.whole'],
  serviceIds: [serviceId],
  trustBoundaryIds: [],
  nodes: [
    {
      id: nodeId,
      label: 'Mail service',
      kind: 'service',
      phases: ['mvp', 'future'],
      description: `Description from ${id}`,
      serviceId,
      decisionIds: ['decision.test.whole'],
    },
    {
      id: `${id}.provider`,
      label: 'Provider',
      kind: 'provider',
      phases: ['future'],
      description: 'Provider',
      decisionIds: ['decision.test.whole'],
    },
  ],
  edges: [
    {
      id: edgeId,
      source: nodeId,
      target: `${id}.provider`,
      label: 'Provider call',
      type: 'provider_call',
      phases: ['future'],
      decisionIds: ['decision.test.whole'],
    },
  ],
});

describe('whole architecture composition', () => {
  test('deduplicates service nodes and repeated relations while preserving provenance', () => {
    const result = composeWholeArchitecture([
      makeDiagram('diagram.one', 'node.one.mail', 'service.mail', 'edge.one'),
      makeDiagram('diagram.two', 'node.two.mail', 'service.mail', 'edge.two'),
    ]);

    expect(result.id).toBe('diagram.architecture.whole');
    expect(result.nodes.filter((node) => node.serviceId === 'service.mail')).toHaveLength(1);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    expect(result.nodes.find((node) => node.serviceId === 'service.mail')).toMatchObject({
      sourceDiagramIds: ['diagram.one', 'diagram.two'],
      sourceNodeIds: ['node.one.mail', 'node.two.mail'],
    });
  });

  test('merges equivalent canonical relations across focused views', () => {
    const first = makeDiagram('diagram.one', 'node.one.mail', 'service.mail', 'edge.same');
    const second = makeDiagram('diagram.two', 'node.two.mail', 'service.mail', 'edge.same-again');
    second.nodes[1].id = first.nodes[1].id;
    second.edges[0].target = first.nodes[1].id;

    const result = composeWholeArchitecture([first, second]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      sourceDiagramIds: ['diagram.one', 'diagram.two'],
      sourceEdgeIds: ['edge.same', 'edge.same-again'],
    });
  });
});
