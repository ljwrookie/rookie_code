/**
 * Fuzzy matching engine for handling LLM output variations.
 *
 * Matching strategies (priority order):
 * 1. Ignore trailing whitespace
 * 2. Ignore indentation differences (tabs vs spaces, width)
 * 3. Ignore blank-line differences
 * 4. Line-by-line Levenshtein with sliding window
 *
 * Includes hallucination guards to reject bad matches.
 */

// ---- Public API ----

export interface FuzzyFindResult {
  found: boolean;
  position: number;       // byte offset in content
  matchedText: string;    // the actual text that was matched
  similarity: number;     // 0–1 overall similarity score
  strategy: string;       // which strategy matched
}

export interface FuzzyFindOptions {
  threshold: number;      // minimum similarity to accept (0–1, default 0.85)
}

/**
 * Try to find `target` inside `content` using progressively fuzzier strategies.
 */
export function fuzzyFind(
  content: string,
  target: string,
  options: FuzzyFindOptions = { threshold: 0.85 },
): FuzzyFindResult {
  const notFound: FuzzyFindResult = {
    found: false,
    position: -1,
    matchedText: '',
    similarity: 0,
    strategy: 'none',
  };

  if (!target || !content) return notFound;

  // Strategy 1: Ignore trailing whitespace per line
  const result1 = matchIgnoringTrailingWhitespace(content, target);
  if (result1 && result1.similarity >= options.threshold) {
    const guard = validateFuzzyMatch(result1.matchedText, target);
    if (guard.valid) {
      return { ...result1, strategy: 'trailing-whitespace' };
    }
  }

  // Strategy 2: Ignore indentation differences
  const result2 = matchIgnoringIndentation(content, target);
  if (result2 && result2.similarity >= options.threshold) {
    const guard = validateFuzzyMatch(result2.matchedText, target);
    if (guard.valid) {
      return { ...result2, strategy: 'indentation' };
    }
  }

  // Strategy 3: Ignore blank-line differences
  const result3 = matchIgnoringBlankLines(content, target);
  if (result3 && result3.similarity >= options.threshold) {
    const guard = validateFuzzyMatch(result3.matchedText, target);
    if (guard.valid) {
      return { ...result3, strategy: 'blank-lines' };
    }
  }

  // Strategy 4: Sliding window with line-level Levenshtein
  const result4 = matchSlidingWindow(content, target, options.threshold);
  if (result4 && result4.similarity >= options.threshold) {
    const guard = validateFuzzyMatch(result4.matchedText, target);
    if (guard.valid) {
      return { ...result4, strategy: 'levenshtein-window' };
    }
  }

  return notFound;
}

// ---- Hallucination Guards ----

export interface GuardResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that a fuzzy match is not a hallucination.
 * Both guards must pass.
 */
export function validateFuzzyMatch(matchedText: string, target: string): GuardResult {
  const matchedLines = matchedText.split('\n').filter(l => l.trim());
  const targetLines = target.split('\n').filter(l => l.trim());

  // Guard 1: Line-count guard — non-empty line count difference must be ≤ 2
  if (Math.abs(matchedLines.length - targetLines.length) > 2) {
    return {
      valid: false,
      reason: `Line count mismatch: matched ${matchedLines.length} vs target ${targetLines.length}`,
    };
  }

  // Guard 2: First/last line anchor — first and last non-empty lines must be similar (> 0.9)
  if (matchedLines.length === 0 || targetLines.length === 0) {
    return { valid: true };
  }

  const firstSim = lineSimilarity(matchedLines[0]!, targetLines[0]!);
  const lastSim = lineSimilarity(matchedLines.at(-1)!, targetLines.at(-1)!);

  if (firstSim < 0.9 || lastSim < 0.9) {
    return {
      valid: false,
      reason: `Anchor mismatch: first=${firstSim.toFixed(2)}, last=${lastSim.toFixed(2)}`,
    };
  }

  return { valid: true };
}

// ---- String Similarity ----

