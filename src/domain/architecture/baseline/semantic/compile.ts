import type { BaselineSectionId } from '../../ids';
import type { BaselineBlock, BaselineSection } from '../types';
import {
  CompiledSemanticBlockSchema,
  CompiledSemanticSectionSchema,
  SemanticAnnotationInputSchema,
  SemanticCompilationSchema,
  SemanticCoverageRecordSchema,
  SemanticReferenceCatalogSchema,
  SemanticRuleSchema,
  SemanticCompilationAuditSchema,
  type CompiledSemanticBlock,
  type CompiledSemanticSection,
  type SemanticAnnotationInput,
  type SemanticAnnotation,
  type SemanticCompilation,
  type SemanticCompilerInput,
  type SemanticReferenceCatalog,
  type SemanticRule,
  type SemanticTargetRecord,
} from './types';

export type SemanticCompilationErrorCode =
  | 'RULE_ID_CONFLICT'
  | 'RULE_TARGET_UNKNOWN'
  | 'RULE_RANGE_INVALID'
  | 'REFERENCE_UNKNOWN'
  | 'REFERENCE_DUPLICATE'
  | 'ASSIGNMENT_MISSING'
  | 'ASSIGNMENT_OVERLAP'
  | 'CLASSIFICATION_UNRESOLVED'
  | 'RULE_UNUSED';

export class SemanticCompilationError extends Error {
  readonly code: SemanticCompilationErrorCode;
  readonly details: readonly string[];

  constructor(
    code: SemanticCompilationErrorCode,
    message: string,
    details: readonly string[] = [],
  ) {
    super(message);
    this.name = 'SemanticCompilationError';
    this.code = code;
    this.details = details;
  }
}

function targetKey(kind: 'section' | 'block', id: string): string {
  return `${kind}:${id}`;
}

function containsRange(
  outer: { startLine: number; endLine: number },
  inner: { startLine: number; endLine: number },
): boolean {
  return outer.startLine <= inner.startLine && outer.endLine >= inner.endLine;
}

function canonicalIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function canonicalAnnotation(input: SemanticAnnotation): SemanticAnnotation {
  const annotation = SemanticAnnotationInputSchema.parse(input);
  if (annotation.classification === 'not_classified') {
    throw new SemanticCompilationError(
      'CLASSIFICATION_UNRESOLVED',
      'semantic assignment cannot remain not_classified',
    );
  }

  return {
    ...annotation,
    decisionIds: canonicalIds(annotation.decisionIds),
    serviceIds: canonicalIds(annotation.serviceIds),
    stackIds: canonicalIds(annotation.stackIds),
    gateIds: canonicalIds(annotation.gateIds),
    diagramIds: canonicalIds(annotation.diagramIds),
  } as SemanticAnnotation;
}

function validateReferenceArrays(annotation: SemanticAnnotation): void {
  const arrays: Array<[string, readonly string[]]> = [
    ['decision', annotation.decisionIds],
    ['service', annotation.serviceIds],
    ['stack', annotation.stackIds],
    ['gate', annotation.gateIds],
    ['diagram', annotation.diagramIds],
  ];
  for (const [kind, ids] of arrays) {
    if (new Set(ids).size !== ids.length) {
      throw new SemanticCompilationError(
        'REFERENCE_DUPLICATE',
        `duplicate ${kind} reference in semantic annotation`,
      );
    }
  }
}

function validateReferences(
  annotation: SemanticAnnotation,
  catalog: SemanticReferenceCatalog,
): void {
  const references: Array<[string, readonly string[], ReadonlySet<string>]> = [
    ['decision', annotation.decisionIds, new Set(catalog.decisionIds)],
    ['service', annotation.serviceIds, new Set(catalog.serviceIds)],
    ['stack', annotation.stackIds, new Set(catalog.stackIds)],
    ['gate', annotation.gateIds, new Set(catalog.gateIds)],
    ['diagram', annotation.diagramIds, new Set(catalog.diagramIds)],
  ];
  for (const [kind, ids, knownIds] of references) {
    for (const id of ids) {
      if (!knownIds.has(id)) {
        throw new SemanticCompilationError('REFERENCE_UNKNOWN', `unknown ${kind} reference: ${id}`);
      }
    }
  }
}

