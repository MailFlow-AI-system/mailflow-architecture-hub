import { describe, expect, test } from 'bun:test';

import { buildArchitectureCatalog } from '../../src/data/architecture/catalog/buildCatalog';
import type { ArchitectureShard } from '../../src/data/architecture/catalog/types';

const source = `# Baseline

## Topic

- A decision.
`;

const shard: ArchitectureShard = {
  id: 'shard.fixture',
  sourceRange: { startLine: 1, endLine: 5 },
  decisions: [
    {
      id: 'decision.fixture.choice',
      title: 'Fixture choice',
      status: 'confirmed',
      phase: 'mvp',
      summary: 'Use the fixture choice.',
      sourceRanges: [{ startLine: 5, endLine: 5 }],
    },
  ],
  services: [],
  stacks: [],
  gates: [],
  trustBoundaries: [],
};

describe('architecture catalog builder', () => {
  test('builds traceable decisions and complete block coverage from source ranges', () => {
    const catalog = buildArchitectureCatalog(source, [shard], 'fixture.md');

    expect(catalog.decisions).toHaveLength(1);
    expect(catalog.decisions[0]?.sourceAnchors[0]?.range).toEqual({ startLine: 5, endLine: 5 });
    expect(catalog.decisions[0]?.narrative.evidence.items).toEqual(['- A decision.']);
    expect(catalog.baselineBlocks.every((block) => block.classification === 'classified')).toBe(
      true,
    );
    expect(catalog.coverage.every((record) => record.decisionIds.length > 0)).toBe(true);
  });

  test('rejects duplicate entity IDs and source ranges outside a shard', () => {
    expect(() => buildArchitectureCatalog(source, [shard, shard], 'fixture.md')).toThrow(
      /duplicate shard or entity ID/u,
    );

    const invalid = structuredClone(shard);
    invalid.id = 'shard.invalid';
    const invalidDecision = invalid.decisions[0];
    if (!invalidDecision) throw new Error('fixture decision missing');
    invalidDecision.id = 'decision.fixture.outside';
    invalidDecision.sourceRanges = [{ startLine: 6, endLine: 6 }];
    expect(() => buildArchitectureCatalog(source, [invalid], 'fixture.md')).toThrow(
      /outside shard/u,
    );
  });
});
