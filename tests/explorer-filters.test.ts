import { describe, expect, test } from 'bun:test';

import { filterDiagram } from '../src/components/explorer/filterDiagram';
import {
  architectureDiagrams,
  composeWholeArchitecture,
  type ArchitectureDiagramDefinition,
} from '../src/data/architecture/diagrams';

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

  test('keeps post-MVP capabilities and distributed infrastructure out of MVP-only mode', () => {
    const wholeArchitecture = composeWholeArchitecture(architectureDiagrams);
    const result = filterDiagram(wholeArchitecture, {
      phase: 'mvp',
      relationTypes: [],
      query: '',
    });
    const visibleLabels = new Set(result.nodes.map((node) => node.label));
    const visibleServiceIds = new Set(
      result.nodes.flatMap((node) => (node.serviceId ? [node.serviceId] : [])),
    );

    expect(visibleLabels).not.toContain('Billing');
    expect(visibleLabels).not.toContain('Billing service');
    expect(visibleLabels).not.toContain('Stripe Checkout / Portal / Billing');
    expect(visibleLabels).not.toContain('RabbitMQ');
    expect(visibleLabels).not.toContain('Redis');
    expect(visibleLabels).not.toContain('Outbox relay');
    expect(visibleLabels).not.toContain('CredentialCipher');
    expect(visibleLabels).not.toContain('Managed KMS');
    expect(visibleServiceIds).not.toContain('service.gateway-bff');
    expect(visibleServiceIds).not.toContain('service.audience');
    expect(visibleServiceIds).not.toContain('service.campaign');
    expect(visibleServiceIds).not.toContain('service.delivery');
    expect(visibleServiceIds).not.toContain('service.content');
    expect(visibleServiceIds).not.toContain('service.workflow');
    expect(visibleServiceIds).not.toContain('service.automation-runtime');
    expect(visibleServiceIds).not.toContain('service.analytics');
    expect(visibleServiceIds).not.toContain('service.ai');
    expect(visibleServiceIds).not.toContain('service.billing');

    expect(visibleLabels).toContain('Core API');
    expect(visibleLabels).toContain('Core worker');
    expect(visibleLabels).toContain('Canonical PostgreSQL');
    expect(visibleLabels).toContain('pg-boss worker queue');
  });
});
