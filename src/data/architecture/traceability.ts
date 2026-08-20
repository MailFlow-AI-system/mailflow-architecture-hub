import { architectureRegistry } from './catalog';
import { architectureDiagrams } from './diagrams';

function push(map: Map<string, string[]>, key: string, value: string) {
  const values = map.get(key) ?? [];
  if (!values.includes(value)) values.push(value);
  map.set(key, values);
}

export const decisionToDiagramIds = new Map<string, string[]>();
export const serviceToDiagramIds = new Map<string, string[]>();
export const stackToDiagramIds = new Map<string, string[]>();
export const gateToDiagramIds = new Map<string, string[]>();
export const trustBoundaryToDiagramIds = new Map<string, string[]>();
export const relationshipToDiagramId = new Map<string, string>();

for (const diagram of architectureDiagrams) {
  for (const decisionId of diagram.decisionIds) push(decisionToDiagramIds, decisionId, diagram.id);
  for (const node of diagram.nodes) {
    for (const decisionId of node.decisionIds) push(decisionToDiagramIds, decisionId, diagram.id);
    if (node.serviceId) push(serviceToDiagramIds, node.serviceId, diagram.id);
    for (const stackId of node.stackIds ?? []) push(stackToDiagramIds, stackId, diagram.id);
    for (const trustId of node.trustBoundaryIds ?? [])
      push(trustBoundaryToDiagramIds, trustId, diagram.id);
  }
  for (const edge of diagram.edges) {
    for (const decisionId of edge.decisionIds) push(decisionToDiagramIds, decisionId, diagram.id);
    if (edge.trustBoundaryId) push(trustBoundaryToDiagramIds, edge.trustBoundaryId, diagram.id);
  }
}

for (const service of architectureRegistry.services) {
  for (const diagramId of service.diagramIds) push(serviceToDiagramIds, service.id, diagramId);
}
for (const stack of architectureRegistry.stacks) {
  for (const serviceId of stack.serviceIds) {
    for (const diagramId of serviceToDiagramIds.get(serviceId) ?? [])
      push(stackToDiagramIds, stack.id, diagramId);
  }
}
for (const gate of architectureRegistry.gates) {
  for (const decisionId of gate.decisionIds) {
    for (const diagramId of decisionToDiagramIds.get(decisionId) ?? [])
      push(gateToDiagramIds, gate.id, diagramId);
  }
}
for (const relationship of architectureRegistry.relationships) {
  if (relationship.diagramId) relationshipToDiagramId.set(relationship.id, relationship.diagramId);
}

export const coverageWithDiagrams = architectureRegistry.coverage;
