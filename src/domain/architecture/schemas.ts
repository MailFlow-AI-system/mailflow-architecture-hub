import { z } from 'zod';

import {
  ArchitecturePhaseSchema,
  BaselineBlockKindSchema,
  ConfidentialityClassSchema,
  CoverageClassificationSchema,
  DecisionStatusSchema,
  OwnerKindSchema,
  RelationTypeSchema,
} from './enums';
import {
  BaselineBlockIdSchema,
  BaselineSectionIdSchema,
  DecisionIdSchema,
  DiagramIdSchema,
  EntityRefSchema,
  GateIdSchema,
  RelationshipIdSchema,
  ServiceIdSchema,
  StackIdSchema,
  StableIdSchema,
  TrustBoundaryIdSchema,
} from './ids';
import { SourceAnchorSchema, SourceDigestSchema, SourceRangeSchema } from './source';

const nonEmptyText = z.string().trim().min(1);
const urlSchema = z.url();
const decisionIds = z.array(DecisionIdSchema).default([]);
const serviceIds = z.array(ServiceIdSchema).default([]);
const diagramIds = z.array(DiagramIdSchema).default([]);
const stackIds = z.array(StackIdSchema).default([]);
const gateIds = z.array(GateIdSchema).default([]);
const trustBoundaryIds = z.array(TrustBoundaryIdSchema).default([]);

export const DocumentationStatusSchema = z.enum(['documented', 'not_documented']);
export type DocumentationStatus = z.infer<typeof DocumentationStatusSchema>;

export const NarrativeTextSchema = z.object({
  status: DocumentationStatusSchema,
  items: z.array(nonEmptyText).default([]),
  note: nonEmptyText.optional(),
});
export type NarrativeText = z.infer<typeof NarrativeTextSchema>;

export const NarrativeReferenceSchema = z.object({
  status: DocumentationStatusSchema,
  items: z.array(urlSchema).default([]),
  note: nonEmptyText.optional(),
});
export type NarrativeReference = z.infer<typeof NarrativeReferenceSchema>;

export const DecisionNarrativeSchema = z.object({
  contextProblem: NarrativeTextSchema,
  motivation: NarrativeTextSchema,
  alternativesConsidered: NarrativeTextSchema,
  alternativesRejected: NarrativeTextSchema,
  benefits: NarrativeTextSchema,
  tradeOffs: NarrativeTextSchema,
  risks: NarrativeTextSchema,
  operationalConsequences: NarrativeTextSchema,
  mvpImpact: NarrativeTextSchema,
  futureImpact: NarrativeTextSchema,
  evidence: NarrativeTextSchema,
  references: NarrativeReferenceSchema,
});
export type DecisionNarrative = z.infer<typeof DecisionNarrativeSchema>;

export const OwnershipSchema = z.object({
  kind: OwnerKindSchema,
  id: StableIdSchema,
  responsibilities: z.array(nonEmptyText).default([]),
});
export type Ownership = z.infer<typeof OwnershipSchema>;

export const DecisionSchema = z
  .object({
    id: DecisionIdSchema,
    title: nonEmptyText,
    status: DecisionStatusSchema,
    phase: ArchitecturePhaseSchema,
    summary: nonEmptyText,
    pagePath: nonEmptyText,
    narrative: DecisionNarrativeSchema,
    sourceAnchors: z.array(SourceAnchorSchema).min(1),
    owner: OwnershipSchema,
    validationGateIds: gateIds,
    supersededByDecisionId: DecisionIdSchema.optional(),
    serviceIds,
    diagramIds,
    stackIds,
    relatedDecisionIds: decisionIds,
    trustBoundaryIds,
    confidentiality: ConfidentialityClassSchema.default('internal'),
    reassessmentTriggers: z.array(nonEmptyText).default([]),
    primaryReferences: z.array(urlSchema).default([]),
  })
  .superRefine((decision, context) => {
    if (
      decision.status === 'confirmed_with_validation_gate' &&
      decision.validationGateIds.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validationGateIds'],
        message: 'gated decisions must reference at least one validation gate',
      });
    }

    if (
      decision.status === 'deferred' &&
      decision.validationGateIds.length === 0 &&
      decision.reassessmentTriggers.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reassessmentTriggers'],
        message: 'deferred decisions must record a gate or reassessment trigger',
      });
    }

    if (decision.status === 'superseded' && !decision.supersededByDecisionId) {
      context.addIssue({
        code: 'custom',
        path: ['supersededByDecisionId'],
        message: 'superseded decisions must reference their replacement',
      });
    }

    if (decision.status !== 'superseded' && decision.supersededByDecisionId) {
      context.addIssue({
        code: 'custom',
        path: ['supersededByDecisionId'],
        message: 'only superseded decisions may reference a replacement',
      });
    }
  });
