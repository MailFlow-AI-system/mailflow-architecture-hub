import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { listDistFiles, normalizeRoutePath } from './validateDist';

export type MissingRoute = {
  readonly link: string;
  readonly normalized: string;
};

const HREF_PATTERN = /\bhref\s*=\s*(["'])(.*?)\1/gi;

function isInternalNavigationLink(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//');
}

function isDocumentRoute(value: string): boolean {
  const pathname = value.split(/[?#]/, 1)[0] ?? value;
  const lastSegment = pathname.split('/').at(-1) ?? '';
  return !lastSegment.includes('.') || lastSegment.endsWith('.html');
}

export function collectInternalLinks(html: string): string[] {
  const links: string[] = [];

  for (const match of html.matchAll(HREF_PATTERN)) {
    const href = match[2]?.trim();
    if (!href || !isInternalNavigationLink(href) || !isDocumentRoute(href)) {
      continue;
    }

    const normalized = normalizeRoutePath(href);
    if (!links.includes(normalized)) {
      links.push(normalized);
    }
  }

  return links;
}

export function findMissingRoutes(
  links: readonly string[],
  routes: ReadonlySet<string>,
): MissingRoute[] {
  return links
    .map((link) => ({ link, normalized: normalizeRoutePath(link) }))
    .filter(({ normalized }) => !routes.has(normalized));
}

export function routeFromDistFile(file: string): string | undefined {
  if (!file.endsWith('.html')) {
    return undefined;
  }

  return normalizeRoutePath(`/${file}`);
}

export async function collectBuiltRoutes(root: string): Promise<Set<string>> {
  const files = await listDistFiles(root);
  return new Set(
    files.map(routeFromDistFile).filter((route): route is string => route !== undefined),
  );
}

export async function validateStaticRoutes(root = path.resolve('dist')): Promise<MissingRoute[]> {
  const files = await listDistFiles(root);
  const routes = new Set(
    files.map(routeFromDistFile).filter((route): route is string => route !== undefined),
  );
  const missing: MissingRoute[] = [];

  for (const file of files.filter((candidate) => candidate.endsWith('.html'))) {
    const html = await readFile(path.join(root, file), 'utf8');
    const links = collectInternalLinks(html);
    missing.push(...findMissingRoutes(links, routes));
  }

  const uniqueMissing = missing.filter(
    (entry, index, all) =>
      all.findIndex(
        (candidate) => candidate.link === entry.link && candidate.normalized === entry.normalized,
      ) === index,
  );

  if (uniqueMissing.length > 0) {
    throw new Error(
      `Broken internal routes found:\n${uniqueMissing.map(({ link, normalized }) => `- ${link} (expected ${normalized})`).join('\n')}`,
    );
  }

  return uniqueMissing;
}

async function main(): Promise<void> {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
  const missing = await validateStaticRoutes(root);
  console.log(`Static route validation passed (${missing.length} missing routes).`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  await main();
}
