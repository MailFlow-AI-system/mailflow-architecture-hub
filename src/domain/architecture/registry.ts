import { ArchitectureRegistrySchema } from './schemas';
import type { ArchitectureRegistry } from './schemas';

export function createEmptyArchitectureRegistry(): ArchitectureRegistry {
  return ArchitectureRegistrySchema.parse({
    decisions: [],
    services: [],
    diagrams: [],
    relationships: [],
    stacks: [],
    gates: [],
    trustBoundaries: [],
    baselineSections: [],
    baselineBlocks: [],
    coverage: [],
  });
}
