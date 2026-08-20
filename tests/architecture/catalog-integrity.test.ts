import { readFile } from 'node:fs/promises';

import { describe, expect, test } from 'bun:test';

import { buildArchitectureCatalog } from '../../src/data/architecture/catalog/buildCatalog';
import { capabilityShard } from '../../src/data/architecture/catalog/capabilityShard';
import { coreShard } from '../../src/data/architecture/catalog/coreShard';
import { platformShard } from '../../src/data/architecture/catalog/platformShard';
import { validateArchitectureRegistry } from '../../src/domain/architecture';

const baselinePath = new URL('../../docs/architecture/architectureBaseline.md', import.meta.url);

describe('complete architecture catalog', () => {
  test('maps the complete baseline into a referentially valid registry', async () => {
    const sourceText = await readFile(baselinePath, 'utf8');
    const registry = buildArchitectureCatalog(sourceText, [
      coreShard,
      capabilityShard,
      platformShard,
    ]);
    const report = validateArchitectureRegistry(registry);

    expect(registry.decisions.length).toBeGreaterThanOrEqual(120);
    expect(registry.services.length).toBeGreaterThanOrEqual(13);
    expect(registry.baselineSections).toHaveLength(101);
    expect(registry.baselineBlocks).toHaveLength(1856);
    expect(registry.coverage).toHaveLength(1957);
    expect(registry.coverage.every((record) => record.decisionIds.length > 0)).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });
});