/**
 * Compute similarity between two strings (0–1) using Levenshtein distance.
 */
export function lineSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const trimA = a.trim();
  const trimB = b.trim();
  if (trimA === trimB) return 1;
  const maxLen = Math.max(trimA.length, trimB.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(trimA, trimB);
  return 1 - dist / maxLen;
}

/**
 * Classic Levenshtein distance (optimized with two-row approach).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,       // deletion
        curr[j - 1]! + 1,   // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length]!;
}

// ---- Matching Strategies ----

interface InternalMatch {
  found: boolean;
  position: number;
  matchedText: string;
  similarity: number;
}

/**
 * Strategy 1: Normalize trailing whitespace per line, then exact match.
 */
function matchIgnoringTrailingWhitespace(content: string, target: string): InternalMatch | null {
  const normalizeTrailing = (s: string) =>
    s.split('\n').map(line => line.trimEnd()).join('\n');

  const normContent = normalizeTrailing(content);
  const normTarget = normalizeTrailing(target);

  const pos = normContent.indexOf(normTarget);
  if (pos === -1) return null;

  // Map back to original content — extract the corresponding chunk
  const matchedText = extractOriginalChunk(content, normContent, pos, normTarget.length);

  return {
    found: true,
    position: findOriginalPosition(content, normContent, pos),
    matchedText,
    similarity: computeChunkSimilarity(matchedText, target),
  };
}

/**
 * Strategy 2: Normalize all leading whitespace, then match.
 */
function matchIgnoringIndentation(content: string, target: string): InternalMatch | null {
  const normalizeIndent = (s: string) =>
    s.split('\n').map(line => line.trimStart()).join('\n');

  const normContent = normalizeIndent(content);
  const normTarget = normalizeIndent(target);

  const pos = normContent.indexOf(normTarget);
  if (pos === -1) return null;

  // Count lines to find original span
  const matchedText = extractMatchByLines(content, normContent, pos, normTarget);

  return {
    found: true,
    position: contentIndexOfLine(content, lineIndexAt(normContent, pos)),
    matchedText,
    similarity: computeChunkSimilarity(matchedText, target),
  };
}

/**
 * Strategy 3: Remove blank lines, then match.
 */
function matchIgnoringBlankLines(content: string, target: string): InternalMatch | null {
  const contentLines = content.split('\n');
  const targetLines = target.split('\n').filter(l => l.trim());

  if (targetLines.length === 0) return null;

  // Build non-blank line index map for content
  const nonBlankIndices: number[] = [];
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i]!.trim()) nonBlankIndices.push(i);
  }

  const nonBlankContent = nonBlankIndices.map(i => contentLines[i]!.trimEnd());
  const normTarget = targetLines.map(l => l.trimEnd());

  // Sliding window over non-blank content lines
  for (let start = 0; start <= nonBlankContent.length - normTarget.length; start++) {
    let match = true;
    for (let j = 0; j < normTarget.length; j++) {
      if (nonBlankContent[start + j] !== normTarget[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      const startLine = nonBlankIndices[start]!;
      const endLine = nonBlankIndices[start + normTarget.length - 1]!;
      const matchedText = contentLines.slice(startLine, endLine + 1).join('\n');
      const position = contentLines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);

      // Compute similarity using non-blank lines only (since blank-line diffs are expected)
      const matchedNonBlank = matchedText.split('\n').filter(l => l.trim());
      const targetNonBlank = target.split('\n').filter(l => l.trim());
      const sim = computeLineSimilarity(matchedNonBlank, targetNonBlank);

      return {
        found: true,
        position,
        matchedText,
        similarity: sim,
      };
    }
  }

  return null;
}

/**
 * Strategy 4: Sliding window with per-line Levenshtein similarity.
 */
