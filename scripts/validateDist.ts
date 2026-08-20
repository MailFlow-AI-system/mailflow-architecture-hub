import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type DistEntry = {
  readonly path: string;
  readonly type: 'file' | 'directory';
};

const PRIVATE_PATHS = ['docs/client'];
const PRIVATE_EXTENSIONS = ['.docx'];

export function normalizeRoutePath(value: string): string {
  const url = new URL(value, 'https://mailflow-architecture.local');
  let pathname = decodeURIComponent(url.pathname).replaceAll('\\', '/');

  if (pathname === '/index.html') {
    return '/';
  }

  if (pathname.endsWith('/index.html')) {
    pathname = pathname.slice(0, -'index.html'.length);
  } else if (pathname.endsWith('.html')) {
    pathname = pathname.slice(0, -'.html'.length);
  }

  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  if (pathname !== '/' && !pathname.endsWith('/')) {
    pathname = `${pathname}/`;
  }

  return pathname;
}

export function findForbiddenDistPaths(files: readonly string[]): string[] {
  return files
    .map((file) => file.replaceAll('\\', '/').replace(/^\.\//, ''))
    .filter((file) => {
      const isPrivatePath = PRIVATE_PATHS.some(
        (privatePath) =>
          file === privatePath ||
          file.startsWith(`${privatePath}/`) ||
          file.includes(`/${privatePath}/`),
      );
      const isPrivateDocument = PRIVATE_EXTENSIONS.some((extension) =>
        file.toLowerCase().endsWith(extension),
      );
      return isPrivatePath || isPrivateDocument;
    })
    .sort();
}

export async function listDistFiles(root: string): Promise<string[]> {
  const entries: string[] = [];

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true });

    for (const child of children) {
      const relativePath = path.posix.join(relativeDirectory, child.name);
      const absolutePath = path.join(directory, child.name);

      if (child.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (child.isFile()) {
        entries.push(relativePath);
      }
    }
  }

  await visit(root, '');
  return entries.sort();
}

export async function validateDistPrivacy(root = path.resolve('dist')): Promise<string[]> {
  const files = await listDistFiles(root);
  const violations = findForbiddenDistPaths(files);

  if (violations.length > 0) {
    throw new Error(
      `Private client material found in dist:\n${violations.map((file) => `- ${file}`).join('\n')}`,
    );
  }

  return files;
}

async function main(): Promise<void> {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
  const files = await validateDistPrivacy(root);
  console.log(`Dist privacy validation passed (${files.length} files).`);
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (currentFile === invokedFile) {
  await main();
}
