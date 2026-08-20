import { BaselineBlockIdSchema, BaselineSectionIdSchema } from '../ids';
import {
  BaselineBlockSchema,
  BaselineSectionSchema,
  type ParsedBaseline,
  type SemanticAnnotation,
} from './types';

/**
 * Apply later semantic coverage labels to parsed structural records.
 * Source text, ranges, anchors, and structural identities remain unchanged.
 */
export function mergeSemanticAnnotations(
  parsed: ParsedBaseline,
  annotations: readonly SemanticAnnotation[],
): ParsedBaseline {
  const seenTargets = new Set<string>();
  const sectionAnnotations = new Map<string, SemanticAnnotation>();
  const blockAnnotations = new Map<string, SemanticAnnotation>();
  const sectionIds = new Set<string>(parsed.sections.map((section) => section.id));
  const blockIds = new Set<string>(parsed.blocks.map((block) => block.id));

  for (const annotation of annotations) {
    const isSectionTarget = sectionIds.has(annotation.targetId);
    const isBlockTarget = blockIds.has(annotation.targetId);
    const parsedSectionId =
      isSectionTarget && BaselineSectionIdSchema.safeParse(annotation.targetId).success;
    const parsedBlockId =
      isBlockTarget && BaselineBlockIdSchema.safeParse(annotation.targetId).success;
    const targetExists = parsedSectionId || parsedBlockId;
    if (!targetExists) {
      throw new Error(`Semantic annotation target does not exist: ${annotation.targetId}`);
    }
    if (seenTargets.has(annotation.targetId)) {
      throw new Error(`Duplicate semantic annotation target: ${annotation.targetId}`);
    }
    seenTargets.add(annotation.targetId);
    if (parsedSectionId) sectionAnnotations.set(annotation.targetId, annotation);
    else blockAnnotations.set(annotation.targetId, annotation);
  }

  const sections = parsed.sections.map((section) =>
    BaselineSectionSchema.parse({
      ...section,
      ...(sectionAnnotations.has(section.id)
        ? {
            coverageClassification: sectionAnnotations.get(section.id)?.classification,
          }
        : {}),
    }),
  );
  const blocks = parsed.blocks.map((block) => {
    const annotation = blockAnnotations.get(block.id);
    return BaselineBlockSchema.parse({
      ...block,
      ...(annotation
        ? {
            coverageClassification: annotation.classification,
            ...(annotation.labels ? { labels: [...annotation.labels] } : {}),
          }
        : {}),
    });
  });

  return { ...parsed, sections, blocks };
}
