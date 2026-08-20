import { describe, expect, test } from 'bun:test';

import { architectureRegistry } from '../../src/data/architecture/catalog';
import { architectureDiagrams } from '../../src/data/architecture/diagrams';
import { validateArchitectureDiagrams } from '../../src/data/architecture/diagrams/validateDiagrams';

describe('architecture diagram integrity', () => {
  test('keeps every view traceable and internally connected', () => {
    const report = validateArchitectureDiagrams(architectureDiagrams, architectureRegistry);

    expect(architectureDiagrams.length).toBeGreaterThanOrEqual(30);
    expect(architectureDiagrams.every((diagram) => diagram.nodes.length > 0)).toBe(true);
    expect(architectureDiagrams.every((diagram) => diagram.edges.length > 0)).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });
});
