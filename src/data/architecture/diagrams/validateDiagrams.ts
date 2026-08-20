import {
  createSourceAnchor,
  createSourceDigest,
  type ArchitectureRegistry,
} from '../../../domain/architecture';
import sourceDigests from './sourceDigests.json';
import type { ArchitectureDiagramDefinition } from './types';

export type DiagramIntegrityError = {
  path: string;
  message: string;
};

export type DiagramIntegrityReport = {
  valid: boolean;
  errors: DiagramIntegrityError[];
};

export function validateArchitectureDiagrams(
  diagrams: readonly ArchitectureDiagramDefinition[],
  registry: ArchitectureRegistry,
  sourceText?: string,
  sourcePath = 'docs/architecture/architectureBaseline.md',
): DiagramIntegrityReport {
  const errors: DiagramIntegrityError[] = [];
  const diagramIds = new Set<string>();
  const edgeIds = new Set<string>();
  const knownDecisions = new Set<string>(registry.decisions.map((item) => item.id));
  const knownServices = new Set<string>(registry.services.map((item) => item.id));
  const knownStacks = new Set<string>(registry.stacks.map((item) => item.id));
  const knownTrust = new Set<string>(registry.trustBoundaries.map((item) => item.id));
  const decisionsById = new Map<string, (typeof registry.decisions)[number]>(
    registry.decisions.map((item) => [item.id, item]),
  );
  const servicesById = new Map<string, (typeof registry.services)[number]>(
    registry.services.map((item) => [item.id, item]),
  );
  const stacksById = new Map<string, (typeof registry.stacks)[number]>(
    registry.stacks.map((item) => [item.id, item]),
  );
  const sourceLines = sourceText?.split(/(?<=\n)/u) ?? [];
  if (sourceText && sourceDigests.baselineChecksum !== createSourceDigest(sourceText).value) {
    errors.push({
      path: 'sourceDigests.baselineChecksum',
      message: 'persisted diagram provenance targets a different baseline checksum',
    });
  }
  const phaseOrder = { mvp: 0, first_distributed: 1, future: 2 } as const;
  const requireApplicablePhase = (
    path: string,
    entityPhase: keyof typeof phaseOrder,
    targetPhases: readonly (keyof typeof phaseOrder)[],
    kind: string,
    id: string,
  ) => {
    if (!targetPhases.some((phase) => phaseOrder[entityPhase] <= phaseOrder[phase])) {
      errors.push({
        path,
        message: `${kind} ${id} enters in ${entityPhase} and cannot appear in ${targetPhases.join(', ')}`,
      });
    }
  };

  const requireRefs = (
    path: string,
    values: readonly string[],
    known: ReadonlySet<string>,
    kind: string,
  ) => {
    for (const value of values) {
      if (!known.has(value)) errors.push({ path, message: `unknown ${kind} reference: ${value}` });
    }
  };

  diagrams.forEach((diagram, diagramIndex) => {
    const path = `diagrams.${diagramIndex}`;
    if (diagramIds.has(diagram.id))
      errors.push({ path: `${path}.id`, message: `duplicate diagram ID: ${diagram.id}` });
    diagramIds.add(diagram.id);
    if (diagram.decisionIds.length === 0)
      errors.push({ path: `${path}.decisionIds`, message: 'diagram has no source decision' });
    if (diagram.sourceRanges.length === 0)
      errors.push({ path: `${path}.sourceRanges`, message: 'diagram has no source range' });
    const canonicalDiagram = registry.diagrams.find((item) => item.id === diagram.id);
    if (!canonicalDiagram)
      errors.push({ path: `${path}.id`, message: 'diagram is absent from canonical registry' });
    for (const [rangeIndex, range] of diagram.sourceRanges.entries()) {
      if (
        range.startLine < 1 ||
        range.endLine < range.startLine ||
        (sourceText && range.endLine > sourceLines.length)
      ) {
        errors.push({
          path: `${path}.sourceRanges.${rangeIndex}`,
          message: `source range ${range.startLine}-${range.endLine} is outside the active baseline`,
        });
        continue;
      }
      if (sourceText && canonicalDiagram) {
        const expected = createSourceAnchor({
          source: sourcePath,
          startLine: range.startLine,
          endLine: range.endLine,
          excerpt: sourceLines.slice(range.startLine - 1, range.endLine).join(''),
          heading: diagram.title,
        });
        const recorded = canonicalDiagram.sourceAnchors.find(
          (item) =>
            item.range.startLine === range.startLine && item.range.endLine === range.endLine,
        );
        if (!recorded || recorded.digest.value !== expected.digest.value) {
          errors.push({
            path: `${path}.sourceRanges.${rangeIndex}`,
            message: 'source range digest does not match the active baseline',
          });
        }
        const persisted = sourceDigests.diagrams[
          diagram.id as keyof typeof sourceDigests.diagrams
        ]?.find(
          (item) =>
            item.range.startLine === range.startLine && item.range.endLine === range.endLine,
        );
        if (!persisted || persisted.digest !== expected.digest.value) {
          errors.push({
            path: `${path}.sourceRanges.${rangeIndex}`,
            message: 'source range digest differs from the persisted diagram provenance',
          });
        }
      }
    }
    requireRefs(`${path}.decisionIds`, diagram.decisionIds, knownDecisions, 'decision');
    requireRefs(`${path}.serviceIds`, diagram.serviceIds, knownServices, 'service');
    requireRefs(`${path}.trustBoundaryIds`, diagram.trustBoundaryIds, knownTrust, 'trust boundary');
    for (const id of diagram.decisionIds) {
      const decision = decisionsById.get(id);
      if (decision)
        requireApplicablePhase(
          `${path}.decisionIds`,
          decision.phase,
          diagram.phases,
          'decision',
          id,
        );
    }

    const nodeIds = new Set<string>();
    diagram.nodes.forEach((node, nodeIndex) => {
      const nodePath = `${path}.nodes.${nodeIndex}`;
      if (nodeIds.has(node.id))
        errors.push({ path: `${nodePath}.id`, message: `duplicate node ID in view: ${node.id}` });
      nodeIds.add(node.id);
      if (node.decisionIds.length === 0)
        errors.push({ path: `${nodePath}.decisionIds`, message: 'node has no source decision' });
      requireRefs(`${nodePath}.decisionIds`, node.decisionIds, knownDecisions, 'decision');
      requireRefs(`${nodePath}.stackIds`, node.stackIds ?? [], knownStacks, 'stack');
      requireRefs(
        `${nodePath}.trustBoundaryIds`,
        node.trustBoundaryIds ?? [],
        knownTrust,
        'trust boundary',
      );
      if (node.serviceId && !knownServices.has(node.serviceId))
        errors.push({
          path: `${nodePath}.serviceId`,
          message: `unknown service reference: ${node.serviceId}`,
        });
      if (node.serviceId) {
        const service = servicesById.get(node.serviceId);
        if (service)
          requireApplicablePhase(
            `${nodePath}.serviceId`,
            service.phase,
            node.phases,
            'service',
            node.serviceId,
          );
      }
      for (const id of node.decisionIds) {
        const decision = decisionsById.get(id);
        if (decision)
          requireApplicablePhase(
            `${nodePath}.decisionIds`,
            decision.phase,
            node.phases,
            'decision',
            id,
          );
      }
      for (const id of node.stackIds ?? []) {
        const stack = stacksById.get(id);
        if (stack)
          requireApplicablePhase(`${nodePath}.stackIds`, stack.phase, node.phases, 'stack', id);
      }
      for (const phase of node.phases)
        if (!diagram.phases.includes(phase))
          errors.push({
            path: `${nodePath}.phases`,
            message: `node phase ${phase} is outside diagram phases`,
          });
    });

    diagram.edges.forEach((edge, edgeIndex) => {
      const edgePath = `${path}.edges.${edgeIndex}`;
      if (edgeIds.has(edge.id))
        errors.push({ path: `${edgePath}.id`, message: `duplicate edge ID: ${edge.id}` });
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.source))
        errors.push({ path: `${edgePath}.source`, message: `unknown edge source: ${edge.source}` });
      if (!nodeIds.has(edge.target))
        errors.push({ path: `${edgePath}.target`, message: `unknown edge target: ${edge.target}` });
      if (edge.decisionIds.length === 0)
        errors.push({ path: `${edgePath}.decisionIds`, message: 'edge has no source decision' });
      requireRefs(`${edgePath}.decisionIds`, edge.decisionIds, knownDecisions, 'decision');
      for (const id of edge.decisionIds) {
        const decision = decisionsById.get(id);
        if (decision)
          requireApplicablePhase(
            `${edgePath}.decisionIds`,
            decision.phase,
            edge.phases,
            'decision',
            id,
          );
      }
      if (edge.trustBoundaryId && !knownTrust.has(edge.trustBoundaryId))
        errors.push({
          path: `${edgePath}.trustBoundaryId`,
          message: `unknown trust boundary reference: ${edge.trustBoundaryId}`,
        });
      for (const phase of edge.phases)
        if (!diagram.phases.includes(phase))
          errors.push({
            path: `${edgePath}.phases`,
            message: `edge phase ${phase} is outside diagram phases`,
          });
    });
  });

  return { valid: errors.length === 0, errors };
}
