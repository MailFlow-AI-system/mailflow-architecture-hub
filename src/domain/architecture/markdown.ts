/**
 * Small, data-only Markdown projection used for baseline excerpts.
 *
 * It intentionally supports the syntax used by the architecture baseline instead of
 * rendering arbitrary HTML. The Astro component consumes this tree with escaped text
 * interpolation, so source content cannot become executable markup.
 */

export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; content: MarkdownInline[] }
  | { type: 'emphasis'; content: MarkdownInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; label: MarkdownInline[]; href: string };

export type MarkdownBlock =
  | { type: 'heading'; level: number; content: MarkdownInline[] }
  | { type: 'paragraph'; content: MarkdownInline[] }
  | { type: 'blockquote'; content: MarkdownInline[] }
  | { type: 'unordered-list'; items: MarkdownInline[][] }
  | { type: 'ordered-list'; items: MarkdownInline[][] }
  | { type: 'table'; header: MarkdownInline[][]; rows: MarkdownInline[][][] }
  | { type: 'code-block'; language: string; value: string }
  | { type: 'thematic-break' };

const headingPattern = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/u;
const listPattern = /^( {0,3})([-+*]|\d+[.)])[ \t]+(.+)$/u;
const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const blockquotePattern = /^ {0,3}>[ \t]?(.*)$/u;
const tableRowPattern = /^\s*\|.*\|\s*$/u;
const tableSeparatorPattern = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u;
const thematicBreakPattern = /^ {0,3}(?:\*\s*){3,}$|^ {0,3}(?:-\s*){3,}$|^ {0,3}(?:_\s*){3,}$/u;

function safeHref(value: string): string | undefined {
  const href = value.trim();
  if (/^https?:\/\//iu.test(href)) return href;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  if (href.startsWith('#')) return href;
  return undefined;
}

function pushText(nodes: MarkdownInline[], value: string): void {
  if (!value) return;
  const previous = nodes.at(-1);
  if (previous?.type === 'text') {
    previous.value += value;
  } else {
    nodes.push({ type: 'text', value });
  }
}

export function parseMarkdownInline(source: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let index = 0;

  while (index < source.length) {
    if (source.startsWith('**', index)) {
      const end = source.indexOf('**', index + 2);
      if (end > index + 2) {
        nodes.push({ type: 'strong', content: parseMarkdownInline(source.slice(index + 2, end)) });
        index = end + 2;
        continue;
      }
    }

    if (source[index] === '`') {
      const end = source.indexOf('`', index + 1);
      if (end > index + 1) {
        nodes.push({ type: 'code', value: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (source[index] === '[') {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)/u.exec(source.slice(index));
      const href = linkMatch ? safeHref(linkMatch[2]) : undefined;
      if (linkMatch && href) {
        nodes.push({ type: 'link', label: parseMarkdownInline(linkMatch[1]), href });
        index += linkMatch[0].length;
        continue;
      }
    }

    if (source[index] === '*' || source[index] === '_') {
      const marker = source[index];
      const end = source.indexOf(marker, index + 1);
      if (end > index + 1 && !source.startsWith(marker.repeat(2), index)) {
        nodes.push({
          type: 'emphasis',
          content: parseMarkdownInline(source.slice(index + 1, end)),
        });
        index = end + 1;
        continue;
      }
    }

    pushText(nodes, source[index] ?? '');
    index += 1;
  }

  return nodes;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  return trimmed.split('|').map((cell) => cell.trim().replaceAll('\\|', '|'));
}

function parseTable(
  lines: string[],
  start: number,
): { block: MarkdownBlock; next: number } | undefined {
  const headerLine = lines[start];
  const separatorLine = lines[start + 1];
  if (
    !headerLine ||
    !separatorLine ||
    !tableRowPattern.test(headerLine) ||
    !tableSeparatorPattern.test(separatorLine)
  ) {
    return undefined;
  }

  const headerCells = splitTableRow(headerLine);
  const rows: MarkdownInline[][][] = [];
  let next = start + 2;
  while (next < lines.length && tableRowPattern.test(lines[next] ?? '')) {
    const cells = splitTableRow(lines[next] ?? '');
    rows.push(headerCells.map((_, index) => parseMarkdownInline(cells[index] ?? '')));
    next += 1;
  }

  return {
    block: {
      type: 'table',
      header: headerCells.map((cell) => parseMarkdownInline(cell)),
      rows,
    },
    next,
  };
}

function parseList(lines: string[], start: number): { block: MarkdownBlock; next: number } {
  const first = listPattern.exec(lines[start] ?? '');
  if (!first) throw new Error('parseList called for a non-list line');

  const ordered = /^\d/u.test(first[2]);
  const items: MarkdownInline[][] = [];
  let current = first[3];
  let next = start + 1;

  const flush = () => {
    items.push(parseMarkdownInline(current.trim()));
    current = '';
  };

  while (next < lines.length) {
    const line = lines[next] ?? '';
    const match = listPattern.exec(line);
    if (match) {
      const lineIsOrdered = /^\d/u.test(match[2]);
      if (lineIsOrdered !== ordered) break;
      flush();
      current = match[3];
      next += 1;
      continue;
    }

    if (!line.trim()) break;
    if (headingPattern.test(line) || fencePattern.test(line) || tableRowPattern.test(line)) break;
    if (blockquotePattern.test(line)) break;
    current = `${current} ${line.trim()}`;
    next += 1;
  }

  flush();
  return {
    block: ordered ? { type: 'ordered-list', items } : { type: 'unordered-list', items },
    next,
  };
}

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = fencePattern.exec(line);
    if (fence) {
      const marker = fence[1]?.[0] ?? '`';
      const markerLength = fence[1]?.length ?? 3;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length) {
        const candidate = lines[index] ?? '';
        if (new RegExp(`^ {0,3}${marker}{${markerLength},}\\s*$`, 'u').test(candidate)) {
          index += 1;
          break;
        }
        codeLines.push(candidate);
        index += 1;
      }
      blocks.push({
        type: 'code-block',
        language: (fence[2] ?? '').trim().split(/\s+/u)[0] ?? '',
        value: codeLines.join('\n'),
      });
      continue;
    }

    const heading = headingPattern.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1]?.length ?? 1,
        content: parseMarkdownInline(heading[2]?.trim() ?? ''),
      });
      index += 1;
      continue;
    }

    if (thematicBreakPattern.test(line)) {
      blocks.push({ type: 'thematic-break' });
      index += 1;
      continue;
    }

    const table = parseTable(lines, index);
    if (table) {
      blocks.push(table.block);
      index = table.next;
      continue;
    }

    if (listPattern.test(line)) {
      const list = parseList(lines, index);
      blocks.push(list.block);
      index = list.next;
      continue;
    }

    if (blockquotePattern.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const quote = blockquotePattern.exec(lines[index] ?? '');
        if (!quote) break;
        quoteLines.push(quote[1] ?? '');
        index += 1;
      }
      blocks.push({ type: 'blockquote', content: parseMarkdownInline(quoteLines.join(' ')) });
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const candidate = lines[index] ?? '';
      if (
        !candidate.trim() ||
        headingPattern.test(candidate) ||
        fencePattern.test(candidate) ||
        listPattern.test(candidate) ||
        blockquotePattern.test(candidate) ||
        thematicBreakPattern.test(candidate) ||
        parseTable(lines, index)
      ) {
        break;
      }
      paragraphLines.push(candidate.trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', content: parseMarkdownInline(paragraphLines.join(' ')) });
  }

  return blocks;
}
