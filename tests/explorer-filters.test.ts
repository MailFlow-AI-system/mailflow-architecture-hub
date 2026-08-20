import { describe, expect, test } from 'bun:test';

import { filterDiagram } from '../src/components/explorer/filterDiagram';
import type { ArchitectureDiagramDefinition } from '../src/data/architecture/diagrams';

const diagram = {
  id: 'diagram.test.filters',
  title: 'Filters',
  purpose: 'Test',
  phases: ['mvp', 'future'],
  sourceRanges: [{ startLine: 1, endLine: 2 }],
  decisionIds: ['decision.test.filters'],
  serviceIds: ['service.mail'],
  trustBoundaryIds: [],
  nodes: [
    {
      id: 'mail',
      label: 'Mail',
      kind: 'service',
      phases: ['mvp', 'future'],
      description: 'Mail',
      serviceId: 'service.mail',
      decisionIds: ['decision.test.filters'],
    },
    {
      id: 'provider',
      label: 'Provider',
      kind: 'provider',
      phases: ['future'],
      description: 'Provider',
      decisionIds: ['decision.test.filters'],
    },
  ],
  edges: [
    {
      id: 'edge',
      source: 'mail',
      target: 'provider',
      label: 'call',
      type: 'provider_call',
      phases: ['future'],
      decisionIds: ['decision.test.filters'],
    },
  ],
} satisfies ArchitectureDiagramDefinition;

describe('diagram filters', () => {
  test('keeps endpoints required by visible typed edges', () => {
    const result = filterDiagram(diagram, {
      phase: 'future',
      relationTypes: ['provider_call'],
      serviceId: 'service.mail',
      query: '',
    });
    expect(result.nodes.map((node) => node.id)).toEqual(['mail', 'provider']);
    expect(result.edges.map((edge) => edge.id)).toEqual(['edge']);
  });

  test('returns an empty state for a query without matches', () => {
    const result = filterDiagram(diagram, { phase: 'mvp', relationTypes: [], query: 'billing' });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});
