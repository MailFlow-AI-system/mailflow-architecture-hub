import { describe, expect, test } from 'bun:test';

import {
  ArchitectureRegistrySchema,
  CoverageRecordSchema,
  DecisionSchema,
  SourceAnchorSchema,
  SourceRangeSchema,
  StackSchema,
  createSourceDigest,
  createStableId,
  validateArchitectureRegistry,
} from '../../src/domain/architecture';

const anchor = {
  source: 'docs/architecture/architectureBaseline.md',
  range: { startLine: 1, endLine: 2 },
  digest: createSourceDigest('source excerpt'),
};

const notDocumented = () => ({ status: 'not_documented' as const, items: [] });

const narrative = {
  contextProblem: notDocumented(),
  motivation: notDocumented(),
  alternativesConsidered: notDocumented(),
  alternativesRejected: notDocumented(),
  benefits: notDocumented(),
  tradeOffs: notDocumented(),
  risks: notDocumented(),
  operationalConsequences: notDocumented(),
  mvpImpact: notDocumented(),
  futureImpact: notDocumented(),
  evidence: notDocumented(),
  references: notDocumented(),
};

const decisionId = 'decision.identity.decision-one';
const serviceId = 'service.mail';
const diagramId = 'diagram.overview.mvp';
const stackId = 'stack.typescript';
const sectionId = 'baseline.architecture';
const blockId = 'baseline.architecture.boundaries';

const baseDecision = {
  id: decisionId,
  title: 'Decision one',
  status: 'confirmed' as const,
  phase: 'mvp' as const,
  summary: 'A documented decision.',
  pagePath: '/decisions/decision-one/',
  narrative,
  sourceAnchors: [anchor],
  owner: { kind: 'service' as const, id: serviceId },
  validationGateIds: [],
  serviceIds: [serviceId],
  diagramIds: [diagramId],
  stackIds: [stackId],
  relatedDecisionIds: [],
  trustBoundaryIds: [],
};

const notDocumentedServiceFields = {
  apiContracts: [],
  eventsPublished: [],
  eventsConsumed: [],
  dependencies: [],
  processRoles: [],
  placement: { status: 'not_documented' as const, phases: [], locations: [], conditions: [] },
  stackMotivation: notDocumented(),
  stackTradeOffs: notDocumented(),
  stackAlternatives: notDocumented(),
  extractionTriggers: notDocumented(),
  migrationTriggers: notDocumented(),
  security: notDocumented(),
  authentication: notDocumented(),
  authorization: notDocumented(),
};

const baseService = {
  id: serviceId,
  name: 'Mail',
  responsibility: 'Owns mail capabilities.',
  phase: 'mvp' as const,
  pagePath: '/services/mail/',
  owner: { kind: 'service' as const, id: serviceId },
  dataOwned: ['mail records'],
  dataForbidden: ['unowned service databases'],
  ...notDocumentedServiceFields,
  sourceAnchors: [anchor],
  decisionIds: [decisionId],
  diagramIds: [diagramId],
  stackIds: [stackId],
  trustBoundaryIds: [],
};

const baseStack = {
  id: stackId,
  name: 'TypeScript',
  responsibility: 'Application implementation language.',
  phase: 'mvp' as const,
  status: 'confirmed' as const,
  pagePath: '/stacks/typescript/',
  validationGateIds: [],
  sourceAnchors: [anchor],
  decisionIds: [decisionId],
  serviceIds: [serviceId],
};

const baseDiagram = {
  id: diagramId,
  title: 'MVP overview',
  purpose: 'Shows the bounded MVP view.',
  phase: 'mvp' as const,
  pagePath: '/diagrams/overview/mvp/',
  sourceAnchors: [anchor],
  decisionIds: [decisionId],
  serviceIds: [serviceId],
  relationshipIds: ['relation.decision.identity.decision-one.dependency.service.mail'],
  trustBoundaryIds: [],
  staticOutline: ['Decision one', 'Mail'],
};

const baseRelationship = {
  id: 'relation.decision.identity.decision-one.dependency.service.mail',
  type: 'dependency' as const,
  phase: 'mvp' as const,
  source: { kind: 'decision' as const, id: decisionId },
  target: { kind: 'service' as const, id: serviceId },
  sourceAnchors: [anchor],
  decisionIds: [decisionId],
};

