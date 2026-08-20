import { readFile } from 'node:fs/promises';

import { describe, expect, test } from 'bun:test';

import { parseBaselineText } from '../../src/domain/architecture/baseline/parse';
import {
  compileSemanticAnnotations,
  SemanticCompilationError,
} from '../../src/domain/architecture/baseline/semantic';
import { BaselineBlockIdSchema, DecisionIdSchema } from '../../src/domain/architecture/ids';

const baselinePath = new URL('../../docs/architecture/architectureBaseline.md', import.meta.url);
const sourcePath = 'docs/architecture/architectureBaseline.md';

const fixture = `# Baseline

## 1. Context

Context paragraph.

### Detail

Detail paragraph.

## 2. Operations

Operations paragraph.
`;

function parseFixture() {
  return parseBaselineText(fixture, { sourcePath: 'fixture.md' });
}

function wholeRange(endLine: number) {
  return { startLine: 1, endLine };
}

describe('baseline semantic annotation compiler', () => {
  test('classifies every real-baseline section and block from one structural rule', async () => {
    const sourceText = await readFile(baselinePath, 'utf8');
    const parsed = parseBaselineText(sourceText, { sourcePath });
    const compiled = compileSemanticAnnotations(parsed, {
      rules: [
        {
          id: 'rule.baseline.whole',
          kind: 'range',
          range: wholeRange(parsed.version.lines),
          annotation: { classification: 'classified' },
        },
      ],
      catalog: {
        decisionIds: [],
        serviceIds: [],
        stackIds: [],
        gateIds: [],
        diagramIds: [],
      },
    });

    expect(compiled.sections).toHaveLength(parsed.sections.length);
    expect(compiled.blocks).toHaveLength(parsed.blocks.length);
    expect(compiled.coverage).toHaveLength(parsed.sections.length + parsed.blocks.length);
    expect(compiled.audit.missingTargets).toEqual([]);
    expect(compiled.audit.overlappingTargets).toEqual([]);
    expect(compiled.coverage.every((record) => record.classification === 'classified')).toBe(true);
    expect(compiled.blocks.every((block) => block.sourceAnchor.source === sourcePath)).toBe(true);
  });

  test('applies section rules to descendant sections and blocks', () => {
    const parsed = parseFixture();
    const root = parsed.sections.find((section) => section.level === 2);
    const child = parsed.sections.find((section) => section.level === 3);
    const operations = parsed.sections.find(
      (section) => section.level === 2 && section.id !== root?.id,
    );
    if (!root) throw new Error('fixture root missing');
    if (!child) throw new Error('fixture child missing');
    if (!operations) throw new Error('fixture operations missing');

    const compiled = compileSemanticAnnotations(parsed, {
      rules: [
        {
          id: 'rule.section.context',
          kind: 'section',
          sectionId: root.id,
          annotation: { classification: 'classified' },
        },
        {
          id: 'rule.section.operations',
          kind: 'section',
          sectionId: operations.id,
          annotation: { classification: 'classified' },
        },
        {
          id: 'rule.range.preamble',
          kind: 'range',
          range: { startLine: 1, endLine: 1 },
          annotation: { classification: 'not_applicable' },
        },
      ],
    });

    expect(compiled.sections.filter((section) => section.sectionId === root.id)).toHaveLength(1);
    expect(compiled.blocks.filter((block) => block.sectionId === root.id)).toHaveLength(1);
    expect(compiled.blocks.filter((block) => block.sectionId === child.id)).toHaveLength(1);
    expect(compiled.sections.some((section) => section.parentId === root.id)).toBe(true);
    expect(compiled.sections.some((section) => section.sectionId === operations.id)).toBe(true);
    expect(compiled.audit.missingTargets).toEqual([]);
  });

  test('fails when a section or range rule overlaps another non-override rule', () => {
    const parsed = parseFixture();
    const root = parsed.sections.find((section) => section.level === 2);
    if (!root) throw new Error('fixture root missing');

    expect(() =>
      compileSemanticAnnotations(parsed, {
        rules: [
          {
            id: 'rule.section.context',
            kind: 'section',
            sectionId: root.id,
            annotation: { classification: 'classified' },
          },
          {
            id: 'rule.range.whole',
            kind: 'range',
            range: wholeRange(parsed.version.lines),
            annotation: { classification: 'partially_classified' },
          },
        ],
      }),
    ).toThrow(SemanticCompilationError);
    expect(() =>
      compileSemanticAnnotations(parsed, {
        rules: [
          {
            id: 'rule.section.context',
            kind: 'section',
            sectionId: root.id,
            annotation: { classification: 'classified' },
          },
          {
            id: 'rule.range.whole',
            kind: 'range',
            range: wholeRange(parsed.version.lines),
            annotation: { classification: 'partially_classified' },
          },
        ],
      }),
    ).toThrow(/overlapping semantic assignments/u);
  });

  test('fails when a parsed target has no semantic assignment', () => {
    const parsed = parseFixture();
    const root = parsed.sections.find((section) => section.level === 2);
    if (!root) throw new Error('fixture root missing');

    expect(() =>
      compileSemanticAnnotations(parsed, {
        rules: [
          {
            id: 'rule.section.context',
            kind: 'section',
            sectionId: root.id,
            annotation: { classification: 'classified' },
          },
        ],
      }),
    ).toThrow(/missing semantic assignment/u);
  });

  test('allows one explicit override and preserves its parser anchor', () => {
    const parsed = parseFixture();
    const target = parsed.blocks.find((block) => block.content === 'Detail paragraph.');
    if (!target) throw new Error('fixture target missing');
    const decisionId = DecisionIdSchema.parse('decision.context.detail');

    const compiled = compileSemanticAnnotations(parsed, {
      rules: [
        {
          id: 'rule.range.whole',
          kind: 'range',
          range: wholeRange(parsed.version.lines),
          annotation: { classification: 'classified' },
        },
        {
          id: 'rule.override.detail',
          kind: 'override',
          target: { kind: 'block', blockId: target.id },
          annotation: {
            classification: 'partially_classified',
            decisionIds: [decisionId],
          },
        },
      ],
      catalog: {
        decisionIds: [decisionId],
        serviceIds: [],
        stackIds: [],
        gateIds: [],
        diagramIds: [],
      },
    });

    const compiledTarget = compiled.blocks.find((block) => block.blockId === target.id);
    expect(compiledTarget?.classification).toBe('partially_classified');
    expect(compiledTarget?.decisionIds).toEqual([decisionId]);
    expect(compiledTarget?.sourceAnchor).toEqual(target.sourceAnchor);
  });

  test('fails unknown references and unknown rule targets', () => {
    const parsed = parseFixture();
    const unknownDecision = DecisionIdSchema.parse('decision.unknown.reference');

    expect(() =>
      compileSemanticAnnotations(parsed, {
        rules: [
          {
            id: 'rule.range.unknown-reference',
            kind: 'range',
            range: wholeRange(parsed.version.lines),
            annotation: { classification: 'classified', decisionIds: [unknownDecision] },
          },
        ],
      }),
    ).toThrow(/unknown decision reference/u);

    expect(() =>
      compileSemanticAnnotations(parsed, {
        rules: [
          {
            id: 'rule.override.missing',
            kind: 'override',
            target: {
              kind: 'block',
              blockId: BaselineBlockIdSchema.parse('baseline.missing.block'),
            },
            annotation: { classification: 'classified' },
          },
        ],
      }),
    ).toThrow(/unknown override target/u);
  });
});
