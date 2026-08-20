import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import baselineVersion from '../../src/data/architecture/baselineVersion.json';
import { architectureRegistry } from '../../src/data/architecture/catalog';
import type { ArchitectureRegistry, CoverageRecord } from '../../src/domain/architecture';

export const coverageManifestPath = 'docs/architecture/coverageManifest.json';

type Review = {
  status: 'machine_classified' | 'human_reviewed';
  reviewedBy: string | null;
  reviewedAt: string | null;
  notes: string[];
  required: boolean;
};

type PriorRecord = {
  key: string;
  sourceDigest: string;
  review?: Review;
};

type PriorManifest = {
  baseline?: { checksum?: string };
  manifest?: { checksum?: string; previousManifestChecksum?: string | null };
  previousBaselineChecksum?: string | null;
  delta?: {
    addedKeys?: string[];
    changedKeys?: string[];
    removedRecords?: PriorRecord[];
  };
  summary?: { records?: number };
  records?: PriorRecord[];
};

function recordKey(record: Pick<CoverageRecord, 'sectionId' | 'blockId'>): string {
  return `${record.sectionId}:${record.blockId ?? 'section'}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function headingPathFor(registry: ArchitectureRegistry, sectionId: string): string[] {
  const sections = new Map<string, (typeof registry.baselineSections)[number]>(
    registry.baselineSections.map((section) => [section.id, section]),
  );
  const path: string[] = [];
  let current = sections.get(sectionId);
  while (current) {
    path.unshift(current.title);
    current = current.parentId ? sections.get(current.parentId) : undefined;
  }
  return path.length ? path : ['Document preamble'];
}

export function createCoverageManifest(registry: ArchitectureRegistry, prior?: PriorManifest) {
  const currentChecksum = baselineVersion.checksum.value;
  const baselineChanged = Boolean(
    prior?.baseline?.checksum && prior.baseline.checksum !== currentChecksum,
  );
  const previousBaselineChecksum = baselineChanged
    ? (prior?.baseline?.checksum ?? null)
    : (prior?.previousBaselineChecksum ?? null);
  const previousManifestChecksum = baselineChanged
    ? (prior?.manifest?.checksum ?? null)
    : (prior?.manifest?.previousManifestChecksum ?? null);
  const priorRecords = new Map((prior?.records ?? []).map((record) => [record.key, record]));
  const currentKeys = new Set<string>();
  const addedKeys: string[] = [];
  const changedKeys: string[] = [];

  const records = registry.coverage.map((record) => {
    const key = recordKey(record);
    currentKeys.add(key);
    const previous = priorRecords.get(key);
    const sameDigest = previous?.sourceDigest === record.sourceDigest.value;
    if (baselineChanged && !previous) addedKeys.push(key);
    if (baselineChanged && previous && !sameDigest) changedKeys.push(key);
    const preservedReview = sameDigest ? previous?.review : undefined;
    const reviewStatus = preservedReview?.status ?? record.reviewStatus;
    const affectedByDelta = baselineChanged && (!previous || !sameDigest);
    const review: Review = {
      status: reviewStatus,
      reviewedBy: preservedReview?.reviewedBy ?? record.reviewedBy ?? null,
      reviewedAt: preservedReview?.reviewedAt ?? record.reviewedAt ?? null,
      notes: preservedReview?.notes ?? record.reviewNotes,
      required:
        reviewStatus !== 'human_reviewed' &&
        (affectedByDelta || Boolean(preservedReview?.required)),
    };
    const section = registry.baselineSections.find((item) => item.id === record.sectionId);
    const block = record.blockId
      ? registry.baselineBlocks.find((item) => item.id === record.blockId)
      : undefined;
    const range = block?.sourceAnchor.range ?? section?.sourceRange;
    if (!range) throw new Error(`Coverage record has no source range: ${key}`);
    return {
      key,
      baselineRef: {
        source: baselineVersion.source,
        sectionId: record.sectionId,
        headingPath: headingPathFor(registry, record.sectionId),
        blockId: record.blockId ?? null,
        range,
        digest: record.sourceDigest.value,
      },
      sectionId: record.sectionId,
      ...(record.blockId ? { blockId: record.blockId } : {}),
      classification: record.classification,
      review,
      sourceDigest: record.sourceDigest.value,
      decisionIds: record.decisionIds,
      serviceIds: record.serviceIds,
      diagramIds: record.diagramIds,
      stackIds: record.stackIds,
      gateIds: record.gateIds,
      relationshipIds: record.relationshipIds,
      pageRoutes: record.pageRoutes,
      ...(record.phase ? { phase: record.phase } : {}),
      ...(record.status ? { status: record.status } : {}),
      primaryReferences: record.primaryReferences,
    };
  });

  const removedRecords = baselineChanged
    ? [...priorRecords.values()].filter((record) => !currentKeys.has(record.key))
    : (prior?.delta?.removedRecords ?? []);
  const effectiveAddedKeys = baselineChanged ? addedKeys : (prior?.delta?.addedKeys ?? []);
  const effectiveChangedKeys = baselineChanged ? changedKeys : (prior?.delta?.changedKeys ?? []);
  const unresolvedRecordKeys = records
    .filter((record) => record.review.required)
    .map((record) => record.key);
  const resolved = registry.coverage.filter(
    (record) => record.classification !== 'not_classified',
  ).length;
  const summary = {
    sections: registry.baselineSections.length,
    blocks: registry.baselineBlocks.length,
    records: records.length,
    decisions: registry.decisions.length,
    services: registry.services.length,
    stacks: registry.stacks.length,
    gates: registry.gates.length,
    trustBoundaries: registry.trustBoundaries.length,
    diagrams: registry.diagrams.length,
    relationships: registry.relationships.length,
    unclassified: registry.coverage.filter((record) => record.classification === 'not_classified')
      .length,
    contextOnly: registry.coverage.filter((record) => record.classification === 'not_applicable')
      .length,
    machineClassified: records.filter((record) => record.review.status === 'machine_classified')
      .length,
    humanReviewed: records.filter((record) => record.review.status === 'human_reviewed').length,
    unresolvedReview: unresolvedRecordKeys.length,
  };
  const delta = {
    added: effectiveAddedKeys.length,
    changed: effectiveChangedKeys.length,
    removed: removedRecords.length,
    addedKeys: effectiveAddedKeys,
    changedKeys: effectiveChangedKeys,
    removedRecords,
    unresolvedRecordKeys,
    coverage: {
      before: prior?.summary?.records ?? null,
      after: records.length,
      resolvedAfter: resolved,
      unresolvedDelta: unresolvedRecordKeys.length,
    },
  };
  const content = {
    schemaVersion: 2,
    baseline: {
      source: baselineVersion.source,
      checksum: currentChecksum,
      bytes: baselineVersion.bytes,
      lines: baselineVersion.lines,
      words: baselineVersion.words,
      lastUpdated: baselineVersion.lastUpdated,
      importedAt: baselineVersion.importedAt,
    },
    previousBaselineChecksum,
    delta,
    summary,
    records,
  };

  return {
    ...content,
    manifest: {
      checksum: sha256(JSON.stringify(content)),
      previousManifestChecksum,
    },
  };
}

function registrySummary(summary: { records: number; diagrams: number }): string {
  return `${summary.records} records, ${summary.diagrams} diagrams`;
}

function main() {
  const target = resolve(process.cwd(), coverageManifestPath);
  const existing = existsSync(target)
    ? (JSON.parse(readFileSync(target, 'utf8')) as PriorManifest)
    : undefined;
  const manifest = createCoverageManifest(architectureRegistry, existing);
  const generated = `${JSON.stringify(manifest, null, 2)}\n`;
  if (process.argv.includes('--update')) {
    writeFileSync(target, generated, 'utf8');
    console.log(`Coverage manifest updated: ${coverageManifestPath}`);
    if (manifest.delta.unresolvedRecordKeys.length) {
      console.warn(
        `${manifest.delta.unresolvedRecordKeys.length} baseline-delta records require human review.`,
      );
    }
    return;
  }
  if (!existing) throw new Error(`Coverage manifest is missing: ${coverageManifestPath}`);
  const recorded = readFileSync(target, 'utf8');
  if (recorded !== generated) {
    throw new Error(
      `Coverage manifest drift detected. Review the baseline and run "bun run coverage:update".`,
    );
  }
  if (manifest.delta.unresolvedRecordKeys.length) {
    throw new Error(
      `Coverage manifest has ${manifest.delta.unresolvedRecordKeys.length} baseline-delta records awaiting human review.`,
    );
  }
  console.log(
    `Coverage manifest valid (${registrySummary(manifest.summary)}, ${manifest.summary.contextOnly} context-only records).`,
  );
}

if (import.meta.main) main();
