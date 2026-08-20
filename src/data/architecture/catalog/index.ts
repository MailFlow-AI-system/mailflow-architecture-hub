import { readFileSync } from 'node:fs';

import { validateArchitectureRegistry } from '../../../domain/architecture';
import { buildArchitectureCatalog } from './buildCatalog';
import { capabilityShard } from './capabilityShard';
import { coreShard } from './coreShard';
import { platformShard } from './platformShard';

export { capabilityShard, coreShard, platformShard };
export * from './types';

export const baselineSourcePath = 'docs/architecture/architectureBaseline.md';
export const baselineSourceText = readFileSync(
  new URL('../../../../docs/architecture/architectureBaseline.md', import.meta.url),
  'utf8',
);

export const architectureRegistry = buildArchitectureCatalog(
  baselineSourceText,
  [coreShard, capabilityShard, platformShard],
  baselineSourcePath,
);

const integrity = validateArchitectureRegistry(architectureRegistry);
if (!integrity.valid) {
  throw new Error(
    `Architecture catalog integrity failed:\n${integrity.errors
      .map((error) => `${error.code}: ${error.path}: ${error.message}`)
      .join('\n')}`,
  );
}

export function excerptForRange(startLine: number, endLine: number): string {
  return baselineSourceText
    .split(/(?<=\n)/u)
    .slice(startLine - 1, endLine)
    .join('')
    .trim();
}
