import { z } from 'zod';

export const ArchitecturePhaseSchema = z.enum(['mvp', 'first_distributed', 'future']);
export type ArchitecturePhase = z.infer<typeof ArchitecturePhaseSchema>;

export const DecisionStatusSchema = z.enum([
  'confirmed',
  'confirmed_with_validation_gate',
  'deferred',
  'superseded',
]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const RelationTypeSchema = z.enum([
  'sync_rest',
  'event',
  'async_command',
  'job',
  'data',
  'authentication',
  'authorization',
  'infrastructure',
  'provider_call',
  'ownership',
  'dependency',
  'phase_transition',
  'trust_boundary',
]);
export type RelationType = z.infer<typeof RelationTypeSchema>;

export const CoverageClassificationSchema = z.enum([
  'classified',
  'partially_classified',
  'not_classified',
  'not_applicable',
]);
export type CoverageClassification = z.infer<typeof CoverageClassificationSchema>;

export const OwnerKindSchema = z.enum(['service', 'platform', 'external_provider', 'application']);
export type OwnerKind = z.infer<typeof OwnerKindSchema>;

export const ConfidentialityClassSchema = z.enum([
  'public',
  'internal',
  'tenant_confidential',
  'sensitive',
  'secret',
]);
export type ConfidentialityClass = z.infer<typeof ConfidentialityClassSchema>;

export const BaselineBlockKindSchema = z.enum([
  'decision',
  'service',
  'stack',
  'diagram',
  'gate',
  'trade_off',
  'reference',
  'requirement',
  'other',
]);
export type BaselineBlockKind = z.infer<typeof BaselineBlockKindSchema>;
