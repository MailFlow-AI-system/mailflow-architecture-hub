import {
  parseBaselineText,
  type BaselineVersionMetadata,
} from '../../../domain/architecture/baseline';

export type RecordedBaselineFingerprint = {
  source: string;
  checksum: { algorithm: string; value: string };
  bytes: number;
  lines: number;
  words: number;
};

export function assertBaselineFingerprint(
  sourceText: string,
  sourcePath: string,
  expected: RecordedBaselineFingerprint,
): BaselineVersionMetadata {
  const actual = parseBaselineText(sourceText, { sourcePath }).version;
  const differences = [
    actual.sourcePath === expected.source ? undefined : `source ${actual.sourcePath}`,
    expected.checksum.algorithm === 'sha256' && actual.algorithm === expected.checksum.algorithm
      ? undefined
      : `algorithm ${expected.checksum.algorithm}`,
    actual.checksum === expected.checksum.value ? undefined : `checksum ${actual.checksum}`,
    actual.bytes === expected.bytes ? undefined : `bytes ${actual.bytes}`,
    actual.lines === expected.lines ? undefined : `lines ${actual.lines}`,
    actual.words === expected.words ? undefined : `words ${actual.words}`,
  ].filter(Boolean);

  if (differences.length > 0) {
    throw new Error(
      `Baseline fingerprint drift detected (${differences.join(', ')}). Run the coverage audit before updating the recorded import.`,
    );
  }
  return actual;
}
