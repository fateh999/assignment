/**
 * Parse a single-range `Range: bytes=...` header against a file size.
 * Returns null to serve the whole file (no/unsupported header), "invalid" for 416, else inclusive [start, end].
 */
export function parseRange(header: string | null, size: number): [number, number] | null | "invalid" {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const [start, end] = m[1]
    ? [Number(m[1]), m[2] ? Math.min(Number(m[2]), size - 1) : size - 1]
    : [Math.max(size - Number(m[2]), 0), size - 1]; // suffix: last N bytes
  return start > end || start >= size ? "invalid" : [start, end];
}
