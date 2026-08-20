import { z } from 'zod';

import {
  BaselineBlockIdSchema,
  BaselineSectionIdSchema,
  type BaselineBlockId,
  type BaselineSectionId,
} from '../ids';
import { CoverageClassificationSchema, type CoverageClassification } from '../enums';
import {
  SourceAnchorSchema,
  SourceRangeSchema,
  type SourceAnchor,
  type SourceDigest,
  type SourceRange,
} from '../source';

export const BaselineStructuralBlockKindSchema = z.enum([
  'document_title',
  'document_metadata',
  'preamble',
  'paragraph',
  'list_item',
  'numbered_item',
  'code',
  'table',
  'primary_reference',
  'unclassified',
]);

export type BaselineStructuralBlockKind = z.infer<typeof BaselineStructuralBlockKindSchema>;

export const BaselineVersionMetadataSchema = z.object({
  sourcePath: z.string().min(1),
  algorithm: z.literal('sha256'),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  words: z.number().int().nonnegative(),
});

export type BaselineVersionMetadata = z.infer<typeof BaselineVersionMetadataSchema>;

export const BaselineIdentityMapSchema = z.object({
  sections: z.record(z.string(), BaselineSectionIdSchema),
  blocks: z.record(z.string(), BaselineBlockIdSchema),
});

export type BaselineIdentityMap = z.infer<typeof BaselineIdentityMapSchema>;

export const BaselineSectionSchema = z.object({
  id: BaselineSectionIdSchema,
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  title: z.string().min(1),
  headingPath: z.array(z.string().min(1)).min(1),
  identityKey: z.string().min(1),
  parentId: BaselineSectionIdSchema.nullable(),
  lineRange: SourceRangeSchema,
  sourceAnchor: SourceAnchorSchema,
  coverageClassification: CoverageClassificationSchema,
});

export type BaselineSection = z.infer<typeof BaselineSectionSchema>;

export const BaselineBlockSchema = z.object({
  id: BaselineBlockIdSchema,
  sectionId: BaselineSectionIdSchema.nullable(),
  headingPath: z.array(z.string().min(1)),
  kind: BaselineStructuralBlockKindSchema,
  content: z.string(),
  lineRange: SourceRangeSchema,
  identityKey: z.string().min(1),
  sourceAnchor: SourceAnchorSchema,
  coverageClassification: CoverageClassificationSchema,
  labels: z.array(z.string().min(1)).optional(),
});

export type BaselineBlock = z.infer<typeof BaselineBlockSchema>;

export const BaselineAuditSchema = z.object({
  meaningfulLineCount: z.number().int().nonnegative(),
  assignedMeaningfulLines: z.number().int().nonnegative(),
  unassignedMeaningfulLines: z.array(z.number().int().positive()),
  duplicateIds: z.array(z.string().min(1)),
  identityCollisions: z.array(
    z.object({
      identityKey: z.string().min(1),
      assignedId: z.string().min(1),
    }),
  ),
  changedDigests: z.array(
    z.object({
      identityKey: z.string().min(1),
      previousDigest: z.string().regex(/^[a-f0-9]{64}$/),
      currentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});

export type BaselineAudit = z.infer<typeof BaselineAuditSchema>;

export const ParsedBaselineSchema = z.object({
  sourcePath: z.string().min(1),
  sourceText: z.string(),
  version: BaselineVersionMetadataSchema,
  sections: z.array(BaselineSectionSchema),
  blocks: z.array(BaselineBlockSchema),
  identityMap: BaselineIdentityMapSchema,
  audit: BaselineAuditSchema,
});

export type ParsedBaseline = z.infer<typeof ParsedBaselineSchema>;

export type BaselineParserOptions = {
  sourcePath?: string;
  identityMap?: Partial<BaselineIdentityMap>;
};

export type SemanticAnnotation = {
  targetId: BaselineSectionId | BaselineBlockId;
  classification: CoverageClassification;
  labels?: string[];
};

export type BlockDigestChange =
  | {
      kind: 'changed';
      identityKey: string;
      previousDigest: string;
      currentDigest: string;
    }
  | {
      kind: 'added';
      identityKey: string;
      currentDigest: string;
    }
  | {
      kind: 'removed';
      identityKey: string;
      previousDigest: string;
    };

export type { CoverageClassification, SourceAnchor, SourceDigest, SourceRange };
