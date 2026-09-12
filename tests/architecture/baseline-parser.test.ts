import { readFile } from 'node:fs/promises';

import { describe, expect, test } from 'bun:test';

import {
  compareBlockDigests,
  mergeSemanticAnnotations,
  parseBaselineText,
} from '../../src/domain/architecture/baseline';

const baselinePath = new URL('../../docs/architecture/architectureBaseline.md', import.meta.url);

const fixture = `# MailFlow Architecture Baseline

Status: approved
Last updated: 2026-08-20

Introductory paragraph.

## 1. Context

Context paragraph.

### Shared boundary

- First item
  Continuation line.
- Second item

| Column | Value |
| --- | --- |
| one | two |

\`\`\`text
example
\`\`\`

Primary references:

- [Reference](https://example.com/reference)

#### Detail

Detail paragraph.

## 2. Context

Repeated heading paragraph.

### Shared boundary

Repeated child paragraph.
`;

describe('deterministic baseline parser', () => {
  test('parses the real baseline without losing source lines', async () => {
    const sourceText = await readFile(baselinePath, 'utf8');
    const parsed = parseBaselineText(sourceText, {
      sourcePath: 'docs/architecture/architectureBaseline.md',
    });

    expect(parsed.sourceText).toBe(sourceText);
    expect(parsed.version.bytes).toBe(364047);
    expect(parsed.version.lines).toBe(2609);
    expect(parsed.version.checksum).toBe(
      '22486b0560ff42fd63b42475df9ec98fb4315175ccc41a51ad238a814c2bbea4',
    );
    expect(parsed.sections.filter((section) => section.level === 2)).toHaveLength(22);
    expect(parsed.audit.unassignedMeaningfulLines).toEqual([]);
    expect(parsed.audit.assignedMeaningfulLines).toBe(parsed.audit.meaningfulLineCount);
    expect(parsed.blocks.every((block) => block.coverageClassification === 'not_classified')).toBe(
      true,
    );
  });

  test('models nested heading paths and exact hierarchical ranges', () => {
    const parsed = parseBaselineText(fixture, { sourcePath: 'fixture.md' });
    const detail = parsed.sections.find((section) => section.title === 'Detail');
    const child = parsed.sections.find(
      (section) => section.title === 'Shared boundary' && section.level === 3,
    );
    const firstRoot = parsed.sections.find((section) => section.level === 2);

    expect(String(firstRoot?.id)).toBe('baseline.context');
    expect(firstRoot?.lineRange).toEqual({ startLine: 8, endLine: 33 });
    expect(child?.headingPath).toEqual(['1. Context', 'Shared boundary']);
    expect(child?.parentId).toBe(firstRoot?.id);
    expect(detail?.headingPath).toEqual(['1. Context', 'Shared boundary', 'Detail']);
    expect(detail?.lineRange).toEqual({ startLine: 30, endLine: 33 });
  });

  test('classifies structural blocks, including title, metadata, lists, tables, code, and references', () => {
    const parsed = parseBaselineText(fixture, { sourcePath: 'fixture.md' });
    const kinds = parsed.blocks.map((block) => block.kind);

    expect(kinds).toContain('document_title');
    expect(kinds).toContain('document_metadata');
    expect(kinds).toContain('preamble');
    expect(kinds).toContain('list_item');
    expect(kinds).toContain('table');
    expect(kinds).toContain('code');
    expect(kinds).toContain('primary_reference');
    expect(parsed.blocks.every((block) => block.sourceAnchor.digest.value.length === 64)).toBe(
      true,
    );
    expect(parsed.audit.unassignedMeaningfulLines).toEqual([]);
  });

  test('handles duplicate headings with deterministic collision suffixes', () => {
    const parsed = parseBaselineText(fixture, { sourcePath: 'fixture.md' });
    const roots = parsed.sections.filter((section) => section.level === 2);
    const children = parsed.sections.filter(
      (section) => section.level === 3 && section.title === 'Shared boundary',
    );

    expect(roots.map((section) => String(section.id))).toEqual([
      'baseline.context',
      'baseline.context-2',
    ]);
    expect(children.map((section) => String(section.id))).toEqual([
      'baseline.context.shared-boundary',
      'baseline.context-2.shared-boundary',
    ]);
    expect(parsed.audit.duplicateIds).toEqual(['baseline.context']);
    expect(parsed.audit.identityCollisions).toEqual([
      { identityKey: 'h2:2. Context', assignedId: 'baseline.context-2' },
    ]);
  });

  test('detects changed block digests while preserving identity keys', () => {
    const original = parseBaselineText(fixture, { sourcePath: 'fixture.md' });
    const changed = parseBaselineText(fixture.replace('Context paragraph.', 'Changed paragraph.'), {
      sourcePath: 'fixture.md',
    });
    const changes = compareBlockDigests(original, changed);
    const changedBlock = changes.find((change) => change.kind === 'changed');

    expect(changedBlock?.identityKey).toBe('block:baseline.context:paragraph:1');
    expect(changedBlock?.previousDigest).not.toBe(changedBlock?.currentDigest);
    expect(changes.some((change) => change.kind === 'added')).toBe(false);
    expect(changes.some((change) => change.kind === 'removed')).toBe(false);
  });

  test('merges semantic annotations without rewriting baseline source', () => {
    const parsed = parseBaselineText(fixture, { sourcePath: 'fixture.md' });
    const paragraph = parsed.blocks.find((block) => block.content === 'Context paragraph.');
    if (!paragraph) throw new Error('fixture paragraph missing');

    const annotated = mergeSemanticAnnotations(parsed, [
      { targetId: paragraph.id, classification: 'classified', labels: ['context'] },
    ]);

    expect(annotated.sourceText).toBe(parsed.sourceText);
    expect(
      annotated.blocks.find((block) => block.id === paragraph.id)?.coverageClassification,
    ).toBe('classified');
    expect(annotated.blocks.find((block) => block.id === paragraph.id)?.labels).toEqual([
      'context',
    ]);
    expect(parsed.blocks.find((block) => block.id === paragraph.id)?.coverageClassification).toBe(
      'not_classified',
    );
  });
});
