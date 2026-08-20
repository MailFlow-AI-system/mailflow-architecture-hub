import { z } from 'zod';

import {
  ArchitecturePhaseSchema,
  CoverageClassificationSchema,
  DecisionStatusSchema,
  type ArchitecturePhase,
  type CoverageClassification,
  type DecisionStatus,
} from '../../enums';
import {
  BaselineBlockIdSchema,
  BaselineSectionIdSchema,
  DecisionIdSchema,
  DiagramIdSchema,
  GateIdSchema,
  ServiceIdSchema,
  StackIdSchema,
  type BaselineBlockId,
  type BaselineSectionId,
  type DecisionId,
  type DiagramId,
  type GateId,
  type ServiceId,
  type StackId,
} from '../../ids';
import { SourceAnchorSchema, SourceRangeSchema, type SourceAnchor } from '../../source';
import type { BaselineBlock, BaselineSection, ParsedBaseline } from '../types';

const ruleIdSchema = z
  .string()
  .regex(/^rule\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u, 'rule IDs must use the rule namespace');

export const SemanticAnnotationInputSchema = z.object({
  classification: CoverageClassificationSchema,
  phase: ArchitecturePhaseSchema.optional(),
  status: DecisionStatusSchema.optional(),
  decisionIds: z.array(DecisionIdSchema).default([]),
  serviceIds: z.array(ServiceIdSchema).default([]),
  stackIds: z.array(StackIdSchema).default([]),
  gateIds: z.array(GateIdSchema).default([]),
  diagramIds: z.array(DiagramIdSchema).default([]),
});

export type SemanticAnnotationInput = z.input<typeof SemanticAnnotationInputSchema>;
export type SemanticAnnotation = z.output<typeof SemanticAnnotationInputSchema>;

export const SemanticRuleTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('section'), sectionId: BaselineSectionIdSchema }),
  z.object({ kind: z.literal('block'), blockId: BaselineBlockIdSchema }),
]);

export type SemanticRuleTarget = z.infer<typeof SemanticRuleTargetSchema>;

const ruleBase = z.object({
  id: ruleIdSchema,
  annotation: SemanticAnnotationInputSchema,
});

export const SemanticRuleSchema = z.discriminatedUnion('kind', [
  ruleBase.extend({
    kind: z.literal('section'),
    sectionId: BaselineSectionIdSchema,
  }),
  ruleBase.extend({
    kind: z.literal('range'),
    range: SourceRangeSchema,
  }),
  ruleBase.extend({
    kind: z.literal('override'),
    target: SemanticRuleTargetSchema,
  }),
]);

export type SemanticRule = z.infer<typeof SemanticRuleSchema>;
export type SemanticRuleInput = z.input<typeof SemanticRuleSchema>;

export const SemanticReferenceCatalogSchema = z.object({
  decisionIds: z.array(DecisionIdSchema).default([]),
  serviceIds: z.array(ServiceIdSchema).default([]),
  stackIds: z.array(StackIdSchema).default([]),
  gateIds: z.array(GateIdSchema).default([]),
  diagramIds: z.array(DiagramIdSchema).default([]),
});

export type SemanticReferenceCatalog = z.output<typeof SemanticReferenceCatalogSchema>;
export type SemanticReferenceCatalogInput = z.input<typeof SemanticReferenceCatalogSchema>;

export const SemanticCoverageRecordSchema = z.object({
  targetKind: z.enum(['section', 'block']),
  sectionId: BaselineSectionIdSchema.nullable(),
  blockId: BaselineBlockIdSchema.optional(),
  classification: CoverageClassificationSchema,
  phase: ArchitecturePhaseSchema.optional(),
  status: DecisionStatusSchema.optional(),
  decisionIds: z.array(DecisionIdSchema),
  serviceIds: z.array(ServiceIdSchema),
  stackIds: z.array(StackIdSchema),
  gateIds: z.array(GateIdSchema),
  diagramIds: z.array(DiagramIdSchema),
  sourceAnchor: SourceAnchorSchema,
});

export type SemanticCoverageRecord = z.infer<typeof SemanticCoverageRecordSchema>;

export const CompiledSemanticSectionSchema = z.object({
  sectionId: BaselineSectionIdSchema,
  parentId: BaselineSectionIdSchema.nullable(),
  classification: CoverageClassificationSchema,
  phase: ArchitecturePhaseSchema.optional(),
  status: DecisionStatusSchema.optional(),
  decisionIds: z.array(DecisionIdSchema),
  serviceIds: z.array(ServiceIdSchema),
  stackIds: z.array(StackIdSchema),
  gateIds: z.array(GateIdSchema),
  diagramIds: z.array(DiagramIdSchema),
  sourceAnchor: SourceAnchorSchema,
});

export type CompiledSemanticSection = z.infer<typeof CompiledSemanticSectionSchema>;

export const CompiledSemanticBlockSchema = z.object({
  blockId: BaselineBlockIdSchema,
  sectionId: BaselineSectionIdSchema.nullable(),
  classification: CoverageClassificationSchema,
  phase: ArchitecturePhaseSchema.optional(),
  status: DecisionStatusSchema.optional(),
  decisionIds: z.array(DecisionIdSchema),
  serviceIds: z.array(ServiceIdSchema),
  stackIds: z.array(StackIdSchema),
  gateIds: z.array(GateIdSchema),
  diagramIds: z.array(DiagramIdSchema),
  sourceAnchor: SourceAnchorSchema,
});

export type CompiledSemanticBlock = z.infer<typeof CompiledSemanticBlockSchema>;

export const SemanticCompilationAuditSchema = z.object({
  assignedTargets: z.number().int().nonnegative(),
  missingTargets: z.array(z.string()),
  overlappingTargets: z.array(
    z.object({
      targetKey: z.string(),
      ruleIds: z.array(ruleIdSchema),
    }),
  ),
});

export type SemanticCompilationAudit = z.infer<typeof SemanticCompilationAuditSchema>;

export const SemanticCompilationSchema = z.object({
  sections: z.array(CompiledSemanticSectionSchema),
  blocks: z.array(CompiledSemanticBlockSchema),
  coverage: z.array(SemanticCoverageRecordSchema),
  audit: SemanticCompilationAuditSchema,
});

export type SemanticCompilation = z.infer<typeof SemanticCompilationSchema>;

export type SemanticCompilerInput = {
  rules: readonly SemanticRuleInput[];
  catalog?: Partial<SemanticReferenceCatalogInput>;
};

export type SemanticTargetRecord =
  | { key: string; kind: 'section'; record: BaselineSection }
  | { key: string; kind: 'block'; record: BaselineBlock };

export type SemanticSource = Pick<ParsedBaseline, 'sections' | 'blocks' | 'version'>;

export type {
  ArchitecturePhase,
  BaselineBlock,
  BaselineSection,
  BaselineBlockId,
  BaselineSectionId,
  CoverageClassification,
  DecisionId,
  DecisionStatus,
  DiagramId,
  GateId,
  ServiceId,
  SourceAnchor,
  StackId,
};
