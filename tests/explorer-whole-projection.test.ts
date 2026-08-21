import { describe, expect, test } from 'bun:test';

import { architectureDiagrams, composeWholeArchitecture } from '../src/data/architecture/diagrams';
import type {
  ArchitectureDiagramDefinition,
  ArchitectureDiagramEdge,
  ArchitectureDiagramNode,
} from '../src/data/architecture/diagrams';
import { filterDiagram } from '../src/components/explorer/filterDiagram';
import { projectWholeDiagram } from '../src/components/explorer/presentation/projectWholeDiagram';
import { projectFocusedDiagram } from '../src/components/explorer/presentation/projectFocusedDiagram';

const makeNode = (
  id: string,
  kind: ArchitectureDiagramNode['kind'],
  phases: ArchitectureDiagramNode['phases'] = ['mvp'],
  serviceId?: string,
): ArchitectureDiagramNode => ({
  id,
  label: id,
  kind,
  phases,
  description: id,
  ...(serviceId ? { serviceId } : {}),
  decisionIds: [],
});

const makeEdge = (
  id: string,
  source: string,
  target: string,
  type: ArchitectureDiagramEdge['type'] = 'provider_call',
  prohibited = false,
): ArchitectureDiagramEdge => ({
  id,
  source,
  target,
  label: type,
  type,
  phases: ['mvp'],
  decisionIds: [],
  ...(prohibited ? { prohibited: true } : {}),
});

const fixture = {
  nodes: [
    makeNode('node.mvp.core-api', 'service', ['mvp'], 'service.mail'),
    makeNode('node.context.resend', 'provider'),
    makeNode('node.context.user', 'actor'),
  ],
  edges: [
    makeEdge('edge.mail.resend.one', 'node.mvp.core-api', 'node.context.resend'),
    makeEdge('edge.mail.resend.two', 'node.mvp.core-api', 'node.context.resend'),
    makeEdge('edge.user.mail', 'node.context.user', 'node.mvp.core-api', 'dependency'),
    makeEdge(
      'edge.user.mail.blocked',
      'node.context.user',
      'node.mvp.core-api',
      'dependency',
      true,
    ),
  ],
} satisfies Pick<ArchitectureDiagramDefinition, 'nodes' | 'edges'>;

describe('whole architecture presentation projection', () => {
  test('projects filtered real whole architecture with complete canonical coverage', () => {
    const whole = composeWholeArchitecture(architectureDiagrams);
    const filtered = filterDiagram(whole, {
      phase: 'mvp',
      relationTypes: [],
      query: '',
    });
    const projection = projectWholeDiagram(filtered);

    expect(projection.expandedDomain).toBeUndefined();
    expect(projection.nodes.every((node) => node.kind === 'domain')).toBe(true);
    expect(
      projection.nodes.reduce(
        (total, node) => (node.kind === 'domain' ? total + node.canonicalNodeCount : total),
        0,
      ),
    ).toBe(filtered.nodes.length);
    expect(
      new Set(
        projection.nodes.flatMap((node) => (node.kind === 'domain' ? node.canonicalNodeIds : [])),
      ).size,
    ).toBe(filtered.nodes.length);
    expect(projection.edges.every((edge) => edge.source !== edge.target)).toBe(true);
    expect(projection.edges.every((edge) => edge.canonicalEdgeIds.length === edge.count)).toBe(
      true,
    );
  });

  test('uses the domain layer for mixed-layer domain members', () => {
    const projection = projectWholeDiagram({
      nodes: [
        makeNode('mail-flow.browser', 'actor'),
        makeNode('node.mvp.core-api', 'service', ['mvp'], 'service.mail'),
      ],
      edges: [],
    });
    const mailDomain = projection.nodes.find(
      (node) => node.kind === 'domain' && node.domain === 'mail-delivery',
    );

    expect(mailDomain?.layer).toBe('product');
  });

  test('aggregates stable inter-domain edges by relation and prohibition', () => {
    const first = projectWholeDiagram(fixture);
    const second = projectWholeDiagram({
      nodes: [...fixture.nodes].reverse(),
      edges: [...fixture.edges].reverse(),
    });

    expect(second).toEqual(first);
    expect(first.edges).toHaveLength(3);

    const providerEdge = first.edges.find(
      (edge) => edge.type === 'provider_call' && edge.prohibited === false,
    );
    expect(providerEdge).toMatchObject({
      source: 'domain.mail-delivery',
      target: 'domain.external-providers',
      count: 2,
      canonicalEdgeIds: ['edge.mail.resend.one', 'edge.mail.resend.two'],
    });
    expect(providerEdge?.sourceDiagramIds).toBeUndefined();
    expect(first.edges.find((edge) => edge.prohibited)?.canonicalEdgeIds).toEqual([
      'edge.user.mail.blocked',
    ]);
  });

  test('expands one domain while keeping external traffic at domain boundaries', () => {
    const projection = projectWholeDiagram(fixture, { expandedDomain: 'mail-delivery' });
    const expanded = projection.nodes.find(
      (node) => node.kind === 'domain' && node.domain === 'mail-delivery',
    );
    const entity = projection.nodes.find(
      (node) => node.kind === 'entity' && node.canonicalNodeId === 'node.mvp.core-api',
    );

    expect(projection.expandedDomain).toBe('mail-delivery');
    if (expanded?.kind !== 'domain') throw new Error('Expected expanded domain node');
    expect(expanded.expanded).toBe(true);
    expect(entity?.id).toBe('node.mvp.core-api');
    expect(
      projection.edges.some((edge) => edge.source === entity?.id || edge.target === entity?.id),
    ).toBe(false);
    expect(projection.edges.some((edge) => edge.source === 'domain.mail-delivery')).toBe(true);
    expect(projection.edges.some((edge) => edge.target === 'domain.mail-delivery')).toBe(true);
  });

  test('keeps focused projection flat and provenance intact', () => {
    const projection = projectFocusedDiagram(fixture);

    expect(projection.nodes.map((node) => node.id)).toEqual(
      fixture.nodes.map((node) => node.id).sort(),
    );
    expect(projection.edges.map((edge) => edge.id)).toEqual(
      fixture.edges.map((edge) => edge.id).sort(),
    );
  });
});
