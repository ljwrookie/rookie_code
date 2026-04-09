/**
 * Smart truncation utilities for tool outputs and file contents.
 */

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 100 * 1024; // 100KB

/**
 * Truncate text by line count, preserving head and tail.
 */
export function truncateByLines(
  text: string,
  maxLines: number = DEFAULT_MAX_LINES,
): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;

  const headLines = Math.floor(maxLines * 0.8);
  const tailLines = maxLines - headLines;
  const omitted = lines.length - headLines - tailLines;

  const head = lines.slice(0, headLines).join('\n');
  const tail = lines.slice(-tailLines).join('\n');

  return `${head}\n\n[... ${omitted} lines omitted ...]\n\n${tail}`;
}

/**
 * Truncate text by byte size, preserving head and tail.
 */
export function truncateByBytes(
  text: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
): string {
  const bytes = Buffer.byteLength(text, 'utf-8');
  if (bytes <= maxBytes) return text;

  const headBytes = Math.floor(maxBytes * 0.83); // ~50KB of 60KB
  const tailBytes = Math.floor(maxBytes * 0.17); // ~10KB of 60KB
  const omitted = bytes - headBytes - tailBytes;

  // Convert to string positions (approximate for multi-byte)
  const head = text.slice(0, headBytes);
  const tail = text.slice(-tailBytes);

  return `${head}\n\n[... truncated ${omitted} bytes ...]\n\n${tail}`;
}

/**
 * Smart truncate: applies both line and byte limits.
 */
export function truncate(
  text: string,
  options: { maxLines?: number; maxBytes?: number } = {},
): string {
  const { maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES } =
    options;
  let result = truncateByLines(text, maxLines);
  result = truncateByBytes(result, maxBytes);
  return result;
}

/**
 * Add line numbers to text content.
 * Format: "  1 | line content"
 */
export function addLineNumbers(text: string, startLine: number = 1): string {
  const lines = text.split('\n');
  const maxLineNum = startLine + lines.length - 1;
  const width = String(maxLineNum).length;

  return lines
    .map((line, i) => {
      const lineNum = String(startLine + i).padStart(width, ' ');
      return `${lineNum} | ${line}`;
    })
    .join('\n');
}
