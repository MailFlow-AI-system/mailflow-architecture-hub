import { describe, expect, test } from 'bun:test';

import { findForbiddenDistPaths, normalizeRoutePath } from '../scripts/validateDist';
import { collectInternalLinks, findMissingRoutes } from '../scripts/validateRoutes';

describe('dist privacy validation', () => {
  test('finds private client documents even when nested in output', () => {
    const files = [
      'index.html',
      'docs/client/README.md',
      'docs/client/proposal.docx',
      'assets/client-logo.svg',
    ];

    expect(findForbiddenDistPaths(files)).toEqual([
      'docs/client/README.md',
      'docs/client/proposal.docx',
    ]);
  });

  test('normalizes generated route paths', () => {
    expect(normalizeRoutePath('/architecture/?phase=mvp#overview')).toBe('/architecture/');
    expect(normalizeRoutePath('/index.html')).toBe('/');
  });
});

describe('static route validation', () => {
  test('collects only internal navigational links', () => {
    const html = `
      <a href="/services/mail/">Mail</a>
      <a href="/decisions/identity/#jwks">Identity</a>
      <a href="https://example.com">External</a>
      <a href="mailto:team@example.com">Email</a>
      <a href="#local">Local</a>
    `;

    expect(collectInternalLinks(html)).toEqual(['/services/mail/', '/decisions/identity/']);
  });

  test('reports missing routes and preserves source links', () => {
    const links = ['/services/mail/', '/missing/'];
    const routes = new Set(['/services/mail/', '/']);

    expect(findMissingRoutes(links, routes)).toEqual([
      { link: '/missing/', normalized: '/missing/' },
    ]);
  });
});
