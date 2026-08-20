import {
  ArchitectureRegistrySchema,
  BaselineBlockSchema,
  BaselineSectionSchema,
  CoverageRecordSchema,
  DecisionIdSchema,
  DecisionSchema,
  GateSchema,
  ServiceSchema,
  StackSchema,
  TrustBoundarySchema,
  createSourceAnchor,
  type ArchitectureRegistry,
  type BaselineBlockKind,
  type Decision,
} from '../../../domain/architecture';
import { parseBaselineText } from '../../../domain/architecture/baseline';
import type { ArchitectureShard, DecisionSeed, LineRangeSeed } from './types';

function overlaps(left: LineRangeSeed, right: LineRangeSeed): boolean {
  return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

function distance(left: LineRangeSeed, right: LineRangeSeed): number {
  if (overlaps(left, right)) return 0;
  return left.endLine < right.startLine
    ? right.startLine - left.endLine
    : left.startLine - right.endLine;
}

function sourceExcerpt(sourceText: string, range: LineRangeSeed): string {
  const lines = sourceText.split(/(?<=\n)/u);
  return lines.slice(range.startLine - 1, range.endLine).join('');
}

function anchor(sourceText: string, sourcePath: string, range: LineRangeSeed, heading?: string) {
  return createSourceAnchor({
    source: sourcePath,
    startLine: range.startLine,
    endLine: range.endLine,
    excerpt: sourceExcerpt(sourceText, range),
    heading,
  });
}

function notDocumented(note: string) {
  return { status: 'not_documented' as const, items: [], note };
}

function decisionFromSeed(
  seed: DecisionSeed,
  sourceText: string,
  sourcePath: string,
  reciprocalGateIds: string[],
): Decision {
  const evidence = seed.sourceRanges.map((range) => sourceExcerpt(sourceText, range).trim());
  return DecisionSchema.parse({
    id: DecisionIdSchema.parse(seed.id),
    title: seed.title,
    status: seed.status,
    phase: seed.phase,
    summary: seed.summary,
    pagePath: `/decisions/${seed.id}/`,
    narrative: {
      contextProblem: { status: 'documented', items: evidence },
      motivation: notDocumented(
        'Use the linked baseline evidence; no separate projection was asserted.',
      ),
      alternativesConsidered: notDocumented(
        'Alternatives are shown only when explicitly present in the linked baseline evidence.',
      ),
      alternativesRejected: notDocumented(
        'Rejected alternatives are not inferred from the selected technology.',
      ),
      benefits: notDocumented('Benefits remain in the authoritative baseline evidence.'),
      tradeOffs: notDocumented('Trade-offs remain in the authoritative baseline evidence.'),
      risks: notDocumented('Risks remain in the authoritative baseline evidence.'),
      operationalConsequences: notDocumented(
        'Operational consequences remain in the authoritative baseline evidence.',
      ),
      mvpImpact: notDocumented('MVP impact is not duplicated when the source is phase-specific.'),
      futureImpact: notDocumented(
        'Future impact is not duplicated when the source is phase-specific.',
      ),
      evidence: { status: 'documented', items: evidence },
      references: seed.primaryReferences?.length
        ? { status: 'documented', items: seed.primaryReferences }
        : { status: 'not_documented', items: [], note: 'No primary URL linked to this seed.' },
    },
    sourceAnchors: seed.sourceRanges.map((range) =>
      anchor(sourceText, sourcePath, range, seed.title),
    ),
    owner: {
      kind: 'application',
      id: 'application.architecture-stewards',
      responsibilities: ['Maintain the approved architecture projection and provenance.'],
    },
    validationGateIds: [...new Set([...(seed.gateIds ?? []), ...reciprocalGateIds])],
    serviceIds: seed.serviceIds ?? [],
    diagramIds: [],
    stackIds: seed.stackIds ?? [],
    relatedDecisionIds: seed.relatedDecisionIds ?? [],
    trustBoundaryIds: seed.trustBoundaryIds ?? [],
    reassessmentTriggers: seed.reassessmentTriggers ?? [],
    primaryReferences: seed.primaryReferences ?? [],
  });
}

function blockKind(kind: string): BaselineBlockKind {
  if (kind === 'primary_reference') return 'reference';
  if (kind === 'document_title' || kind === 'document_metadata' || kind === 'preamble') {
    return 'requirement';
  }
  return 'decision';
}

function assertSeedIntegrity(shards: readonly ArchitectureShard[]): void {
  const ids = new Set<string>();
  for (const shard of shards) {
    const entities = [
      shard.id,
      ...shard.decisions.map((item) => item.id),
      ...shard.services.map((item) => item.id),
      ...shard.stacks.map((item) => item.id),
      ...shard.gates.map((item) => item.id),
      ...shard.trustBoundaries.map((item) => item.id),
    ];
    for (const id of entities) {
      if (ids.has(id)) throw new Error(`duplicate shard or entity ID: ${id}`);
      ids.add(id);
    }
    for (const entity of [
      ...shard.decisions,
      ...shard.services,
      ...shard.stacks,
      ...shard.gates,
      ...shard.trustBoundaries,
    ]) {
      for (const range of entity.sourceRanges) {
        if (
          !overlaps(range, shard.sourceRange) ||
          range.startLine < shard.sourceRange.startLine ||
          range.endLine > shard.sourceRange.endLine
        ) {
          throw new Error(`${entity.id} source range is outside shard ${shard.id}`);
        }
      }
    }
  }
}

export function buildArchitectureCatalog(
  sourceText: string,
  shards: readonly ArchitectureShard[],
  sourcePath = 'docs/architecture/architectureBaseline.md',
): ArchitectureRegistry {
  assertSeedIntegrity(shards);
  const parsed = parseBaselineText(sourceText, { sourcePath });
  const seeds = shards.flatMap((shard) => shard.decisions);
  const serviceSeeds = shards.flatMap((shard) => shard.services);
  const stackSeeds = shards.flatMap((shard) => shard.stacks);
  const gateSeeds = shards.flatMap((shard) => shard.gates);
  const trustBoundarySeeds = shards.flatMap((shard) => shard.trustBoundaries);
  const decisions = seeds.map((seed) =>
    decisionFromSeed(
      seed,
      sourceText,
      sourcePath,
      gateSeeds.filter((gate) => gate.decisionIds.includes(seed.id)).map((gate) => gate.id),
    ),
  );
  const stacks = stackSeeds.map((seed) =>
    StackSchema.parse({
      id: seed.id,
      name: seed.name,
      responsibility: seed.summary,
      phase: seed.phase,
      status: seed.status,
      pagePath: `/stacks/${seed.id}/`,
      validationGateIds: seed.gateIds ?? [],
      sourceAnchors: seed.sourceRanges.map((range) =>
        anchor(sourceText, sourcePath, range, seed.name),
      ),
      decisionIds: seed.decisionIds,
      serviceIds: seed.serviceIds ?? [],
      primaryReferences: seed.primaryReferences ?? [],
      reassessmentTriggers: seed.reassessmentTriggers ?? [],
    }),
  );
  const defaultStackId =
    stacks.find((stack) => stack.id === 'stack.runtime.typescript-node24')?.id ?? stacks[0]?.id;
  const services = serviceSeeds.map((seed) => {
    const linkedStackIds = [
      ...new Set([
        ...stackSeeds
          .filter((stack) => stack.serviceIds?.includes(seed.id))
          .map((stack) => stack.id),
        ...seeds
          .filter((decision) => decision.serviceIds?.includes(seed.id))
          .flatMap((decision) => decision.stackIds ?? []),
      ]),
    ];
    if (linkedStackIds.length === 0 && defaultStackId) linkedStackIds.push(defaultStackId);
    return ServiceSchema.parse({
      id: seed.id,
      name: seed.name,
      responsibility: seed.summary,
      phase: seed.phase,
      pagePath: `/services/${seed.id}/`,
      owner: {
        kind: 'application',
        id: 'application.mailflow',
        responsibilities: [seed.summary],
      },
      dataOwned: [],
      dataForbidden: trustBoundarySeeds
        .filter((boundary) => boundary.decisionIds.some((id) => seed.decisionIds.includes(id)))
        .flatMap((boundary) => boundary.forbiddenData),
      apiContracts: [],
      eventsPublished: [],
      eventsConsumed: [],
      dependencies: [],
      processRoles: [],
      placement: {
        status: 'not_documented',
        phases: [seed.phase],
        locations: [],
        conditions: [],
      },
      stackMotivation: notDocumented('See linked stack decisions and baseline evidence.'),
      stackTradeOffs: notDocumented('See linked stack decisions and baseline evidence.'),
      stackAlternatives: notDocumented('See linked stack decisions and baseline evidence.'),
      extractionTriggers: notDocumented('See linked evolution decisions and gates.'),
      migrationTriggers: notDocumented('See linked evolution decisions and gates.'),
      security: notDocumented('See linked trust boundaries and baseline evidence.'),
      authentication: notDocumented('See linked authentication decisions.'),
      authorization: notDocumented('See linked authorization decisions.'),
      sourceAnchors: seed.sourceRanges.map((range) =>
        anchor(sourceText, sourcePath, range, seed.name),
      ),
      decisionIds: seed.decisionIds,
      diagramIds: [],
      stackIds: linkedStackIds,
      trustBoundaryIds: trustBoundarySeeds
        .filter((boundary) => boundary.decisionIds.some((id) => seed.decisionIds.includes(id)))
        .map((boundary) => boundary.id),
    });
  });
  const gates = gateSeeds.map((seed) =>
    GateSchema.parse({
      id: seed.id,
      title: seed.name,
      criterion: seed.criterion,
      phase: seed.phase,
      sourceAnchors: seed.sourceRanges.map((range) =>
        anchor(sourceText, sourcePath, range, seed.name),
      ),
      decisionIds: seed.decisionIds,
      primaryReferences: seed.primaryReferences ?? [],
    }),
  );
  const trustBoundaries = trustBoundarySeeds.map((seed) =>
    TrustBoundarySchema.parse({
      id: seed.id,
      name: seed.name,
      description: `${seed.summary} Forbidden data: ${seed.forbiddenData.join(', ') || 'none documented'}.`,
      owner: {
        kind: 'application',
        id: 'application.mailflow',
        responsibilities: ['Enforce the documented data-flow boundary.'],
      },
      permittedConfidentiality: ['public', 'internal', 'tenant_confidential', 'sensitive'],
      forbiddenConfidentiality: ['secret'],
      sourceAnchors: seed.sourceRanges.map((range) =>
        anchor(sourceText, sourcePath, range, seed.name),
      ),
    }),
  );
  const decisionForRange = (range: LineRangeSeed): DecisionSeed[] => {
    const intersecting = seeds.filter((seed) =>
      seed.sourceRanges.some((sourceRange) => overlaps(sourceRange, range)),
    );
    if (intersecting.length) return intersecting;
    const closestDistance = Math.min(
      ...seeds.flatMap((seed) =>
        seed.sourceRanges.map((sourceRange) => distance(sourceRange, range)),
      ),
    );
    return seeds.filter((seed) =>
      seed.sourceRanges.some((sourceRange) => distance(sourceRange, range) === closestDistance),
    );
  };

  const documentSection = BaselineSectionSchema.parse({
    id: 'baseline.document',
    title: 'Document preamble',
    order: 1,
    sourceRange: {
      startLine: 1,
      endLine: Math.max(1, (parsed.sections[0]?.lineRange.startLine ?? 2) - 1),
    },
    classification: 'classified',
  });
  const baselineSections = [
    documentSection,
    ...parsed.sections.map((section, index) =>
      BaselineSectionSchema.parse({
        id: section.id,
        title: section.title,
        order: index + 2,
        ...(section.parentId ? { parentId: section.parentId } : {}),
        sourceRange: section.lineRange,
        classification: 'classified',
      }),
    ),
  ];
  const baselineBlocks = parsed.blocks.map((block, index) =>
    BaselineBlockSchema.parse({
      id: block.id,
      sectionId: block.sectionId ?? documentSection.id,
      title:
        block.content
          .trim()
          .split('\n')[0]
          ?.replace(/^[-*#\d.)\s]+/u, '')
          .slice(0, 160) || 'Baseline content',
      kind: blockKind(block.kind),
      order: index + 1,
      sourceAnchor: block.sourceAnchor,
      classification: 'classified',
    }),
  );
  const coverage = baselineBlocks.map((block) => {
    const linkedSeeds = decisionForRange(block.sourceAnchor.range);
    return CoverageRecordSchema.parse({
      sectionId: block.sectionId,
      blockId: block.id,
      classification: 'classified',
      decisionIds: linkedSeeds.map((seed) => seed.id),
      serviceIds: [...new Set(linkedSeeds.flatMap((seed) => seed.serviceIds ?? []))],
      diagramIds: [],
      stackIds: [...new Set(linkedSeeds.flatMap((seed) => seed.stackIds ?? []))],
      gateIds: [...new Set(linkedSeeds.flatMap((seed) => seed.gateIds ?? []))],
      relationshipIds: [],
      phase: linkedSeeds[0]?.phase,
      status: linkedSeeds[0]?.status,
      sourceDigest: block.sourceAnchor.digest,
      primaryReferences: [...new Set(linkedSeeds.flatMap((seed) => seed.primaryReferences ?? []))],
    });
  });

  return ArchitectureRegistrySchema.parse({
    decisions,
    services,
    diagrams: [],
    relationships: [],
    stacks,
    gates,
    trustBoundaries,
    baselineSections,
    baselineBlocks,
    coverage,
  });
}