export type Decision = z.infer<typeof DecisionSchema>;

export const ServiceContractSchema = z.object({
  name: nonEmptyText,
  kind: z.enum(['rest_api', 'openapi', 'async_event', 'async_command', 'job', 'provider']),
  direction: z.enum(['owned', 'consumed', 'published', 'requested']),
  status: DocumentationStatusSchema,
  notes: NarrativeTextSchema,
});
export type ServiceContract = z.infer<typeof ServiceContractSchema>;

export const ServiceDependencySchema = z.object({
  target: nonEmptyText,
  targetEntity: EntityRefSchema.optional(),
  phase: ArchitecturePhaseSchema,
  status: DocumentationStatusSchema,
  reason: NarrativeTextSchema,
});
export type ServiceDependency = z.infer<typeof ServiceDependencySchema>;

export const ServiceProcessRoleSchema = z.object({
  role: z.enum(['api', 'worker', 'scheduler', 'webhook', 'compiler', 'other']),
  status: DocumentationStatusSchema,
  responsibilities: z.array(nonEmptyText).default([]),
});
export type ServiceProcessRole = z.infer<typeof ServiceProcessRoleSchema>;

export const ServicePlacementSchema = z.object({
  status: DocumentationStatusSchema,
  phases: z.array(ArchitecturePhaseSchema).default([]),
  locations: z.array(nonEmptyText).default([]),
  conditions: z.array(nonEmptyText).default([]),
});
export type ServicePlacement = z.infer<typeof ServicePlacementSchema>;

export const ServiceSchema = z.object({
  id: ServiceIdSchema,
  name: nonEmptyText,
  responsibility: nonEmptyText,
  phase: ArchitecturePhaseSchema,
  pagePath: nonEmptyText,
  owner: OwnershipSchema,
  dataOwned: z.array(nonEmptyText).default([]),
  dataForbidden: z.array(nonEmptyText).default([]),
  apiContracts: z.array(ServiceContractSchema).default([]),
  eventsPublished: z.array(ServiceContractSchema).default([]),
  eventsConsumed: z.array(ServiceContractSchema).default([]),
  dependencies: z.array(ServiceDependencySchema).default([]),
  processRoles: z.array(ServiceProcessRoleSchema).default([]),
  placement: ServicePlacementSchema,
  stackMotivation: NarrativeTextSchema,
  stackTradeOffs: NarrativeTextSchema,
  stackAlternatives: NarrativeTextSchema,
  extractionTriggers: NarrativeTextSchema,
  migrationTriggers: NarrativeTextSchema,
  security: NarrativeTextSchema,
  authentication: NarrativeTextSchema,
  authorization: NarrativeTextSchema,
  sourceAnchors: z.array(SourceAnchorSchema).min(1),
  decisionIds,
  diagramIds,
  stackIds,
  trustBoundaryIds,
  confidentiality: ConfidentialityClassSchema.default('tenant_confidential'),
});
export type Service = z.infer<typeof ServiceSchema>;

export const DiagramSchema = z.object({
  id: DiagramIdSchema,
  title: nonEmptyText,
  purpose: nonEmptyText,
  phase: ArchitecturePhaseSchema,
  pagePath: nonEmptyText,
  sourceAnchors: z.array(SourceAnchorSchema).min(1),
  decisionIds,
  serviceIds,
  relationshipIds: z.array(RelationshipIdSchema).default([]),
  trustBoundaryIds,
  staticOutline: z.array(nonEmptyText).default([]),
});
export type Diagram = z.infer<typeof DiagramSchema>;

