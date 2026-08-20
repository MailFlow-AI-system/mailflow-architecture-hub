import { describe, expect, test } from 'bun:test';

import { buildArchitectureCatalog } from '../../src/data/architecture/catalog/buildCatalog';
import { assertBaselineFingerprint } from '../../src/data/architecture/catalog/baselineFingerprint';
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
  test('rejects baseline content that differs from its recorded fingerprint', () => {
    const source = '# Baseline\n\nArchitecture content.\n';
    const actual = assertBaselineFingerprint(source, 'docs/baseline.md', {
      source: 'docs/baseline.md',
      checksum: {
        algorithm: 'sha256',
        value: '5a9162663d80f1d64826ab74fb42d9d89025fb899d178e6eef46eac0a6e5f871',
      },
      bytes: 34,
      lines: 3,
      words: 4,
    });
    expect(actual.lines).toBe(3);
    expect(() =>
      assertBaselineFingerprint(`${source}changed`, 'docs/baseline.md', {
        source: 'docs/baseline.md',
        checksum: { algorithm: 'sha256', value: actual.checksum },
        bytes: actual.bytes,
        lines: actual.lines,
        words: actual.words,
      }),
    ).toThrow('Baseline fingerprint drift detected');
  });
  test('builds traceable decisions and complete block coverage from source ranges', () => {
    const catalog = buildArchitectureCatalog(source, [shard], 'fixture.md');

    expect(catalog.decisions).toHaveLength(1);
    expect(catalog.decisions[0]?.sourceAnchors[0]?.range).toEqual({ startLine: 5, endLine: 5 });
    expect(catalog.decisions[0]?.narrative.evidence.items).toEqual(['- A decision.']);
    expect(catalog.baselineBlocks.at(-1)?.classification).toBe('classified');
    expect(
      catalog.coverage
        .find((record) => record.blockId === catalog.baselineBlocks.at(-1)?.id)
        ?.decisionIds.map(String),
    ).toEqual(['decision.fixture.choice']);
    expect(
      catalog.coverage.some(
        (record) => record.decisionIds.length === 0 && record.classification === 'not_applicable',
      ),
    ).toBe(true);
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