const baseSection = {
  id: sectionId,
  title: 'Architecture',
  order: 1,
  sourceRange: { startLine: 1, endLine: 20 },
  classification: 'classified' as const,
};

const baseBlock = {
  id: blockId,
  sectionId,
  title: 'Boundaries',
  kind: 'decision' as const,
  order: 1,
  sourceAnchor: anchor,
  classification: 'classified' as const,
};

const baseCoverage = {
  sectionId,
  blockId,
  classification: 'classified' as const,
  decisionIds: [decisionId],
  serviceIds: [serviceId],
  diagramIds: [diagramId],
  stackIds: [stackId],
  gateIds: [],
  relationshipIds: [baseRelationship.id],
  sourceDigest: createSourceDigest('coverage'),
};

function registry(overrides: Record<string, unknown> = {}) {
  return {
    decisions: [baseDecision],
    services: [baseService],
    diagrams: [baseDiagram],
    relationships: [baseRelationship],
    stacks: [baseStack],
    gates: [],
    trustBoundaries: [],
    baselineSections: [baseSection],
    baselineBlocks: [baseBlock],
    coverage: [baseCoverage],
    ...overrides,
  };
}

describe('architecture kernel', () => {
  test('creates canonical dotted IDs and content digests deterministically', () => {
    expect(createStableId('decision', 'identity / Browser authentication')).toBe(
      'decision.identity.browser-authentication',
    );
    expect(createStableId('service', 'Mail')).toBe('service.mail');
    expect(createStableId('diagram', 'overview / mvp')).toBe('diagram.overview.mvp');

    expect(createSourceDigest('MailFlow\narchitecture')).toEqual(
      createSourceDigest('MailFlow\narchitecture'),
    );
    expect(createSourceDigest('MailFlow\narchitecture')).not.toEqual(
      createSourceDigest('MailFlow\narchitecture changed'),
    );
  });

  test('counts source lines consistently when content ends with a newline', () => {
    expect(createSourceDigest('one\ntwo\n').lines).toBe(2);
    expect(createSourceDigest('one\ntwo').lines).toBe(2);
    expect(createSourceDigest('').lines).toBe(0);
  });

  test('requires canonical ID prefixes at runtime', () => {
    expect(DecisionSchema.safeParse({ ...baseDecision, id: 'decision-one' }).success).toBe(false);
    expect(DecisionSchema.safeParse({ ...baseDecision, id: 'service.mail' }).success).toBe(false);
    expect(
      ArchitectureRegistrySchema.safeParse(
        registry({
          relationships: [
            { ...baseRelationship, source: { kind: 'decision', id: 'service.mail' } },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  test('requires a validation gate for gated decisions and stacks', () => {
    const gatedDecision = { ...baseDecision, status: 'confirmed_with_validation_gate' as const };
    const gatedStack = { ...baseStack, status: 'confirmed_with_validation_gate' as const };
    expect(DecisionSchema.safeParse(gatedDecision).success).toBe(false);
    expect(StackSchema.safeParse(gatedStack).success).toBe(false);
  });

  test('reports duplicate IDs, dangling references, and missing coverage', () => {
    const report = validateArchitectureRegistry({
      ...registry(),
      decisions: [
        {
          ...baseDecision,
          owner: { kind: 'service' as const, id: 'service.missing' },
          serviceIds: ['service.missing'],
          relatedDecisionIds: ['decision.identity.missing'],
        },
      ],
      coverage: [],
    });

    expect(report.valid).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing_reference' }),
        expect.objectContaining({ code: 'missing_coverage' }),
      ]),
    );
  });

  test('rejects reversed source ranges and unsafe source paths', () => {
    expect(SourceRangeSchema.safeParse({ startLine: 20, endLine: 19 }).success).toBe(false);
    expect(SourceAnchorSchema.safeParse({ ...anchor, source: '/tmp/baseline.md' }).success).toBe(
      false,
    );
    expect(
      SourceAnchorSchema.safeParse({ ...anchor, source: '../architectureBaseline.md' }).success,
    ).toBe(false);
  });

  test('enforces superseded and deferred status invariants', () => {
    expect(DecisionSchema.safeParse({ ...baseDecision, status: 'superseded' }).success).toBe(false);
    expect(DecisionSchema.safeParse({ ...baseDecision, status: 'deferred' }).success).toBe(false);
    expect(
      DecisionSchema.safeParse({
        ...baseDecision,
        status: 'superseded',
        supersededByDecisionId: 'decision.identity.decision-two',
      }).success,
    ).toBe(true);
    expect(
      DecisionSchema.safeParse({
        ...baseDecision,
        status: 'deferred',
        reassessmentTriggers: ['measured latency exceeds the agreed budget'],
      }).success,
    ).toBe(true);
  });

  test('detects duplicate IDs and baseline section/block conflicts', () => {
    const conflictingId = 'baseline.architecture.boundaries';
    const report = validateArchitectureRegistry(
      registry({
        baselineSections: [{ ...baseSection, id: conflictingId }],
        baselineBlocks: [{ ...baseBlock, id: conflictingId }],
      }),
    );

    expect(report.valid).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'conflicting_id' })]),
    );
  });

  test('fails unclassified sections and blocks and requires block-level coverage', () => {
    const report = validateArchitectureRegistry(
      registry({
        baselineSections: [{ ...baseSection, classification: 'not_classified' }],
        baselineBlocks: [{ ...baseBlock, classification: 'not_classified' }],
        coverage: [{ ...baseCoverage, blockId: undefined }],
      }),
    );

    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unclassified_baseline' }),
        expect.objectContaining({ code: 'missing_coverage' }),
      ]),
    );
  });

  test('rejects coverage records whose block belongs to another section', () => {
    const otherSection = { ...baseSection, id: 'baseline.security' };
    const report = validateArchitectureRegistry(
      registry({
        baselineSections: [baseSection, otherSection],
        coverage: [
          baseCoverage,
          { ...baseCoverage, sectionId: otherSection.id, blockId: baseBlock.id },
        ],
      }),
    );

    expect(report.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'coverage_mismatch' })]),
    );
  });

  test('rejects diagram relationships from another phase', () => {
    const report = validateArchitectureRegistry(
      registry({
        relationships: [{ ...baseRelationship, phase: 'future' }],
      }),
    );

    expect(report.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'phase_contradiction' })]),
    );
  });

  test('requires reciprocal gate links and rejects trust-boundary overlap', () => {
    const gateId = 'gate.identity.mfa-spike';
    const gate = {
      id: gateId,
      title: 'MFA spike',
      criterion: 'Validate the selected integration.',
      phase: 'mvp' as const,
      sourceAnchors: [anchor],
      decisionIds: [decisionId],
    };
    const report = validateArchitectureRegistry(
      registry({
        gates: [gate],
        trustBoundaries: [
          {
            id: 'trust.identity',
            name: 'Identity boundary',
            description: 'Owns identity material.',
            owner: { kind: 'service' as const, id: serviceId },
            permittedConfidentiality: ['secret' as const],
            forbiddenConfidentiality: ['secret' as const],
            sourceAnchors: [anchor],
          },
        ],
      }),
    );

    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unlinked_gate' }),
        expect.objectContaining({ code: 'trust_boundary_conflict' }),
      ]),
    );
  });

  test('accepts explicit not_documented service projections without invented facts', () => {
    expect(validateArchitectureRegistry(registry()).valid).toBe(true);
    expect(baseService.security.status).toBe('not_documented');
    expect(baseService.eventsPublished).toEqual([]);
  });

  test('requires reviewer identity and date before coverage becomes human-reviewed', () => {
    expect(() =>
      CoverageRecordSchema.parse({ ...baseCoverage, reviewStatus: 'human_reviewed' }),
    ).toThrow('human-reviewed coverage requires reviewer identity and review date');
    expect(
      CoverageRecordSchema.parse({
        ...baseCoverage,
        reviewStatus: 'human_reviewed',
        reviewedBy: 'MailFlow architecture owner',
        reviewedAt: '2026-08-20',
      }).reviewStatus,
    ).toBe('human_reviewed');
  });
});