function isDescendantOrSelf(
  candidate: BaselineSection,
  ancestorId: BaselineSectionId,
  sectionsById: ReadonlyMap<string, BaselineSection>,
): boolean {
  let current: BaselineSection | undefined = candidate;
  while (current) {
    if (current.id === ancestorId) return true;
    current = current.parentId ? sectionsById.get(current.parentId) : undefined;
  }
  return false;
}

function ruleMatchesTarget(
  rule: SemanticRule,
  target: SemanticTargetRecord,
  sectionsById: ReadonlyMap<string, BaselineSection>,
): boolean {
  if (rule.kind === 'range') {
    return containsRange(rule.range, target.record.lineRange);
  }

  if (rule.kind === 'section') {
    if (target.kind === 'section') {
      return isDescendantOrSelf(target.record, rule.sectionId, sectionsById);
    }
    return Boolean(
      target.record.sectionId &&
      sectionsById.get(target.record.sectionId) &&
      isDescendantOrSelf(
        sectionsById.get(target.record.sectionId) as BaselineSection,
        rule.sectionId,
        sectionsById,
      ),
    );
  }

  return (
    rule.target.kind === target.kind &&
    (rule.target.kind === 'section' && target.kind === 'section'
      ? rule.target.sectionId === target.record.id
      : rule.target.kind === 'block' && target.kind === 'block'
        ? rule.target.blockId === target.record.id
        : false)
  );
}

function validateRuleDefinitions(
  parsedRules: readonly SemanticRule[],
  sourceLineCount: number,
  sectionIds: ReadonlySet<string>,
  blockIds: ReadonlySet<string>,
): void {
  const ruleIds = new Set<string>();
  for (const rule of parsedRules) {
    if (ruleIds.has(rule.id)) {
      throw new SemanticCompilationError(
        'RULE_ID_CONFLICT',
        `duplicate semantic rule ID: ${rule.id}`,
      );
    }
    ruleIds.add(rule.id);

    if (rule.kind === 'section' && !sectionIds.has(rule.sectionId)) {
      throw new SemanticCompilationError(
        'RULE_TARGET_UNKNOWN',
        `unknown section rule target: ${rule.sectionId}`,
      );
    }
    if (rule.kind === 'override') {
      const exists =
        rule.target.kind === 'section'
          ? sectionIds.has(rule.target.sectionId)
          : blockIds.has(rule.target.blockId);
      if (!exists) {
        throw new SemanticCompilationError(
          'RULE_TARGET_UNKNOWN',
          `unknown override target: ${rule.target.kind === 'section' ? rule.target.sectionId : rule.target.blockId}`,
        );
      }
    }
    if (
      rule.kind === 'range' &&
      (rule.range.startLine > sourceLineCount || rule.range.endLine > sourceLineCount)
    ) {
      throw new SemanticCompilationError(
        'RULE_RANGE_INVALID',
        `semantic rule range exceeds baseline line count: ${rule.id}`,
      );
    }
  }
}

function createSectionProjection(
  section: BaselineSection,
  annotation: SemanticAnnotationInput,
): CompiledSemanticSection {
  return CompiledSemanticSectionSchema.parse({
    sectionId: section.id,
    parentId: section.parentId,
    ...annotation,
    sourceAnchor: section.sourceAnchor,
  });
}

function createBlockProjection(
  block: BaselineBlock,
  annotation: SemanticAnnotationInput,
): CompiledSemanticBlock {
  return CompiledSemanticBlockSchema.parse({
    blockId: block.id,
    sectionId: block.sectionId,
    ...annotation,
    sourceAnchor: block.sourceAnchor,
  });
}

