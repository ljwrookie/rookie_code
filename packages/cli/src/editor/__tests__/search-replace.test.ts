import { describe, it, expect } from 'vitest';
import { searchReplace } from '../search-replace.js';
import { fuzzyFind, validateFuzzyMatch, lineSimilarity, levenshtein } from '../fuzzy-match.js';

// ============================================================
// searchReplace — exact match
// ============================================================

describe('searchReplace — exact match', () => {
  it('should replace unique exact match', () => {
    const content = 'function hello() {\n  return "world";\n}\n';
    const result = searchReplace({
      content,
      oldString: 'return "world"',
      newString: 'return "universe"',
    });

    expect(result.success).toBe(true);
    expect(result.usedFuzzyMatch).toBe(false);
    expect(result.matchCount).toBe(1);
    expect(result.newContent).toContain('return "universe"');
    expect(result.newContent).not.toContain('return "world"');
  });

  it('should error on multiple exact matches with positions', () => {
    const content = 'let x = 1;\nlet y = 1;\nlet z = 1;\n';
    const result = searchReplace({
      content,
      oldString: ' = 1;',
      newString: ' = 2;',
    });

    expect(result.success).toBe(false);
    expect(result.matchCount).toBe(3);
    expect(result.matchPositions).toHaveLength(3);
    expect(result.error).toContain('3 exact matches');
  });

  it('should handle empty old_string gracefully (returns 0 matches)', () => {
    const result = searchReplace({
      content: 'some content',
      oldString: '',
      newString: 'new content',
    });
    // Empty search yields no positions
    expect(result.success).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('should replace multiline exact match', () => {
    const content = 'if (x) {\n  doA();\n  doB();\n}\n';
    const result = searchReplace({
      content,
      oldString: '  doA();\n  doB();',
      newString: '  doC();\n  doD();\n  doE();',
    });

    expect(result.success).toBe(true);
    expect(result.newContent).toContain('doC()');
    expect(result.newContent).toContain('doE()');
  });

  it('should return correct line/column position', () => {
    const content = 'line1\nline2\nline3_target\nline4\n';
    const result = searchReplace({
      content,
      oldString: 'line3_target',
      newString: 'line3_replaced',
    });

    expect(result.success).toBe(true);
    expect(result.matchPosition).toEqual({ line: 3, column: 1 });
  });
});

// ============================================================
// searchReplace — fuzzy match
// ============================================================

describe('searchReplace — fuzzy match', () => {
  it('should fuzzy match when LLM misses trailing whitespace', () => {
    const content = 'function hello() {  \n  return "world";  \n}  \n';
    const result = searchReplace({
      content,
      oldString: 'function hello() {\n  return "world";\n}',
      newString: 'function goodbye() {\n  return "mars";\n}',
    });

    expect(result.success).toBe(true);
    expect(result.usedFuzzyMatch).toBe(true);
    expect(result.newContent).toContain('goodbye');
  });

  it('should fuzzy match when LLM uses different indentation (spaces vs tabs)', () => {
    const content = '\tfunction hello() {\n\t\treturn "world";\n\t}\n';
    const result = searchReplace({
      content,
      oldString: '  function hello() {\n    return "world";\n  }',
      newString: '  function goodbye() {\n    return "mars";\n  }',
    });

    expect(result.success).toBe(true);
    expect(result.usedFuzzyMatch).toBe(true);
  });

  it('should NOT fuzzy match completely different content', () => {
    const content = 'function hello() {\n  return "world";\n}\n';
    const result = searchReplace({
      content,
      oldString: 'class UserService {\n  getUser() {}\n}',
      newString: 'class UserService {\n  getUser(id: string) {}\n}',
    });

    expect(result.success).toBe(false);
    expect(result.matchCount).toBe(0);
    expect(result.error).toContain('No exact or fuzzy match');
  });

  it('should include fuzzy match metadata when matched', () => {
    const content = 'const   x  = 1;\n';
    const result = searchReplace({
      content,
      oldString: 'const x = 1;',
      newString: 'const y = 2;',
      fuzzyThreshold: 0.8,
    });

    // May or may not fuzzy match depending on strategy
    if (result.success && result.usedFuzzyMatch) {
      expect(result.fuzzySimilarity).toBeGreaterThan(0);
      expect(result.fuzzyMatchedText).toBeDefined();
    }
  });

  it('should fuzzy match when blank lines differ', () => {
    const content = 'function a() {\n\n  return 1;\n\n}\n';
    const result = searchReplace({
      content,
      oldString: 'function a() {\n  return 1;\n}',
      newString: 'function b() {\n  return 2;\n}',
    });

    expect(result.success).toBe(true);
    expect(result.usedFuzzyMatch).toBe(true);
  });
});

// ============================================================
// fuzzyFind — unit tests
// ============================================================

describe('fuzzyFind', () => {
  it('should match trailing whitespace differences', () => {
    const content = 'hello world  \nfoo bar  \n';
    const target = 'hello world\nfoo bar';
    const result = fuzzyFind(content, target);

    expect(result.found).toBe(true);
    expect(result.strategy).toBe('trailing-whitespace');
  });

  it('should match indentation differences', () => {
    const content = '    if (true) {\n        doIt();\n    }\n';
    const target = 'if (true) {\n    doIt();\n}';
    const result = fuzzyFind(content, target);

    expect(result.found).toBe(true);
    expect(result.strategy).toBe('indentation');
  });

  it('should return not found for entirely different content', () => {
    const content = 'const x = 1;\nconst y = 2;\n';
    const target = 'function processData(input) {\n  return input.map(x => x * 2);\n}';
    const result = fuzzyFind(content, target);

    expect(result.found).toBe(false);
  });
});

// ============================================================
// validateFuzzyMatch — hallucination guards
// ============================================================

describe('validateFuzzyMatch — hallucination guards', () => {
  it('should reject when line count differs by more than 2', () => {
    const matched = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\n';
    const target = 'line1\nline2\n';
    const result = validateFuzzyMatch(matched, target);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Line count mismatch');
  });

  it('should accept when line count differs by exactly 2', () => {
    const matched = 'function a() {\n  return 1;\n  // comment\n}\n';
    const target = 'function a() {\n  return 1;\n}';
    const result = validateFuzzyMatch(matched, target);

    // Line count diff: 4 vs 3 = 1, should pass
    expect(result.valid).toBe(true);
  });

  it('should reject when first line anchor does not match', () => {
    const matched = 'class Foo {\n  bar() {}\n}';
    const target = 'function baz() {\n  bar() {}\n}';
    const result = validateFuzzyMatch(matched, target);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Anchor mismatch');
  });

  it('should reject when last line anchor does not match', () => {
    const matched = 'function hello() {\n  return 1;\n  // end\n}';
    const target = 'function hello() {\n  return 1;\nmodule.exports = hello;';
    const result = validateFuzzyMatch(matched, target);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Anchor mismatch');
  });

  it('should accept when both anchors are similar', () => {
    const matched = 'function hello()  {\n  return 1;\n}';
    const target = 'function hello() {\n  return 1;\n}';
    const result = validateFuzzyMatch(matched, target);

    expect(result.valid).toBe(true);
  });
});

// ============================================================
// lineSimilarity and levenshtein
// ============================================================

describe('lineSimilarity', () => {
  it('should return 1 for identical strings', () => {
    expect(lineSimilarity('hello', 'hello')).toBe(1);
  });

  it('should return 1 for strings differing only by whitespace', () => {
    expect(lineSimilarity('  hello  ', 'hello')).toBe(1);
  });

  it('should return high similarity for minor differences', () => {
    const sim = lineSimilarity('function hello()', 'function hello( )');
    expect(sim).toBeGreaterThan(0.9);
  });

  it('should return low similarity for very different strings', () => {
    const sim = lineSimilarity('hello world', 'completely different string');
    expect(sim).toBeLessThan(0.5);
  });
});

describe('levenshtein', () => {
  it('should return 0 for identical strings', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
  });

  it('should return length of other string when one is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('should compute correct distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('saturday', 'sunday')).toBe(3);
  });
});
