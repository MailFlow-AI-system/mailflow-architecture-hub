import { ArchitectureRegistrySchema } from './schemas';
import type { ArchitectureRegistry } from './schemas';
import type { EntityKind } from './ids';

export type IntegrityErrorCode =
  | 'schema_invalid'
  | 'duplicate_id'
  | 'conflicting_id'
  | 'missing_reference'
  | 'missing_coverage'
  | 'duplicate_coverage'
  | 'missing_stack'
  | 'invalid_relationship'
  | 'unclassified_baseline'
  | 'coverage_mismatch'
  | 'phase_contradiction'
  | 'unlinked_gate'
  | 'trust_boundary_conflict';

export type IntegrityError = {
  code: IntegrityErrorCode;
  path: string;
  message: string;
};

export type IntegrityReport = {
  valid: boolean;
  errors: IntegrityError[];
};

type Identified = { id: string };

function error(code: IntegrityErrorCode, path: string, message: string): IntegrityError {
  return { code, path, message };
}

function addReferenceError(
  errors: IntegrityError[],
  path: string,
  kind: EntityKind,
  id: string,
): void {
  errors.push(
    error('missing_reference', path, `${kind} reference "${id}" does not exist in the registry`),
  );
}

export function validateArchitectureRegistry(input: unknown): IntegrityReport {
  const parsed = ArchitectureRegistrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) =>
        error('schema_invalid', issue.path.join('.'), issue.message),
      ),
    };
  }

  const registry = parsed.data;
  const errors: IntegrityError[] = [];
  const collections: Array<{
    kind: EntityKind;
    name: string;
    entries: Identified[];
  }> = [
    { kind: 'decision', name: 'decisions', entries: registry.decisions },
    { kind: 'service', name: 'services', entries: registry.services },
    { kind: 'diagram', name: 'diagrams', entries: registry.diagrams },
    {
      kind: 'relationship',
      name: 'relationships',
      entries: registry.relationships,
    },
    { kind: 'stack', name: 'stacks', entries: registry.stacks },
    { kind: 'gate', name: 'gates', entries: registry.gates },
    {
      kind: 'trust_boundary',
      name: 'trustBoundaries',
      entries: registry.trustBoundaries,
    },
    {
      kind: 'baseline_section',
      name: 'baselineSections',
      entries: registry.baselineSections,
    },
    {
      kind: 'baseline_block',
      name: 'baselineBlocks',
      entries: registry.baselineBlocks,
    },
  ];

  const idsByKind = new Map<EntityKind, Set<string>>();
  const firstKindById = new Map<string, EntityKind>();
  for (const collection of collections) {
    const ids = new Set<string>();
    idsByKind.set(collection.kind, ids);
    for (const [index, entry] of collection.entries.entries()) {
      if (ids.has(entry.id)) {
        errors.push(
          error(
            'duplicate_id',
            `${collection.name}.${index}.id`,
            `${collection.kind} ID "${entry.id}" is duplicated`,
          ),
        );
      }
      ids.add(entry.id);

      const firstKind = firstKindById.get(entry.id);
      if (firstKind && firstKind !== collection.kind) {
        errors.push(
          error(
            'conflicting_id',
            `${collection.name}.${index}.id`,
            `ID "${entry.id}" is used by both ${firstKind} and ${collection.kind}`,
          ),
        );
      } else if (!firstKind) {
        firstKindById.set(entry.id, collection.kind);
      }
    }
  }

  const has = (kind: EntityKind, id: string): boolean => idsByKind.get(kind)?.has(id) ?? false;
  const requireRefs = (path: string, kind: EntityKind, ids: readonly string[]): void => {
    for (const [index, id] of ids.entries()) {
      if (!has(kind, id)) {
        addReferenceError(errors, `${path}.${index}`, kind, id);
      }
    }
  };

  registry.decisions.forEach((decision, index) => {
    if (decision.owner.kind === 'service' && !has('service', decision.owner.id)) {
      addReferenceError(errors, `decisions.${index}.owner.id`, 'service', decision.owner.id);
    }
    requireRefs(`decisions.${index}.validationGateIds`, 'gate', decision.validationGateIds);
    requireRefs(`decisions.${index}.serviceIds`, 'service', decision.serviceIds);
    requireRefs(`decisions.${index}.diagramIds`, 'diagram', decision.diagramIds);
    requireRefs(`decisions.${index}.stackIds`, 'stack', decision.stackIds);
    requireRefs(`decisions.${index}.relatedDecisionIds`, 'decision', decision.relatedDecisionIds);
    requireRefs(`decisions.${index}.trustBoundaryIds`, 'trust_boundary', decision.trustBoundaryIds);
    if (decision.supersededByDecisionId && decision.supersededByDecisionId === decision.id) {
      errors.push(
        error(
          'invalid_relationship',
          `decisions.${index}.supersededByDecisionId`,
          'a decision cannot supersede itself',
        ),
      );
    }
    if (decision.supersededByDecisionId) {
      requireRefs(`decisions.${index}.supersededByDecisionId`, 'decision', [
        decision.supersededByDecisionId,
      ]);
    }
  });

  registry.services.forEach((service, index) => {
    if (service.owner.kind === 'service' && !has('service', service.owner.id)) {
      addReferenceError(errors, `services.${index}.owner.id`, 'service', service.owner.id);
    }
    if (service.owner.kind !== 'service' || service.owner.id !== service.id) {
      errors.push(
        error(
          'missing_reference',
          `services.${index}.owner`,
          `service "${service.id}" must own its bounded-context projection explicitly`,
        ),
      );
    }
    requireRefs(`services.${index}.decisionIds`, 'decision', service.decisionIds);
    requireRefs(`services.${index}.diagramIds`, 'diagram', service.diagramIds);
    requireRefs(`services.${index}.stackIds`, 'stack', service.stackIds);
    requireRefs(`services.${index}.trustBoundaryIds`, 'trust_boundary', service.trustBoundaryIds);
    if (service.stackStatus === 'documented' && service.stackIds.length === 0) {
      errors.push(
        error(
          'missing_stack',
          `services.${index}.stackIds`,
          `service "${service.id}" has no documented stack`,
        ),
      );
    }
  });

  registry.diagrams.forEach((diagram, index) => {
    requireRefs(`diagrams.${index}.decisionIds`, 'decision', diagram.decisionIds);
    requireRefs(`diagrams.${index}.serviceIds`, 'service', diagram.serviceIds);
    requireRefs(`diagrams.${index}.relationshipIds`, 'relationship', diagram.relationshipIds);
    requireRefs(`diagrams.${index}.trustBoundaryIds`, 'trust_boundary', diagram.trustBoundaryIds);
    for (const [decisionIndex, decisionId] of diagram.decisionIds.entries()) {
      const decision = registry.decisions.find((item) => item.id === decisionId);
      if (decision && !decision.diagramIds.includes(diagram.id)) {
        errors.push(
          error(
            'invalid_relationship',
            `diagrams.${index}.decisionIds.${decisionIndex}`,
            `diagram "${diagram.id}" is not reciprocally linked by decision "${decisionId}"`,
          ),
        );
      }
    }
    for (const [serviceIndex, serviceId] of diagram.serviceIds.entries()) {
      const service = registry.services.find((item) => item.id === serviceId);
      if (service && !service.diagramIds.includes(diagram.id)) {
        errors.push(
          error(
            'invalid_relationship',
            `diagrams.${index}.serviceIds.${serviceIndex}`,
            `diagram "${diagram.id}" is not reciprocally linked by service "${serviceId}"`,
          ),
        );
      }
    }
    for (const [relationshipIndex, relationshipId] of diagram.relationshipIds.entries()) {
      const relationship = registry.relationships.find((item) => item.id === relationshipId);
      const declaredPhases = new Set([diagram.phase, ...diagram.phases]);
      if (relationship && !declaredPhases.has(relationship.phase)) {
        errors.push(
          error(
            'phase_contradiction',
            `diagrams.${index}.relationshipIds.${relationshipIndex}`,
            `diagram phase "${diagram.phase}" contradicts relationship phase "${relationship.phase}"`,
          ),
        );
      }
    }
  });

  registry.relationships.forEach((relationship, index) => {
    if (
      relationship.source.kind === relationship.target.kind &&
      relationship.source.id === relationship.target.id &&
      (!relationship.visualSourceNodeId ||
        !relationship.visualTargetNodeId ||
        relationship.visualSourceNodeId === relationship.visualTargetNodeId)
    ) {
      errors.push(
        error(
          'invalid_relationship',
          `relationships.${index}`,
          'a relationship cannot connect an entity to itself',
        ),
      );
    }
    if (!has(relationship.source.kind, relationship.source.id)) {
      addReferenceError(
        errors,
        `relationships.${index}.source.id`,
        relationship.source.kind,
        relationship.source.id,
      );
    }
    if (!has(relationship.target.kind, relationship.target.id)) {
      addReferenceError(
        errors,
        `relationships.${index}.target.id`,
        relationship.target.kind,
        relationship.target.id,
      );
    }
    requireRefs(`relationships.${index}.decisionIds`, 'decision', relationship.decisionIds);
    if (relationship.diagramId) {
      requireRefs(`relationships.${index}.diagramId`, 'diagram', [relationship.diagramId]);
      const diagram = registry.diagrams.find((item) => item.id === relationship.diagramId);
      if (diagram) {
        if (!diagram.relationshipIds.includes(relationship.id)) {
          errors.push(
            error(
              'invalid_relationship',
              `relationships.${index}.diagramId`,
              `relationship "${relationship.id}" is not reciprocally linked by diagram "${diagram.id}"`,
            ),
          );
        }
        if (
          relationship.visualSourceNodeId &&
          !diagram.nodeIds.includes(relationship.visualSourceNodeId)
        ) {
          errors.push(
            error(
              'invalid_relationship',
              `relationships.${index}.visualSourceNodeId`,
              `source node "${relationship.visualSourceNodeId}" does not exist in diagram "${diagram.id}"`,
            ),
          );
        }
        if (
          relationship.visualTargetNodeId &&
          !diagram.nodeIds.includes(relationship.visualTargetNodeId)
        ) {
          errors.push(
            error(
              'invalid_relationship',
              `relationships.${index}.visualTargetNodeId`,
              `target node "${relationship.visualTargetNodeId}" does not exist in diagram "${diagram.id}"`,
            ),
          );
        }
      }
    }
    if (relationship.trustBoundaryId && !has('trust_boundary', relationship.trustBoundaryId)) {
      addReferenceError(
        errors,
        `relationships.${index}.trustBoundaryId`,
        'trust_boundary',
        relationship.trustBoundaryId,
      );
    }
  });

  registry.stacks.forEach((stack, index) => {
    requireRefs(`stacks.${index}.decisionIds`, 'decision', stack.decisionIds);
    requireRefs(`stacks.${index}.serviceIds`, 'service', stack.serviceIds);
    requireRefs(`stacks.${index}.validationGateIds`, 'gate', stack.validationGateIds);
  });

  registry.gates.forEach((gate, index) => {
    requireRefs(`gates.${index}.decisionIds`, 'decision', gate.decisionIds);
    for (const [decisionIndex, decisionId] of gate.decisionIds.entries()) {
      const decision = registry.decisions.find((item) => item.id === decisionId);
      if (decision && !decision.validationGateIds.includes(gate.id)) {
        errors.push(
          error(
            'unlinked_gate',
            `gates.${index}.decisionIds.${decisionIndex}`,
            `gate "${gate.id}" is not reciprocally linked by decision "${decision.id}"`,
          ),
        );
      }
    }
  });

  registry.trustBoundaries.forEach((boundary, index) => {
    if (boundary.owner.kind === 'service' && !has('service', boundary.owner.id)) {
      addReferenceError(errors, `trustBoundaries.${index}.owner.id`, 'service', boundary.owner.id);
    }
    const permitted = new Set(boundary.permittedConfidentiality);
    for (const [
      confidentialityIndex,
      classification,
    ] of boundary.forbiddenConfidentiality.entries()) {
      if (permitted.has(classification)) {
        errors.push(
          error(
            'trust_boundary_conflict',
            `trustBoundaries.${index}.forbiddenConfidentiality.${confidentialityIndex}`,
            `confidentiality class "${classification}" cannot be both permitted and forbidden`,
          ),
        );
      }
    }
  });

  registry.baselineSections.forEach((section, index) => {
    if (section.classification === 'not_classified') {
      errors.push(
        error(
          'unclassified_baseline',
          `baselineSections.${index}.classification`,
          `baseline section "${section.id}" is not classified`,
        ),
      );
    }
    if (section.parentId && !has('baseline_section', section.parentId)) {
      addReferenceError(
        errors,
        `baselineSections.${index}.parentId`,
        'baseline_section',
        section.parentId,
      );
    }
  });

  registry.baselineBlocks.forEach((block, index) => {
    if (block.classification === 'not_classified') {
      errors.push(
        error(
          'unclassified_baseline',
          `baselineBlocks.${index}.classification`,
          `baseline block "${block.id}" is not classified`,
        ),
      );
    }
    if (!has('baseline_section', block.sectionId)) {
      addReferenceError(
        errors,
        `baselineBlocks.${index}.sectionId`,
        'baseline_section',
        block.sectionId,
      );
    }
  });

  const coverageKeys = new Set<string>();
  const coveredSections = new Set<string>();
  const coveredBlocks = new Set<string>();
  const coveredDecisions = new Set<string>();
  registry.coverage.forEach((record, index) => {
    const key = `${record.sectionId}:${record.blockId ?? 'section'}`;
    if (coverageKeys.has(key)) {
      errors.push(
        error('duplicate_coverage', `coverage.${index}`, `coverage record "${key}" is duplicated`),
      );
    }
    coverageKeys.add(key);
    coveredSections.add(record.sectionId);
    for (const id of record.decisionIds) {
      coveredDecisions.add(id);
    }
    if (!has('baseline_section', record.sectionId)) {
      addReferenceError(
        errors,
        `coverage.${index}.sectionId`,
        'baseline_section',
        record.sectionId,
      );
    }
    if (record.blockId && !has('baseline_block', record.blockId)) {
      addReferenceError(errors, `coverage.${index}.blockId`, 'baseline_block', record.blockId);
    }
    if (record.blockId) {
      const block = registry.baselineBlocks.find((item) => item.id === record.blockId);
      if (block) {
        coveredBlocks.add(block.id);
        if (block.sectionId !== record.sectionId) {
          errors.push(
            error(
              'coverage_mismatch',
              `coverage.${index}.blockId`,
              `block "${block.id}" belongs to section "${block.sectionId}", not "${record.sectionId}"`,
            ),
          );
        }
      }
    }
    requireRefs(`coverage.${index}.decisionIds`, 'decision', record.decisionIds);
    requireRefs(`coverage.${index}.serviceIds`, 'service', record.serviceIds);
    requireRefs(`coverage.${index}.diagramIds`, 'diagram', record.diagramIds);
    requireRefs(`coverage.${index}.stackIds`, 'stack', record.stackIds);
    requireRefs(`coverage.${index}.gateIds`, 'gate', record.gateIds);
    requireRefs(`coverage.${index}.relationshipIds`, 'relationship', record.relationshipIds);
  });

  registry.baselineSections.forEach((section, index) => {
    if (!coveredSections.has(section.id)) {
      errors.push(
        error(
          'missing_coverage',
          `baselineSections.${index}`,
          `baseline section "${section.id}" has no coverage record`,
        ),
      );
    }
  });
  registry.baselineBlocks.forEach((block, index) => {
    if (!coveredBlocks.has(block.id)) {
      errors.push(
        error(
          'missing_coverage',
          `baselineBlocks.${index}`,
          `baseline block "${block.id}" has no block-level coverage record`,
        ),
      );
    }
  });
  registry.decisions.forEach((decision, index) => {
    if (!coveredDecisions.has(decision.id)) {
      errors.push(
        error(
          'missing_coverage',
          `decisions.${index}`,
          `decision "${decision.id}" is not mapped by coverage`,
        ),
      );
    }
  });

  return { valid: errors.length === 0, errors };
}

export function assertArchitectureRegistry(input: unknown): ArchitectureRegistry {
  const parsed = ArchitectureRegistrySchema.parse(input);
  const report = validateArchitectureRegistry(parsed);
  if (!report.valid) {
    throw new Error(report.errors.map((item) => `${item.code}: ${item.message}`).join('; '));
  }
  return parsed;
}
