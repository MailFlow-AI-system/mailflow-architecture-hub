import type { BlockDigestChange, ParsedBaseline } from './types';

export function compareBlockDigests(
  previous: Pick<ParsedBaseline, 'blocks'>,
  current: Pick<ParsedBaseline, 'blocks'>,
): BlockDigestChange[] {
  const previousByIdentity = new Map(
    previous.blocks.map((block) => [block.identityKey, block.sourceAnchor.digest.value]),
  );
  const currentByIdentity = new Map(
    current.blocks.map((block) => [block.identityKey, block.sourceAnchor.digest.value]),
  );
  const changes: BlockDigestChange[] = [];

  for (const [identityKey, currentDigest] of currentByIdentity) {
    const previousDigest = previousByIdentity.get(identityKey);
    if (!previousDigest) {
      changes.push({ kind: 'added', identityKey, currentDigest });
    } else if (previousDigest !== currentDigest) {
      changes.push({ kind: 'changed', identityKey, previousDigest, currentDigest });
    }
  }

  for (const [identityKey, previousDigest] of previousByIdentity) {
    if (!currentByIdentity.has(identityKey)) {
      changes.push({ kind: 'removed', identityKey, previousDigest });
    }
  }

  return changes.sort((left, right) => left.identityKey.localeCompare(right.identityKey));
}