function matchSlidingWindow(
  content: string,
  target: string,
  threshold: number,
): InternalMatch | null {
  const contentLines = content.split('\n');
  const targetLines = target.split('\n');
  const windowSize = targetLines.length;

  if (windowSize === 0 || contentLines.length < windowSize) return null;

  let bestSim = 0;
  let bestStart = -1;

  // Allow window to be slightly larger/smaller than target (±1 line)
  for (let delta = 0; delta <= 1; delta++) {
    for (const size of [windowSize - delta, windowSize, windowSize + delta]) {
      if (size <= 0 || size > contentLines.length) continue;

      for (let i = 0; i <= contentLines.length - size; i++) {
        const window = contentLines.slice(i, i + size);
        const sim = computeLineSimilarity(window, targetLines);
        if (sim > bestSim) {
          bestSim = sim;
          bestStart = i;
        }
      }
    }
  }

  if (bestSim < threshold || bestStart === -1) return null;

  // Determine how many lines the best match spans
  const bestSize = findBestWindowSize(contentLines, targetLines, bestStart);
  const matchedText = contentLines.slice(bestStart, bestStart + bestSize).join('\n');
  const position = contentLines.slice(0, bestStart).join('\n').length + (bestStart > 0 ? 1 : 0);

  return {
    found: true,
    position,
    matchedText,
    similarity: bestSim,
  };
}

// ---- Internal Helpers ----

function computeLineSimilarity(windowLines: string[], targetLines: string[]): number {
  const maxLines = Math.max(windowLines.length, targetLines.length);
  if (maxLines === 0) return 1;

  let totalSim = 0;
  for (let i = 0; i < maxLines; i++) {
    const wLine = windowLines[i] ?? '';
    const tLine = targetLines[i] ?? '';
    totalSim += lineSimilarity(wLine, tLine);
  }

  return totalSim / maxLines;
}

function findBestWindowSize(
  contentLines: string[],
  targetLines: string[],
  start: number,
): number {
  let bestSize = targetLines.length;
  let bestSim = computeLineSimilarity(
    contentLines.slice(start, start + targetLines.length),
    targetLines,
  );

  for (const delta of [-1, 1]) {
    const size = targetLines.length + delta;
    if (size <= 0 || start + size > contentLines.length) continue;
    const sim = computeLineSimilarity(
      contentLines.slice(start, start + size),
      targetLines,
    );
    if (sim > bestSim) {
      bestSim = sim;
      bestSize = size;
    }
  }

  return bestSize;
}

function computeChunkSimilarity(matched: string, target: string): number {
  const matchedLines = matched.split('\n');
  const targetLines = target.split('\n');
  return computeLineSimilarity(matchedLines, targetLines);
}

function lineIndexAt(text: string, charPos: number): number {
  return text.substring(0, charPos).split('\n').length - 1;
}

function contentIndexOfLine(text: string, lineIndex: number): number {
  const lines = text.split('\n');
  let pos = 0;
  for (let i = 0; i < lineIndex && i < lines.length; i++) {
    pos += lines[i]!.length + 1;
  }
  return pos;
}

function extractOriginalChunk(
  original: string,
  normalized: string,
  normPos: number,
  normLen: number,
): string {
  // Map normalized position back to original line range
  const startLine = lineIndexAt(normalized, normPos);
  const endLine = lineIndexAt(normalized, normPos + normLen);

  const origLines = original.split('\n');
  return origLines.slice(startLine, endLine + 1).join('\n');
}

function findOriginalPosition(original: string, _normalized: string, normPos: number): number {
  // Approximate: find by line number
  const line = _normalized.substring(0, normPos).split('\n').length - 1;
  const origLines = original.split('\n');
  let pos = 0;
  for (let i = 0; i < line && i < origLines.length; i++) {
    pos += origLines[i]!.length + 1;
  }
  return pos;
}

function extractMatchByLines(
  original: string,
  normalized: string,
  normPos: number,
  normTarget: string,
): string {
  const startLine = lineIndexAt(normalized, normPos);
  const endLine = lineIndexAt(normalized, normPos + normTarget.length);
  const origLines = original.split('\n');
  return origLines.slice(startLine, endLine + 1).join('\n');
}
