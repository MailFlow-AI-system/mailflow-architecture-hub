import { architectureRegistry } from './catalog';
import { architectureDiagrams } from './diagrams';

function push(map: Map<string, string[]>, key: string, value: string) {
  const values = map.get(key) ?? [];
  if (!values.includes(value)) values.push(value);
  map.set(key, values);
}

export const decisionToDiagramIds = new Map<string, string[]>();
export const serviceToDiagramIds = new Map<string, string[]>();

for (const diagram of architectureDiagrams) {
  for (const decisionId of diagram.decisionIds) push(decisionToDiagramIds, decisionId, diagram.id);
  for (const node of diagram.nodes) {
    for (const decisionId of node.decisionIds) push(decisionToDiagramIds, decisionId, diagram.id);
    if (node.serviceId) push(serviceToDiagramIds, node.serviceId, diagram.id);
  }
  for (const edge of diagram.edges) {
    for (const decisionId of edge.decisionIds) push(decisionToDiagramIds, decisionId, diagram.id);
  }
}

export const coverageWithDiagrams = architectureRegistry.coverage.map((record) => ({
  ...record,
  diagramIds: [
    ...new Set(
      record.decisionIds.flatMap((decisionId) => decisionToDiagramIds.get(decisionId) ?? []),
    ),
  ],
}));
