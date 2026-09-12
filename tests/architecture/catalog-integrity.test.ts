import { readFile } from 'node:fs/promises';

import { describe, expect, test } from 'bun:test';

import { buildArchitectureCatalog } from '../../src/data/architecture/catalog/buildCatalog';
import { capabilityShard } from '../../src/data/architecture/catalog/capabilityShard';
import { coreShard } from '../../src/data/architecture/catalog/coreShard';
import { platformShard } from '../../src/data/architecture/catalog/platformShard';
import { architectureDiagrams } from '../../src/data/architecture/diagrams';
import { validateArchitectureRegistry } from '../../src/domain/architecture';

const baselinePath = new URL('../../docs/architecture/architectureBaseline.md', import.meta.url);

describe('complete architecture catalog', () => {
  test('maps the complete baseline into a referentially valid registry', async () => {
    const sourceText = await readFile(baselinePath, 'utf8');
    const registry = buildArchitectureCatalog(
      sourceText,
      [coreShard, capabilityShard, platformShard],
      'docs/architecture/architectureBaseline.md',
      architectureDiagrams,
    );
    const report = validateArchitectureRegistry(registry);

    expect(registry.decisions.length).toBeGreaterThanOrEqual(120);
    expect(registry.services.length).toBeGreaterThanOrEqual(13);
    expect(registry.baselineSections).toHaveLength(103);
    expect(registry.baselineBlocks).toHaveLength(1857);
    expect(registry.coverage).toHaveLength(1960);
    expect(registry.diagrams).toHaveLength(architectureDiagrams.length);
    expect(registry.relationships.length).toBeGreaterThanOrEqual(250);
    expect(registry.coverage.every((record) => record.pageRoutes.length > 0)).toBe(true);
    expect(registry.coverage.some((record) => record.decisionIds.length === 0)).toBe(true);
    expect(registry.decisions.some((decision) => decision.diagramIds.length > 0)).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
    expect(
      registry.services.every(
        (service) => service.owner.kind === 'service' && service.owner.id === service.id,
      ),
    ).toBe(true);
  });
});
