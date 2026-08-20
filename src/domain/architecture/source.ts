import { createHash } from 'node:crypto';
import { z } from 'zod';

const relativeSourcePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;

export const SourceRangeSchema = z
  .object({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .superRefine((range, context) => {
    if (range.endLine < range.startLine) {
      context.addIssue({
        code: 'custom',
        path: ['endLine'],
        message: 'endLine must be greater than or equal to startLine',
      });
    }
  });

export type SourceRange = z.infer<typeof SourceRangeSchema>;

export const SourceDigestSchema = z.object({
  algorithm: z.literal('sha256'),
  value: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative().optional(),
  lines: z.number().int().nonnegative().optional(),
  words: z.number().int().nonnegative().optional(),
});

export type SourceDigest = z.infer<typeof SourceDigestSchema>;

export const SourceAnchorSchema = z.object({
  source: z.string().regex(relativeSourcePathPattern, 'source must be a relative repository path'),
  range: SourceRangeSchema,
  digest: SourceDigestSchema,
  heading: z.string().min(1).optional(),
});

export type SourceAnchor = z.infer<typeof SourceAnchorSchema>;

function countWords(content: string): number {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

function countLines(content: string): number {
  if (!content) {
    return 0;
  }

  const lines = content.split(/\r?\n/u).length;
  return /(?:\r\n|\n|\r)$/u.test(content) ? lines - 1 : lines;
}

export function createSourceDigest(content: string): SourceDigest {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(content, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(content, 'utf8'),
    lines: countLines(content),
    words: countWords(content),
  };
}

export function createSourceAnchor(input: {
  source: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  heading?: string;
}): SourceAnchor {
  return SourceAnchorSchema.parse({
    source: input.source,
    range: { startLine: input.startLine, endLine: input.endLine },
    digest: createSourceDigest(input.excerpt),
    ...(input.heading ? { heading: input.heading } : {}),
  });
}
