import type { ArchitectureRegistry } from '../../../domain/architecture';
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
): DiagramIntegrityReport {
  const errors: DiagramIntegrityError[] = [];
  const diagramIds = new Set<string>();
  const edgeIds = new Set<string>();
  const knownDecisions = new Set<string>(registry.decisions.map((item) => item.id));
  const knownServices = new Set<string>(registry.services.map((item) => item.id));
  const knownStacks = new Set<string>(registry.stacks.map((item) => item.id));
  const knownTrust = new Set<string>(registry.trustBoundaries.map((item) => item.id));

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
    requireRefs(`${path}.decisionIds`, diagram.decisionIds, knownDecisions, 'decision');
    requireRefs(`${path}.serviceIds`, diagram.serviceIds, knownServices, 'service');
    requireRefs(`${path}.trustBoundaryIds`, diagram.trustBoundaryIds, knownTrust, 'trust boundary');

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
