import { z } from 'zod';

const stableIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

/**
 * Stable identifiers are intentionally presentation-independent. A slug is
 * scoped by its branded TypeScript type and by its entity collection.
 */
export const StableIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(stableIdPattern, 'must be a lowercase dotted stable ID');

export type StableId = z.infer<typeof StableIdSchema>;

export const EntityKindSchema = z.enum([
  'decision',
  'service',
  'diagram',
  'relationship',
  'stack',
  'gate',
  'baseline_section',
  'baseline_block',
  'trust_boundary',
]);

export type EntityKind = z.infer<typeof EntityKindSchema>;

const idPrefixes = {
  decision: 'decision',
  service: 'service',
  diagram: 'diagram',
  relationship: 'relation',
  stack: 'stack',
  gate: 'gate',
  baseline_section: 'baseline',
  baseline_block: 'baseline',
  trust_boundary: 'trust',
} as const satisfies Record<z.infer<typeof EntityKindSchema>, string>;

function prefixedIdSchema(kind: EntityKind, minimumSegments: number) {
  return StableIdSchema.refine((value) => {
    const segments = value.split('.');
    return segments[0] === idPrefixes[kind] && segments.length >= minimumSegments;
  }, `must use the ${idPrefixes[kind]}. namespace with at least ${minimumSegments} segments`);
}

export const DecisionIdSchema = prefixedIdSchema('decision', 3).brand<'DecisionId'>();
export const ServiceIdSchema = prefixedIdSchema('service', 2).brand<'ServiceId'>();
export const DiagramIdSchema = prefixedIdSchema('diagram', 3).brand<'DiagramId'>();
export const RelationshipIdSchema = prefixedIdSchema('relationship', 4).brand<'RelationshipId'>();
export const StackIdSchema = prefixedIdSchema('stack', 2).brand<'StackId'>();
export const GateIdSchema = prefixedIdSchema('gate', 2).brand<'GateId'>();
export const BaselineSectionIdSchema = prefixedIdSchema(
  'baseline_section',
  2,
).brand<'BaselineSectionId'>();
export const BaselineBlockIdSchema = prefixedIdSchema(
  'baseline_block',
  3,
).brand<'BaselineBlockId'>();
export const TrustBoundaryIdSchema = prefixedIdSchema(
  'trust_boundary',
  2,
).brand<'TrustBoundaryId'>();

export type DecisionId = z.infer<typeof DecisionIdSchema>;
export type ServiceId = z.infer<typeof ServiceIdSchema>;
export type DiagramId = z.infer<typeof DiagramIdSchema>;
export type RelationshipId = z.infer<typeof RelationshipIdSchema>;
export type StackId = z.infer<typeof StackIdSchema>;
export type GateId = z.infer<typeof GateIdSchema>;
export type BaselineSectionId = z.infer<typeof BaselineSectionIdSchema>;
export type BaselineBlockId = z.infer<typeof BaselineBlockIdSchema>;
export type TrustBoundaryId = z.infer<typeof TrustBoundaryIdSchema>;

export const EntityRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('decision'), id: DecisionIdSchema }),
  z.object({ kind: z.literal('service'), id: ServiceIdSchema }),
  z.object({ kind: z.literal('diagram'), id: DiagramIdSchema }),
  z.object({ kind: z.literal('relationship'), id: RelationshipIdSchema }),
  z.object({ kind: z.literal('stack'), id: StackIdSchema }),
  z.object({ kind: z.literal('gate'), id: GateIdSchema }),
  z.object({ kind: z.literal('baseline_section'), id: BaselineSectionIdSchema }),
  z.object({ kind: z.literal('baseline_block'), id: BaselineBlockIdSchema }),
  z.object({ kind: z.literal('trust_boundary'), id: TrustBoundaryIdSchema }),
]);

export type EntityRef = z.infer<typeof EntityRefSchema>;

function slugify(value: string, preserveDots = false): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(preserveDots ? /[^a-zA-Z0-9.]+/g : /[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .toLowerCase();

  return slug || 'untitled';
}

/** Create a deterministic ID. `kind` documents the intended namespace. */
export function createStableId(kind: EntityKind, label: string): StableId {
  const prefix = idPrefixes[kind];
  const segments = label
    .split(/\s*(?:\/|:|\|)\s*/u)
    .map((segment) => slugify(segment, kind === 'relationship'))
    .filter(Boolean);
  const minimumSegments =
    kind === 'decision' || kind === 'diagram' || kind === 'baseline_block'
      ? 2
      : kind === 'relationship'
        ? 3
        : 1;

  while (segments.length < minimumSegments) {
    segments.unshift(kind === 'decision' ? 'architecture' : 'view');
  }

  return StableIdSchema.parse(`${prefix}.${segments.join('.')}`);
}

export function entityRef(kind: EntityKind, id: string): EntityRef {
  return EntityRefSchema.parse({ kind, id });
}
