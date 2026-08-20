import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import baselineVersion from '../../src/data/architecture/baselineVersion.json';
import { architectureDiagrams } from '../../src/data/architecture/diagrams';
import { createSourceDigest } from '../../src/domain/architecture';

const targetPath = 'src/data/architecture/diagrams/sourceDigests.json';

export function createDiagramSourceDigests(sourceText: string) {
  const lines = sourceText.split(/(?<=\n)/u);
  return {
    schemaVersion: 1,
    baselineChecksum: baselineVersion.checksum.value,
    diagrams: Object.fromEntries(
      architectureDiagrams.map((diagram) => [
        diagram.id,
        diagram.sourceRanges.map((range) => ({
          range,
          digest: createSourceDigest(lines.slice(range.startLine - 1, range.endLine).join(''))
            .value,
        })),
      ]),
    ),
  };
}

function main() {
  const baseline = readFileSync(resolve(process.cwd(), baselineVersion.source), 'utf8');
  const target = resolve(process.cwd(), targetPath);
  const generated = `${JSON.stringify(createDiagramSourceDigests(baseline), null, 2)}\n`;
  if (process.argv.includes('--update')) {
    writeFileSync(target, generated, 'utf8');
    console.log(`Diagram source digests updated: ${targetPath}`);
    return;
  }
  if (!existsSync(target) || readFileSync(target, 'utf8') !== generated) {
    throw new Error(
      'Diagram source digest drift detected. Review every affected view before running diagram-sources:update.',
    );
  }
  console.log(`Diagram source digests valid (${architectureDiagrams.length} diagrams).`);
}

if (import.meta.main) main();
