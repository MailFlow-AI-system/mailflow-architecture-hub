import type { ArchitecturePhase, DecisionStatus } from '../../../domain/architecture';

export type LineRangeSeed = {
  startLine: number;
  endLine: number;
};

export type DecisionSeed = {
  id: string;
  title: string;
  status: DecisionStatus;
  phase: ArchitecturePhase;
  summary: string;
  sourceRanges: LineRangeSeed[];
  serviceIds?: string[];
  stackIds?: string[];
  gateIds?: string[];
  relatedDecisionIds?: string[];
  trustBoundaryIds?: string[];
  reassessmentTriggers?: string[];
  primaryReferences?: string[];
};

export type EntitySeed = {
  id: string;
  name: string;
  summary: string;
  phase: ArchitecturePhase;
  sourceRanges: LineRangeSeed[];
  decisionIds: string[];
};

export type StackSeed = EntitySeed & {
  status: DecisionStatus;
  gateIds?: string[];
  serviceIds?: string[];
  primaryReferences?: string[];
  reassessmentTriggers?: string[];
};

export type GateSeed = EntitySeed & {
  criterion: string;
  primaryReferences?: string[];
};

export type TrustBoundarySeed = EntitySeed & {
  forbiddenData: string[];
};

export type ArchitectureShard = {
  id: string;
  sourceRange: LineRangeSeed;
  decisions: DecisionSeed[];
  services: EntitySeed[];
  stacks: StackSeed[];
  gates: GateSeed[];
  trustBoundaries: TrustBoundarySeed[];
};
