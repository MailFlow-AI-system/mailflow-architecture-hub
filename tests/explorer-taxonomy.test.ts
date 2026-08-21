import { describe, expect, test } from 'bun:test';

import { architectureDiagrams, composeWholeArchitecture } from '../src/data/architecture/diagrams';
import {
  architectureDomains,
  architectureLayers,
  classifyArchitectureNode,
  classifyArchitectureNodes,
} from '../src/components/explorer/presentation/wholeArchitectureTaxonomy';

const wholeArchitecture = composeWholeArchitecture(architectureDiagrams);

describe('whole architecture presentation taxonomy', () => {
  test('classifies every phase-visible canonical node exactly once', () => {
    for (const phase of wholeArchitecture.phases) {
      const visibleNodes = wholeArchitecture.nodes.filter((node) => node.phases.includes(phase));
      const classifications = classifyArchitectureNodes(visibleNodes);

      expect(classifications).toHaveLength(visibleNodes.length);
      expect(new Set(classifications.map(({ node }) => node.id)).size).toBe(visibleNodes.length);

      for (const { classification } of classifications) {
        expect(architectureLayers).toContain(classification.layer);
        expect(architectureDomains).toContain(classification.domain);
      }
    }
  });

  test('uses stable ID and service rules instead of labels or descriptions', () => {
    const gateway = wholeArchitecture.nodes.find((node) => node.id === 'node.context.gateway');
    const coreApi = wholeArchitecture.nodes.find((node) => node.id === 'node.mvp.core-api');
    const provider = wholeArchitecture.nodes.find((node) => node.id === 'node.infra.resend');

    if (!gateway || !coreApi || !provider) {
      throw new Error('Expected representative whole-architecture nodes to exist');
    }

    expect(
      classifyArchitectureNode({
        ...gateway,
        label: 'Misleading label',
        description: 'Misleading description',
      }),
    ).toEqual({ layer: 'edge-security', domain: 'edge-security' });
    expect(classifyArchitectureNode(coreApi)).toEqual({
      layer: 'product',
      domain: 'mail-delivery',
    });
    expect(classifyArchitectureNode(provider)).toEqual({
      layer: 'providers',
      domain: 'external-providers',
    });
  });

  test('is deterministic for repeated classification', () => {
    const first = classifyArchitectureNodes(wholeArchitecture.nodes);
    const second = classifyArchitectureNodes(wholeArchitecture.nodes);

    expect(second).toEqual(first);
  });
});
