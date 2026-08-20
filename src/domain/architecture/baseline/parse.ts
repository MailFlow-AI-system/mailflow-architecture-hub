import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { BaselineBlockIdSchema, BaselineSectionIdSchema } from '../ids';
import { createSourceAnchor, createSourceDigest } from '../source';
import {
  BaselineAuditSchema,
  BaselineStructuralBlockKindSchema,
  ParsedBaselineSchema,
  type BaselineBlock,
  type BaselineIdentityMap,
  type BaselineParserOptions,
  type BaselineSection,
  type BaselineVersionMetadata,
  type ParsedBaseline,
} from './types';

const defaultSourcePath = 'docs/architecture/architectureBaseline.md';
const headingPattern = /^(#{1,6})\s+(.+?)\s*$/u;
const listPattern = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/u;
const fencePattern = /^\s*(`{3,}|~{3,})(.*)$/u;
const tableRowPattern = /^\s*\|.*\|\s*$/u;
const tableSeparatorPattern = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u;

type SourceLine = {
  number: number;
  text: string;
  startOffset: number;
  endOffset: number;
};

type HeadingCandidate = {
  line: number;
  level: 2 | 3 | 4;
  title: string;
};

type InternalSection = BaselineSection & {
  identityPath: string[];
};

type IdentityCollision = {
  identityKey: string;
  assignedId: string;
};

function splitSourceLines(sourceText: string): SourceLine[] {
  if (!sourceText) return [];

  const lines: SourceLine[] = [];
  let lineStart = 0;
  let lineNumber = 1;

  for (let index = 0; index < sourceText.length; index += 1) {
    const character = sourceText[index];
    if (character !== '\n' && character !== '\r') continue;

    const endingLength = character === '\r' && sourceText[index + 1] === '\n' ? 2 : 1;
    lines.push({
      number: lineNumber,
      text: sourceText.slice(lineStart, index),
      startOffset: lineStart,
      endOffset: index + endingLength,
    });
    lineNumber += 1;
    index += endingLength - 1;
    lineStart = index + 1;
  }

  if (lineStart < sourceText.length) {
    lines.push({
      number: lineNumber,
      text: sourceText.slice(lineStart),
      startOffset: lineStart,
      endOffset: sourceText.length,
    });
  }

  return lines;
}

function excerptForRange(
  sourceText: string,
  lines: SourceLine[],
  startLine: number,
  endLine: number,
) {
  const first = lines[startLine - 1];
  const last = lines[endLine - 1];
  if (!first || !last) return '';
  return sourceText.slice(first.startOffset, last.endOffset);
}

function slugifyHeading(title: string): string {
  const withoutNumber = title.replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/u, '');
  const slug = withoutNumber
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-')
    .toLowerCase();

  const normalized = slug || 'untitled';
  return /^[a-z]/u.test(normalized) ? normalized : `section-${normalized}`;
}

function slugifyBlockKind(kind: string): string {
  return kind.replace(/_/gu, '-');
}

function shortenStableId(candidate: string): string {
  if (candidate.length <= 120) return candidate;
  const digest = createHash('sha256').update(candidate, 'utf8').digest('hex').slice(0, 10);
  return `${candidate.slice(0, 108)}-${digest}`;
}

function resolveId<T extends string>(input: {
  baseId: string;
  committedId?: string;
  usedIds: Set<string>;
  schema: { parse: (value: string) => T };
  onCollision: (assignedId: string) => void;
}): T {
  const preferred = input.committedId ?? input.baseId;
  let candidate = shortenStableId(preferred);
  let suffix = 2;

  while (input.usedIds.has(candidate)) {
    input.onCollision(candidate);
    candidate = shortenStableId(`${input.baseId}-${suffix}`);
    suffix += 1;
  }

  const parsed = input.schema.parse(candidate);
  input.usedIds.add(parsed);
  return parsed;
}

function parseHeading(line: SourceLine): { level: number; title: string } | undefined {
  const match = headingPattern.exec(line.text);
  if (!match) return undefined;
  return { level: match[1].length, title: match[2].trim() };
}

function isListStart(line: SourceLine | undefined): boolean {
  return line ? listPattern.test(line.text) : false;
}

function isFenceStart(line: SourceLine | undefined): boolean {
  return line ? fencePattern.test(line.text) : false;
}

function isTableStart(lines: SourceLine[], index: number): boolean {
  const current = lines[index];
  const next = lines[index + 1];
  return Boolean(
    current && next && tableRowPattern.test(current.text) && tableSeparatorPattern.test(next.text),
  );
}

function isStructuralBoundary(lines: SourceLine[], index: number): boolean {
  const line = lines[index];
  if (!line) return true;
  if (parseHeading(line)) return true;
  if (isFenceStart(line)) return true;
  if (isListStart(line)) return true;
  if (isTableStart(lines, index)) return true;
  return false;
}

function isReferenceContext(
  lines: SourceLine[],
  startIndex: number,
  section?: InternalSection,
): boolean {
  if (section?.headingPath.some((title) => /references?/iu.test(title))) return true;

  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const text = lines[index].text.trim();
    if (!text) continue;
    return /^(?:primary\s+)?references?:\s*$/iu.test(text);
  }

  return false;
}

function nearestSection(
  sections: InternalSection[],
  lineNumber: number,
): InternalSection | undefined {
  return sections
    .filter(
      (section) =>
        section.lineRange.startLine <= lineNumber && section.lineRange.endLine >= lineNumber,
    )
    .sort(
      (left, right) =>
        right.level - left.level || right.lineRange.startLine - left.lineRange.startLine,
    )[0];
}

function createVersion(sourcePath: string, sourceText: string): BaselineVersionMetadata {
  const digest = createSourceDigest(sourceText);
  return {
    sourcePath,
    algorithm: 'sha256',
    checksum: digest.value,
    bytes: digest.bytes ?? 0,
    lines: digest.lines ?? 0,
    words: digest.words ?? 0,
  };
}

function createBlockContent(lines: SourceLine[]): string {
  return lines.map((line) => line.text).join('\n');
}

function classifyParagraph(
  blockLines: SourceLine[],
  sourceLines: SourceLine[],
  startIndex: number,
  section: InternalSection | undefined,
): 'paragraph' | 'preamble' | 'document_metadata' | 'primary_reference' {
  const content = createBlockContent(blockLines).trim();
  if (!section && /^(?:Status|Last updated|Purpose):/u.test(content)) return 'document_metadata';
  if (!section) return 'preamble';
  if (
    isReferenceContext(sourceLines, startIndex, section) ||
    /\[[^\]]+\]\([^)]+\)/u.test(content)
  ) {
    return 'primary_reference';
  }
  return 'paragraph';
}

function parseBlockKind(
  kind: string,
):
  | 'document_title'
  | 'document_metadata'
  | 'preamble'
  | 'paragraph'
  | 'list_item'
  | 'numbered_item'
  | 'code'
  | 'table'
  | 'primary_reference'
  | 'unclassified' {
  return BaselineStructuralBlockKindSchema.parse(kind);
}

export function parseBaselineText(
  sourceText: string,
  options: BaselineParserOptions = {},
): ParsedBaseline {
  const sourcePath = options.sourcePath ?? defaultSourcePath;
  const lines = splitSourceLines(sourceText);
  const identityMap: BaselineIdentityMap = {
    sections: { ...(options.identityMap?.sections ?? {}) },
    blocks: { ...(options.identityMap?.blocks ?? {}) },
  };
  const sectionUsedIds = new Set<string>();
  const blockUsedIds = new Set<string>();
  const identityCollisions: IdentityCollision[] = [];
  const duplicateIds: string[] = [];
  const sectionIdentityCounts = new Map<string, number>();
  const headingCandidates: HeadingCandidate[] = [];

  for (const line of lines) {
    const heading = parseHeading(line);
    if (heading && (heading.level === 2 || heading.level === 3 || heading.level === 4)) {
      headingCandidates.push({ line: line.number, level: heading.level, title: heading.title });
    }
  }

  const internalSections: InternalSection[] = [];
  const sectionStack: InternalSection[] = [];

  for (let index = 0; index < headingCandidates.length; index += 1) {
    const heading = headingCandidates[index];
    while (sectionStack.at(-1) && (sectionStack.at(-1)?.level ?? 0) >= heading.level) {
      sectionStack.pop();
    }

    const parent = sectionStack.at(-1);
    const headingPath = [...(parent?.headingPath ?? []), heading.title];
    const identityPath = [...(parent?.identityPath ?? []), heading.title];
    const baseIdentityKey = `h${heading.level}:${identityPath.join(' / ')}`;
    const occurrence = (sectionIdentityCounts.get(baseIdentityKey) ?? 0) + 1;
    sectionIdentityCounts.set(baseIdentityKey, occurrence);
    const identityKey = occurrence === 1 ? baseIdentityKey : `${baseIdentityKey}#${occurrence}`;
    const endLine = headingCandidates
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level)?.line;
    const lineRange = {
      startLine: heading.line,
      endLine: (endLine ?? lines.length + 1) - 1,
    };
    const baseId = `${parent?.id ?? 'baseline'}.${slugifyHeading(heading.title)}`;
    const committedSectionId = identityMap.sections[identityKey];
    const id = resolveId({
      baseId,
      committedId: committedSectionId,
      usedIds: sectionUsedIds,
      schema: BaselineSectionIdSchema,
      onCollision: (assignedId) => duplicateIds.push(assignedId),
    });
    if (occurrence > 1 || (!committedSectionId && id !== shortenStableId(baseId))) {
      identityCollisions.push({ identityKey: baseIdentityKey, assignedId: id });
    }
    identityMap.sections[identityKey] = id;

    const section: InternalSection = {
      id,
      level: heading.level,
      title: heading.title,
      headingPath,
      identityKey,
      parentId: parent?.id ?? null,
      lineRange,
      sourceAnchor: createSourceAnchor({
        source: sourcePath,
        startLine: lineRange.startLine,
        endLine: lineRange.endLine,
        excerpt: excerptForRange(sourceText, lines, lineRange.startLine, lineRange.endLine),
        heading: heading.title,
      }),
      coverageClassification: 'not_classified',
      identityPath,
    };
    internalSections.push(section);
    sectionStack.push(section);
  }

  const sections: BaselineSection[] = internalSections.map(
    ({ identityPath: _identityPath, ...section }) => section,
  );
  const blocks: BaselineBlock[] = [];
  const assignedLines = new Set<number>(headingCandidates.map((heading) => heading.line));
  const blockOrdinals = new Map<string, number>();

  const addBlock = (blockLines: SourceLine[], kind: string, startIndex: number) => {
    const firstLine = blockLines[0];
    const lastLine = blockLines.at(-1);
    if (!firstLine || !lastLine) return;
    const section = nearestSection(internalSections, firstLine.number);
    const structuralKind = parseBlockKind(kind);
    const scope = section?.id ?? 'baseline.preamble';
    const ordinalKey = `${scope}:${structuralKind}`;
    const ordinal = (blockOrdinals.get(ordinalKey) ?? 0) + 1;
    blockOrdinals.set(ordinalKey, ordinal);
    const identityKey = `block:${scope}:${structuralKind}:${ordinal}`;
    const baseId = `${scope}.${slugifyBlockKind(structuralKind)}-${ordinal}`;
    const id = resolveId({
      baseId,
      committedId: identityMap.blocks[identityKey],
      usedIds: blockUsedIds,
      schema: BaselineBlockIdSchema,
      onCollision: (assignedId) => duplicateIds.push(assignedId),
    });
    identityMap.blocks[identityKey] = id;

    for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
      assignedLines.add(lineNumber);
    }

    const lineRange = { startLine: firstLine.number, endLine: lastLine.number };
    const content = createBlockContent(blockLines);
    blocks.push({
      id,
      sectionId: section?.id ?? null,
      headingPath: section?.headingPath ?? [],
      kind: structuralKind,
      content,
      lineRange,
      identityKey,
      sourceAnchor: createSourceAnchor({
        source: sourcePath,
        startLine: lineRange.startLine,
        endLine: lineRange.endLine,
        excerpt: excerptForRange(sourceText, lines, lineRange.startLine, lineRange.endLine),
        heading: section?.title,
      }),
      coverageClassification: 'not_classified',
    });

    void startIndex;
  };

  const firstRootLine =
    headingCandidates.find((candidate) => candidate.level === 2)?.line ?? Number.POSITIVE_INFINITY;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line?.text.trim()) {
      index += 1;
      continue;
    }

    const heading = parseHeading(line);
    if (heading && heading.level >= 2 && heading.level <= 4) {
      index += 1;
      continue;
    }

    if (isFenceStart(line)) {
      const fence = fencePattern.exec(line.text)?.[1] ?? '```';
      const fenceLines = [line];
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index];
        fenceLines.push(nextLine);
        index += 1;
        if (nextLine.text.trim().startsWith(fence)) break;
      }
      addBlock(fenceLines, 'code', index);
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines = [line];
      index += 1;
      while (index < lines.length && tableRowPattern.test(lines[index].text)) {
        tableLines.push(lines[index]);
        index += 1;
      }
      addBlock(tableLines, 'table', index);
      continue;
    }

    const listMatch = listPattern.exec(line.text);
    if (listMatch) {
      const listLines = [line];
      const listKind = /^\d+[.)]$/u.test(listMatch[2]) ? 'numbered_item' : 'list_item';
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index];
        if (!nextLine.text.trim() || isStructuralBoundary(lines, index) || isListStart(nextLine))
          break;
        if (!/^\s{2,}\S/u.test(nextLine.text)) break;
        listLines.push(nextLine);
        index += 1;
      }
      const section = nearestSection(internalSections, line.number);
      addBlock(
        listLines,
        isReferenceContext(lines, index - listLines.length, section)
          ? 'primary_reference'
          : listKind,
        index,
      );
      continue;
    }

    if (heading && heading.level === 1) {
      addBlock([line], 'document_title', index);
      index += 1;
      continue;
    }

    const paragraphLines = [line];
    const paragraphStartIndex = index;
    index += 1;
    while (index < lines.length) {
      const nextLine = lines[index];
      if (!nextLine.text.trim() || isStructuralBoundary(lines, index)) break;
      paragraphLines.push(nextLine);
      index += 1;
    }
    const section = nearestSection(internalSections, line.number);
    const kind =
      line.number < firstRootLine &&
      /^(?:Status|Last updated|Purpose):/u.test(paragraphLines[0]?.text ?? '')
        ? 'document_metadata'
        : classifyParagraph(paragraphLines, lines, paragraphStartIndex, section);
    addBlock(paragraphLines, kind, paragraphStartIndex);
  }

  const meaningfulLineNumbers = lines
    .filter((line) => line.text.trim().length > 0)
    .map((line) => line.number);
  const unassignedMeaningfulLines = meaningfulLineNumbers.filter(
    (lineNumber) => !assignedLines.has(lineNumber),
  );
  const audit = BaselineAuditSchema.parse({
    meaningfulLineCount: meaningfulLineNumbers.length,
    assignedMeaningfulLines: meaningfulLineNumbers.length - unassignedMeaningfulLines.length,
    unassignedMeaningfulLines,
    duplicateIds: [...new Set(duplicateIds)],
    identityCollisions,
    changedDigests: [],
  });

  return ParsedBaselineSchema.parse({
    sourcePath,
    sourceText,
    version: createVersion(sourcePath, sourceText),
    sections,
    blocks,
    identityMap,
    audit,
  });
}

export async function parseBaselineFile(
  path: string,
  options: Omit<BaselineParserOptions, 'sourcePath'> & { sourcePath?: string } = {},
): Promise<ParsedBaseline> {
  const sourceText = await readFile(path, 'utf8');
  return parseBaselineText(sourceText, {
    ...options,
    sourcePath: options.sourcePath ?? path,
  });
}
