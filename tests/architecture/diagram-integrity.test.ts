import { describe, expect, test } from 'bun:test';

import {
  architectureRegistry,
  baselineSourcePath,
  baselineSourceText,
} from '../../src/data/architecture/catalog';
import { architectureDiagrams } from '../../src/data/architecture/diagrams';
import { validateArchitectureDiagrams } from '../../src/data/architecture/diagrams/validateDiagrams';
import {
  coverageWithDiagrams,
  decisionToDiagramIds,
} from '../../src/data/architecture/traceability';

describe('architecture diagram integrity', () => {
  test('keeps every view traceable and internally connected', () => {
    const report = validateArchitectureDiagrams(
      architectureDiagrams,
      architectureRegistry,
      baselineSourceText,
      baselineSourcePath,
    );

    expect(architectureDiagrams.length).toBeGreaterThanOrEqual(30);
    expect(architectureDiagrams.every((diagram) => diagram.nodes.length > 0)).toBe(true);
    expect(architectureDiagrams.every((diagram) => diagram.edges.length > 0)).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
    const reverseLinkedDiagramIds = new Set([...decisionToDiagramIds.values()].flat());
    expect(architectureDiagrams.every((diagram) => reverseLinkedDiagramIds.has(diagram.id))).toBe(
      true,
    );
    expect(coverageWithDiagrams).toHaveLength(architectureRegistry.coverage.length);
    expect(architectureRegistry.relationships).toHaveLength(
      architectureDiagrams.reduce((total, diagram) => total + diagram.edges.length, 0),
    );
  });

  test('rejects a future-only decision projected into an MVP-only view', () => {
    const futureDecision = architectureRegistry.decisions.find(
      (decision) => decision.phase === 'future',
    );
    const mvpDiagram = architectureDiagrams.find(
      (diagram) => diagram.phases.length === 1 && diagram.phases[0] === 'mvp',
    );
    if (!futureDecision || !mvpDiagram) throw new Error('phase fixtures missing');
    const invalid = structuredClone(mvpDiagram);
    invalid.decisionIds = [futureDecision.id];

    const report = validateArchitectureDiagrams(
      [invalid],
      architectureRegistry,
      baselineSourceText,
      baselineSourcePath,
    );

    expect(report.errors.some((error) => error.message.includes('future'))).toBe(true);
  });
});
