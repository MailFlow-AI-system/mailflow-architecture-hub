import { describe, expect, test } from 'bun:test';

import { architectureRegistry } from '../../src/data/architecture/catalog';
import { createCoverageManifest } from '../../scripts/architecture/coverageManifest';

describe('coverage manifest', () => {
  test('records complete source references and carries a review-blocking baseline delta', () => {
    const first = architectureRegistry.coverage[0];
    if (!first) throw new Error('coverage fixture missing');
    const key = `${first.sectionId}:${first.blockId ?? 'section'}`;
    const manifest = createCoverageManifest(architectureRegistry, {
      baseline: { checksum: 'previous-baseline' },
      manifest: { checksum: 'previous-manifest' },
      summary: { records: architectureRegistry.coverage.length },
      records: [
        {
          key,
          sourceDigest: 'previous-source',
          review: {
            status: 'human_reviewed',
            reviewedBy: 'Architecture council',
            reviewedAt: '2026-08-19',
            notes: [],
            required: false,
          },
        },
      ],
    });

    const changed = manifest.records.find((record) => record.key === key);
    expect(changed?.baselineRef.source).toBe('docs/architecture/architectureBaseline.md');
    expect(changed?.baselineRef.headingPath.length).toBeGreaterThan(0);
    expect(changed?.baselineRef.range.startLine).toBeGreaterThan(0);
    expect(changed?.review.required).toBe(true);
    expect(changed?.review.status).toBe('machine_classified');
    expect(manifest.delta.changedKeys).toContain(key);
    expect(manifest.delta.unresolvedRecordKeys).toContain(key);
    expect(manifest.manifest.previousManifestChecksum).toBe('previous-manifest');
  });
});
