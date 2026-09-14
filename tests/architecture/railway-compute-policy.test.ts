import { describe, expect, test } from 'bun:test';

import { architectureRegistry } from '../../src/data/architecture/catalog';
import { architectureDiagrams } from '../../src/data/architecture/diagrams';

describe('Railway compute policy', () => {
  test('projects Railway as the accepted backend compute provider', () => {
    const placement = architectureRegistry.decisions.find(
      (decision) => decision.id === 'decision.platform.compute-placement',
    );

    expect(placement?.stackIds?.some((id) => id === 'stack.railway')).toBe(true);
    expect(architectureRegistry.stacks.some((stack) => stack.id === 'stack.railway')).toBe(true);
  });

  test('shows Railway in the MVP topology without presenting a VPS as current compute', () => {
    const mvpNodes = architectureDiagrams
      .filter((diagram) => diagram.phases.length === 1 && diagram.phases[0] === 'mvp')
      .flatMap((diagram) => diagram.nodes);

    expect(mvpNodes.some((node) => node.stackIds?.some((id) => id === 'stack.railway'))).toBe(true);
    expect(mvpNodes.some((node) => node.stackIds?.some((id) => id === 'stack.oci'))).toBe(false);
  });
});
