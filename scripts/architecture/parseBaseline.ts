import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import {
  mergeSemanticAnnotations,
  parseBaselineFile,
  type BaselineIdentityMap,
  type SemanticAnnotation,
} from '../../src/domain/architecture/baseline';

type CliOptions = {
  sourcePath: string;
  outputPath?: string;
  annotationsPath?: string;
  identityMapPath?: string;
};

function usage(): never {
  console.error(
    'Usage: bun scripts/architecture/parseBaseline.ts [baseline-path] [--output path] [--merge-annotations path] [--identity-map path]',
  );
  process.exit(1);
}

function parseOptions(args: string[]): CliOptions {
  const positional: string[] = [];
  let outputPath: string | undefined;
  let annotationsPath: string | undefined;
  let identityMapPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument) continue;
    if (argument === '--output') {
      outputPath = args[++index] ?? usage();
    } else if (argument === '--merge-annotations') {
      annotationsPath = args[++index] ?? usage();
    } else if (argument === '--identity-map') {
      identityMapPath = args[++index] ?? usage();
    } else if (argument.startsWith('-')) {
      usage();
    } else {
      positional.push(argument);
    }
  }

  return {
    sourcePath: positional[0] ?? 'docs/architecture/architectureBaseline.md',
    outputPath,
    annotationsPath,
    identityMapPath,
  };
}

function repositorySourcePath(filePath: string): string {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  return relative(process.cwd(), absolutePath).replaceAll('\\', '/');
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

const options = parseOptions(process.argv.slice(2));
const sourceFile = isAbsolute(options.sourcePath)
  ? options.sourcePath
  : resolve(process.cwd(), options.sourcePath);
const identityMap = options.identityMapPath
  ? await readJson<BaselineIdentityMap>(options.identityMapPath)
  : undefined;

let parsed = await parseBaselineFile(sourceFile, {
  sourcePath: repositorySourcePath(options.sourcePath),
  identityMap,
});

if (options.annotationsPath) {
  const annotations = await readJson<SemanticAnnotation[]>(options.annotationsPath);
  parsed = mergeSemanticAnnotations(parsed, annotations);
}

const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
if (options.outputPath) {
  await mkdir(dirname(resolve(process.cwd(), options.outputPath)), { recursive: true });
  await writeFile(resolve(process.cwd(), options.outputPath), serialized, 'utf8');
} else {
  process.stdout.write(serialized);
}
