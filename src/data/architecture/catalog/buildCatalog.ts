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
  type NarrativeText,
} from '../../../domain/architecture';
import { parseBaselineText } from '../../../domain/architecture/baseline';
import {
  compileSemanticAnnotations,
  type SemanticAnnotationInput,
} from '../../../domain/architecture/baseline/semantic';
import type { ArchitectureDiagramDefinition } from '../diagrams';
import { integrateArchitectureDiagrams } from './integrateDiagrams';
import type { ArchitectureShard, DecisionSeed, LineRangeSeed } from './types';

function overlaps(left: LineRangeSeed, right: LineRangeSeed): boolean {
  return left.startLine <= right.endLine && right.startLine <= left.endLine;
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

function documentedEvidence(
  evidence: readonly string[],
  pattern: RegExp,
  note: string,
): NarrativeText {
  const items = evidence.filter((item) => pattern.test(item));
  return items.length > 0 ? { status: 'documented', items } : notDocumented(note);
}

function decisionFromSeed(
  seed: DecisionSeed,
  sourceText: string,
  sourcePath: string,
  reciprocalGateIds: string[],
): Decision {
  const evidence = seed.sourceRanges.map((range) => sourceExcerpt(sourceText, range).trim());
  const alternatives = /alternative|fallback|instead|versus|rejected|deferred|do not|avoid/iu;
  const benefits = /benefit|advantage|enable|allow|reduce|preserve|simplif|keep/iu;
  const tradeOffs = /trade-off|tradeoff|cost|complex|constraint|limit|disadvantage/iu;
  const risks = /risk|threat|failure|abuse|loss|exposure|unavailable|unknown/iu;
  const operations =
    /operation|retry|monitor|deploy|runbook|alert|SLO|backup|recover|rotat|worker|scheduler/iu;
  const context = /context|problem|need|because|requirement|must|constraint|goal|risk/iu;
  const motivation =
    /because|reason|motivat|chosen|prefer|so that|to (?:ensure|avoid|enable|preserve|reduce)|benefit|why/iu;
  return DecisionSchema.parse({
    id: DecisionIdSchema.parse(seed.id),
    title: seed.title,
    status: seed.status,
    phase: seed.phase,
    summary: seed.summary,
    pagePath: `/decisions/${seed.id}/`,
    narrative: {
      contextProblem: documentedEvidence(
        evidence,
        context,
        'No explicit context or problem statement is classified in this decision range.',
      ),
      motivation: documentedEvidence(
        evidence,
        motivation,
        'No explicit motivation statement is classified in this decision range.',
      ),
      alternativesConsidered: documentedEvidence(
        evidence,
        alternatives,
        'No explicit alternative is classified in this decision range.',
      ),
      alternativesRejected: documentedEvidence(
        evidence,
        /rejected|do not|avoid|not selected|instead/iu,
        'No explicitly rejected alternative is classified in this decision range.',
      ),
      benefits: documentedEvidence(
        evidence,
        benefits,
        'No separate benefit statement is classified in this decision range.',
      ),
      tradeOffs: documentedEvidence(
        evidence,
        tradeOffs,
        'No explicit trade-off statement is classified in this decision range.',
      ),
      risks: documentedEvidence(
        evidence,
        risks,
        'No explicit risk statement is classified in this decision range.',
      ),
      operationalConsequences: documentedEvidence(
        evidence,
        operations,
        'No explicit operational consequence is classified in this decision range.',
      ),
      mvpImpact: documentedEvidence(
        evidence,
        /\bMVP\b|initial(?:ly| release| phase)?|first release|phase 1/iu,
        'No explicit MVP impact is classified in this decision range.',
      ),
      futureImpact: documentedEvidence(
        evidence,
        /future|later|extract|migration|evolution|distributed/iu,
        'No explicit future impact is classified in this decision range.',
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
  diagramDefinitions: readonly ArchitectureDiagramDefinition[] = [],
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
    return ServiceSchema.parse({
      id: seed.id,
      name: seed.name,
      responsibility: seed.summary,
      phase: seed.phase,
      pagePath: `/services/${seed.id}/`,
      owner: {
        kind: 'service',
        id: seed.id,
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
      stackStatus: linkedStackIds.length > 0 ? 'documented' : 'not_documented',
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
  const annotationForRange = (range: LineRangeSeed): SemanticAnnotationInput => {
    const linkedDecisions = seeds.filter((seed) =>
      seed.sourceRanges.some((sourceRange) => overlaps(sourceRange, range)),
    );
    const linkedDecisionIds = linkedDecisions.map((seed) => seed.id);
    const serviceIds = [
      ...new Set([
        ...serviceSeeds
          .filter((seed) => seed.sourceRanges.some((sourceRange) => overlaps(sourceRange, range)))
          .map((seed) => seed.id),
        ...linkedDecisions.flatMap((seed) => seed.serviceIds ?? []),
      ]),
    ];
    const stackIds = [
      ...new Set([
        ...stackSeeds
          .filter((seed) => seed.sourceRanges.some((sourceRange) => overlaps(sourceRange, range)))
          .map((seed) => seed.id),
        ...linkedDecisions.flatMap((seed) => seed.stackIds ?? []),
      ]),
    ];
    const gateIds = [
      ...new Set([
        ...gateSeeds
          .filter((seed) => seed.sourceRanges.some((sourceRange) => overlaps(sourceRange, range)))
          .map((seed) => seed.id),
        ...linkedDecisions.flatMap((seed) => seed.gateIds ?? []),
      ]),
    ];
    const diagramIds = diagramDefinitions
      .filter(
        (diagram) =>
          diagram.sourceRanges.some((sourceRange) => overlaps(sourceRange, range)) ||
          diagram.decisionIds.some((id) => linkedDecisionIds.includes(id)),
      )
      .map((diagram) => diagram.id);
    const hasProjection =
      linkedDecisionIds.length +
        serviceIds.length +
        stackIds.length +
        gateIds.length +
        diagramIds.length >
      0;
    return {
      classification: hasProjection ? 'classified' : 'not_applicable',
      phase: linkedDecisions[0]?.phase,
      status: linkedDecisions[0]?.status,
      decisionIds: linkedDecisionIds,
      serviceIds,
      stackIds,
      gateIds,
      diagramIds,
    };
  };

  const semanticCompilation = compileSemanticAnnotations(parsed, {
    rules: [
      ...parsed.sections.map((section, index) => ({
        id: `rule.catalog.section-${index + 1}`,
        kind: 'override' as const,
        target: { kind: 'section' as const, sectionId: section.id },
        annotation: annotationForRange(section.lineRange),
      })),
      ...parsed.blocks.map((block, index) => ({
        id: `rule.catalog.block-${index + 1}`,
        kind: 'override' as const,
        target: { kind: 'block' as const, blockId: block.id },
        annotation: annotationForRange(block.lineRange),
      })),
    ],
    catalog: {
      decisionIds: seeds.map((seed) => seed.id),
      serviceIds: serviceSeeds.map((seed) => seed.id),
      stackIds: stackSeeds.map((seed) => seed.id),
      gateIds: gateSeeds.map((seed) => seed.id),
      diagramIds: diagramDefinitions.map((diagram) => diagram.id),
    },
  });
  const semanticSections = new Map(
    semanticCompilation.sections.map((section) => [section.sectionId, section]),
  );
  const semanticBlocks = new Map(semanticCompilation.blocks.map((block) => [block.blockId, block]));

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
        classification: semanticSections.get(section.id)?.classification ?? 'not_classified',
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
      classification: semanticBlocks.get(block.id)?.classification ?? 'not_classified',
    }),
  );
  const routesFor = (record: {
    decisionIds: readonly string[];
    serviceIds: readonly string[];
    diagramIds: readonly string[];
    stackIds: readonly string[];
    gateIds: readonly string[];
  }) => [
    '/coverage/',
    ...record.decisionIds.map((id) => `/decisions/${id}/`),
    ...record.serviceIds.map((id) => `/services/${id}/`),
    ...record.diagramIds.map((id) => `/explorer/${id}/`),
    ...record.stackIds.map((id) => `/stacks/${id}/`),
    ...(record.gateIds.length ? ['/gates/'] : []),
  ];
  const documentAnnotation = annotationForRange(documentSection.sourceRange);
  const documentCoverage = CoverageRecordSchema.parse({
    sectionId: documentSection.id,
    ...documentAnnotation,
    sourceDigest: anchor(sourceText, sourcePath, documentSection.sourceRange, documentSection.title)
      .digest,
    relationshipIds: [],
    primaryReferences: [],
    pageRoutes: routesFor({
      decisionIds: documentAnnotation.decisionIds ?? [],
      serviceIds: documentAnnotation.serviceIds ?? [],
      diagramIds: documentAnnotation.diagramIds ?? [],
      stackIds: documentAnnotation.stackIds ?? [],
      gateIds: documentAnnotation.gateIds ?? [],
    }),
    reviewStatus: 'machine_classified',
    baselineChecksum: { algorithm: 'sha256', value: parsed.version.checksum },
  });
  const sectionCoverage = parsed.sections.map((section) => {
    const semantic = semanticSections.get(section.id);
    if (!semantic) throw new Error(`missing compiled semantic section: ${section.id}`);
    return CoverageRecordSchema.parse({
      sectionId: section.id,
      classification: semantic.classification,
      decisionIds: semantic.decisionIds,
      serviceIds: semantic.serviceIds,
      diagramIds: semantic.diagramIds,
      stackIds: semantic.stackIds,
      gateIds: semantic.gateIds,
      relationshipIds: [],
      phase: semantic.phase,
      status: semantic.status,
      sourceDigest: semantic.sourceAnchor.digest,
      primaryReferences: [
        ...new Set(
          semantic.decisionIds.flatMap(
            (id) => seeds.find((seed) => seed.id === id)?.primaryReferences ?? [],
          ),
        ),
      ],
      pageRoutes: routesFor(semantic),
      reviewStatus: 'machine_classified',
      baselineChecksum: { algorithm: 'sha256', value: parsed.version.checksum },
    });
  });
  const blockCoverage = baselineBlocks.map((block) => {
    const semantic = semanticBlocks.get(block.id);
    if (!semantic) throw new Error(`missing compiled semantic block: ${block.id}`);
    return CoverageRecordSchema.parse({
      sectionId: block.sectionId,
      blockId: block.id,
      classification: semantic.classification,
      decisionIds: semantic.decisionIds,
      serviceIds: semantic.serviceIds,
      diagramIds: semantic.diagramIds,
      stackIds: semantic.stackIds,
      gateIds: semantic.gateIds,
      relationshipIds: [],
      phase: semantic.phase,
      status: semantic.status,
      sourceDigest: semantic.sourceAnchor.digest,
      primaryReferences: [
        ...new Set(
          semantic.decisionIds.flatMap(
            (id) => seeds.find((seed) => seed.id === id)?.primaryReferences ?? [],
          ),
        ),
      ],
      pageRoutes: routesFor(semantic),
      reviewStatus: 'machine_classified',
      baselineChecksum: { algorithm: 'sha256', value: parsed.version.checksum },
    });
  });
  const coverage = [documentCoverage, ...sectionCoverage, ...blockCoverage];

  const baseRegistry = ArchitectureRegistrySchema.parse({
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

  return diagramDefinitions.length > 0
    ? integrateArchitectureDiagrams(baseRegistry, diagramDefinitions, sourceText, sourcePath)
    : baseRegistry;
}