export const RelationshipSchema = z.object({
  id: RelationshipIdSchema,
  type: RelationTypeSchema,
  phase: ArchitecturePhaseSchema,
  source: EntityRefSchema,
  target: EntityRefSchema,
  label: nonEmptyText.optional(),
  sourceAnchors: z.array(SourceAnchorSchema).min(1),
  decisionIds,
  confidentiality: ConfidentialityClassSchema.default('internal'),
  trustBoundaryId: TrustBoundaryIdSchema.optional(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const StackSchema = z
  .object({
    id: StackIdSchema,
    name: nonEmptyText,
    responsibility: nonEmptyText,
    phase: ArchitecturePhaseSchema,
    status: DecisionStatusSchema,
    pagePath: nonEmptyText,
    validationGateIds: gateIds,
    sourceAnchors: z.array(SourceAnchorSchema).min(1),
    decisionIds,
    serviceIds,
    primaryReferences: z.array(urlSchema).default([]),
    reassessmentTriggers: z.array(nonEmptyText).default([]),
  })
  .superRefine((stack, context) => {
    if (stack.status === 'confirmed_with_validation_gate' && stack.validationGateIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['validationGateIds'],
        message: 'gated stacks must reference at least one validation gate',
      });
    }
  });
export type Stack = z.infer<typeof StackSchema>;

export const GateSchema = z.object({
  id: GateIdSchema,
  title: nonEmptyText,
  criterion: nonEmptyText,
  phase: ArchitecturePhaseSchema,
  sourceAnchors: z.array(SourceAnchorSchema).min(1),
  decisionIds: z.array(DecisionIdSchema).min(1),
  primaryReferences: z.array(urlSchema).default([]),
});
export type Gate = z.infer<typeof GateSchema>;

export const TrustBoundarySchema = z.object({
  id: TrustBoundaryIdSchema,
  name: nonEmptyText,
  description: nonEmptyText,
  owner: OwnershipSchema,
  permittedConfidentiality: z.array(ConfidentialityClassSchema).min(1),
  forbiddenConfidentiality: z.array(ConfidentialityClassSchema).default([]),
  sourceAnchors: z.array(SourceAnchorSchema).min(1),
});
export type TrustBoundary = z.infer<typeof TrustBoundarySchema>;

export const BaselineSectionSchema = z.object({
  id: BaselineSectionIdSchema,
  title: nonEmptyText,
  order: z.number().int().positive(),
  parentId: BaselineSectionIdSchema.optional(),
  sourceRange: SourceRangeSchema,
  classification: CoverageClassificationSchema,
});
export type BaselineSection = z.infer<typeof BaselineSectionSchema>;

export const BaselineBlockSchema = z.object({
  id: BaselineBlockIdSchema,
  sectionId: BaselineSectionIdSchema,
  title: nonEmptyText,
  kind: BaselineBlockKindSchema,
  order: z.number().int().positive(),
  sourceAnchor: SourceAnchorSchema,
  classification: CoverageClassificationSchema,
});
export type BaselineBlock = z.infer<typeof BaselineBlockSchema>;

export const CoverageRecordSchema = z.object({
  sectionId: BaselineSectionIdSchema,
  blockId: BaselineBlockIdSchema.optional(),
  classification: CoverageClassificationSchema,
  decisionIds,
  serviceIds,
  diagramIds,
  stackIds,
  gateIds,
  relationshipIds: z.array(RelationshipIdSchema).default([]),
  phase: ArchitecturePhaseSchema.optional(),
  status: DecisionStatusSchema.optional(),
  sourceDigest: SourceDigestSchema,
  primaryReferences: z.array(urlSchema).default([]),
});
export type CoverageRecord = z.infer<typeof CoverageRecordSchema>;

export const ArchitectureRegistrySchema = z.object({
  decisions: z.array(DecisionSchema),
  services: z.array(ServiceSchema),
  diagrams: z.array(DiagramSchema),
  relationships: z.array(RelationshipSchema),
  stacks: z.array(StackSchema),
  gates: z.array(GateSchema),
  trustBoundaries: z.array(TrustBoundarySchema).default([]),
  baselineSections: z.array(BaselineSectionSchema),
  baselineBlocks: z.array(BaselineBlockSchema),
  coverage: z.array(CoverageRecordSchema),
});
export type ArchitectureRegistry = z.infer<typeof ArchitectureRegistrySchema>;