export function compileSemanticAnnotations(
  parsed: {
    sections: readonly BaselineSection[];
    blocks: readonly BaselineBlock[];
    version: { lines: number };
  },
  input: SemanticCompilerInput,
): SemanticCompilation {
  const rules = input.rules.map((rule) => SemanticRuleSchema.parse(rule));
  const catalog = SemanticReferenceCatalogSchema.parse(input.catalog ?? {});
  const sectionsById = new Map(parsed.sections.map((section) => [section.id, section]));
  const sectionIds = new Set(parsed.sections.map((section) => section.id));
  const blockIds = new Set(parsed.blocks.map((block) => block.id));

  validateRuleDefinitions(rules, parsed.version.lines, sectionIds, blockIds);

  const targets: SemanticTargetRecord[] = [
    ...parsed.sections.map((section) => ({
      key: targetKey('section', section.id),
      kind: 'section' as const,
      record: section,
    })),
    ...parsed.blocks.map((block) => ({
      key: targetKey('block', block.id),
      kind: 'block' as const,
      record: block,
    })),
  ];
  const assignments = new Map<string, SemanticAnnotationInput>();
  const matchedRuleIds = new Set<string>();
  const missingTargets: string[] = [];

  for (const target of targets) {
    const baseMatches = rules.filter(
      (rule) => rule.kind !== 'override' && ruleMatchesTarget(rule, target, sectionsById),
    );
    const overrideMatches = rules.filter(
      (rule) => rule.kind === 'override' && ruleMatchesTarget(rule, target, sectionsById),
    );
    for (const rule of [...baseMatches, ...overrideMatches]) matchedRuleIds.add(rule.id);

    if (baseMatches.length > 1 || overrideMatches.length > 1) {
      const ruleIds = [...baseMatches, ...overrideMatches].map((rule) => rule.id);
      throw new SemanticCompilationError(
        'ASSIGNMENT_OVERLAP',
        `overlapping semantic assignments for ${target.key}`,
        ruleIds,
      );
    }

    const selected = overrideMatches[0] ?? baseMatches[0];
    if (!selected) {
      missingTargets.push(target.key);
      continue;
    }

    const annotation = canonicalAnnotation(selected.annotation);
    validateReferenceArrays(annotation);
    validateReferences(annotation, catalog);
    assignments.set(target.key, annotation);
  }

  if (missingTargets.length > 0) {
    throw new SemanticCompilationError(
      'ASSIGNMENT_MISSING',
      `missing semantic assignment for ${missingTargets.length} target(s)`,
      missingTargets,
    );
  }

  const unusedRuleIds = rules.filter((rule) => !matchedRuleIds.has(rule.id)).map((rule) => rule.id);
  if (unusedRuleIds.length > 0) {
    throw new SemanticCompilationError(
      'RULE_UNUSED',
      `semantic rule matched no parsed target(s): ${unusedRuleIds.join(', ')}`,
      unusedRuleIds,
    );
  }

  const sections = parsed.sections.map((section) =>
    createSectionProjection(
      section,
      assignments.get(targetKey('section', section.id)) as SemanticAnnotationInput,
    ),
  );
  const blocks = parsed.blocks.map((block) =>
    createBlockProjection(
      block,
      assignments.get(targetKey('block', block.id)) as SemanticAnnotationInput,
    ),
  );
  const coverage = [
    ...sections.map((section) =>
      SemanticCoverageRecordSchema.parse({
        targetKind: 'section',
        ...section,
      }),
    ),
    ...blocks.map((block) =>
      SemanticCoverageRecordSchema.parse({
        targetKind: 'block',
        ...block,
      }),
    ),
  ];
  const audit = SemanticCompilationAuditSchema.parse({
    assignedTargets: assignments.size,
    missingTargets: [],
    overlappingTargets: [],
  });

  return SemanticCompilationSchema.parse({ sections, blocks, coverage, audit });
}

export {
  SemanticAnnotationInputSchema,
  SemanticCompilationSchema,
  SemanticCoverageRecordSchema,
  SemanticReferenceCatalogSchema,
  SemanticRuleSchema,
};
