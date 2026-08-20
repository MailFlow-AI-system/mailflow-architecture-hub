import { describe, expect, test } from 'bun:test';

import { parseMarkdownBlocks } from '../../src/domain/architecture/markdown';

describe('safe architecture markdown parser', () => {
  test('turns baseline headings, paragraphs, lists, and tables into structured blocks', () => {
    const blocks = parseMarkdownBlocks(`# Context

A **documented** choice with \`workspace_id\`.

- First item
  continuation.
- Second item

| Boundary | Owner |
| --- | --- |
| Tenant | Identity |`);

    expect(blocks).toEqual([
      { type: 'heading', level: 1, content: [{ type: 'text', value: 'Context' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', value: 'A ' },
          { type: 'strong', content: [{ type: 'text', value: 'documented' }] },
          { type: 'text', value: ' choice with ' },
          { type: 'code', value: 'workspace_id' },
          { type: 'text', value: '.' },
        ],
      },
      {
        type: 'unordered-list',
        items: [
          [{ type: 'text', value: 'First item continuation.' }],
          [{ type: 'text', value: 'Second item' }],
        ],
      },
      {
        type: 'table',
        header: [[{ type: 'text', value: 'Boundary' }], [{ type: 'text', value: 'Owner' }]],
        rows: [[[{ type: 'text', value: 'Tenant' }], [{ type: 'text', value: 'Identity' }]]],
      },
    ]);
  });

  test('supports links and fenced code while leaving raw HTML inert', () => {
    const blocks = parseMarkdownBlocks(
      '> Review [the contract](https://example.com/contracts).\n\n```text\n<script>alert(1)</script>\n```',
    );

    expect(blocks).toEqual([
      {
        type: 'blockquote',
        content: [
          { type: 'text', value: 'Review ' },
          {
            type: 'link',
            label: [{ type: 'text', value: 'the contract' }],
            href: 'https://example.com/contracts',
          },
          { type: 'text', value: '.' },
        ],
      },
      { type: 'code-block', language: 'text', value: '<script>alert(1)</script>' },
    ]);
  });

  test('does not create unsafe links or unsafe HTML nodes', () => {
    const blocks = parseMarkdownBlocks('[run](javascript:alert(1)) <script>alert(1)</script>');

    expect(blocks).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', value: '[run](javascript:alert(1)) <script>alert(1)</script>' }],
      },
    ]);
    expect(blocks[0]?.type).toBe('paragraph');
    expect(blocks[0]?.type === 'paragraph' && blocks[0].content).not.toContainEqual(
      expect.objectContaining({ type: 'link' }),
    );
  });
});
