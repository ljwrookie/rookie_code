/**
 * Core search-replace engine.
 *
 * Algorithm:
 * 1. Exact match → unique hit → replace directly
 * 2. Exact match → multiple hits → error with positions
 * 3. Exact match → zero hits → try fuzzy match
 * 4. Fuzzy match → passes hallucination guards → mark usedFuzzyMatch
 */

import { fuzzyFind, type FuzzyFindOptions } from './fuzzy-match.js';

// ---- Public API ----

export interface SearchReplaceResult {
  success: boolean;
  newContent?: string;
  matchCount: number;
  matchPosition?: { line: number; column: number };
  matchPositions?: { line: number; column: number }[];
  error?: string;
  usedFuzzyMatch: boolean;
  fuzzyMatchedText?: string;   // original text that was matched (for diff display)
  fuzzySimilarity?: number;    // similarity score
}

export interface SearchReplaceParams {
  content: string;
  oldString: string;
  newString: string;
  fuzzyThreshold?: number;  // 0–1, default 0.85
}

/**
 * Perform search-replace on content.
 * Returns result indicating success/failure and details.
 */
export function searchReplace(params: SearchReplaceParams): SearchReplaceResult {
  const { content, oldString, newString, fuzzyThreshold = 0.85 } = params;

  // Step 1: Exact match
  const positions = findAllPositions(content, oldString);

  if (positions.length === 1) {
    // Unique exact match — replace
    const pos = positions[0]!;
    const newContent = content.substring(0, pos) + newString + content.substring(pos + oldString.length);
    return {
      success: true,
      newContent,
      matchCount: 1,
      matchPosition: offsetToLineCol(content, pos),
      usedFuzzyMatch: false,
    };
  }

  if (positions.length > 1) {
    // Multiple exact matches — error with all positions
    return {
      success: false,
      matchCount: positions.length,
      matchPositions: positions.map(p => offsetToLineCol(content, p)),
      error: `Found ${positions.length} exact matches. Provide more context to uniquely identify the target.`,
      usedFuzzyMatch: false,
    };
  }

  // Step 2: Zero exact matches — try fuzzy match
  const fuzzyOptions: FuzzyFindOptions = { threshold: fuzzyThreshold };
  const fuzzyResult = fuzzyFind(content, oldString, fuzzyOptions);

  if (!fuzzyResult.found) {
    return {
      success: false,
      matchCount: 0,
      error: 'No exact or fuzzy match found. Verify the content matches the file.',
      usedFuzzyMatch: false,
    };
  }

  // Fuzzy match found — replace the matched text
  const pos = fuzzyResult.position;
  const matchedLen = fuzzyResult.matchedText.length;
  const newContent = content.substring(0, pos) + newString + content.substring(pos + matchedLen);

  return {
    success: true,
    newContent,
    matchCount: 1,
    matchPosition: offsetToLineCol(content, pos),
    usedFuzzyMatch: true,
    fuzzyMatchedText: fuzzyResult.matchedText,
    fuzzySimilarity: fuzzyResult.similarity,
  };
}

// ---- Helpers ----

/**
 * Find all byte-offset positions of `search` in `text`.
 */
function findAllPositions(text: string, search: string): number[] {
  if (!search) return [];
  const positions: number[] = [];
  let pos = 0;
  while (true) {
    pos = text.indexOf(search, pos);
    if (pos === -1) break;
    positions.push(pos);
    pos += search.length;
  }
  return positions;
}

/**
 * Convert a byte offset to line/column (1-based).
 */
function offsetToLineCol(text: string, offset: number): { line: number; column: number } {
  const before = text.substring(0, offset);
  const lines = before.split('\n');
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}
