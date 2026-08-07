import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateTokensMultiple,
  checkBudget,
  fitToBudget,
  MODE_BUDGETS,
} from './tokenBudget';

describe('estimateTokens', () => {
  it('returns ceil of length/4', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('12345678')).toBe(2);
  });

  it('scales with content length', () => {
    const short = estimateTokens('short');
    const long = estimateTokens('a'.repeat(4000));
    expect(long).toBeGreaterThan(short);
    expect(long).toBe(1000);
  });
});

describe('estimateTokensMultiple', () => {
  it('sums estimates', () => {
    expect(estimateTokensMultiple(['abcd', 'efgh'])).toBe(2);
    expect(estimateTokensMultiple([])).toBe(0);
  });
});

describe('MODE_BUDGETS', () => {
  it('has all five modes', () => {
    expect(Object.keys(MODE_BUDGETS).sort()).toEqual([
      'deep', 'plan', 'quick', 'review', 'standard',
    ]);
  });

  it('quick <= standard <= deep in max budget', () => {
    expect(MODE_BUDGETS.quick.max).toBeLessThanOrEqual(MODE_BUDGETS.standard.max);
    expect(MODE_BUDGETS.standard.max).toBeLessThanOrEqual(MODE_BUDGETS.deep.max);
  });
});

describe('checkBudget', () => {
  it('fits when under max', () => {
    const r = checkBudget('quick', ['short text here']);
    expect(r.fits).toBe(true);
    expect(r.surplus).toBe(0);
  });

  it('does not fit when over max', () => {
    const big = 'x'.repeat(4000); // 1000 tokens estimated
    const r = checkBudget('quick', [big]);
    expect(r.fits).toBe(false);
    expect(r.surplus).toBeGreaterThan(0);
  });

  it('falls back to standard for unknown mode', () => {
    const r = checkBudget('nonexistent' as any, ['test']);
    expect(r.max).toBe(MODE_BUDGETS.standard.max);
  });
});

describe('fitToBudget', () => {
  const docs = [
    { id: 'a', text: 'x'.repeat(1000) },   // 250 tokens
    { id: 'b', text: 'x'.repeat(2000) },   // 500 tokens
    { id: 'c', text: 'x'.repeat(400) },    // 100 tokens
    { id: 'd', text: 'x'.repeat(8000) },   // 2000 tokens
  ];

  it('includes priority docs first', () => {
    const r = fitToBudget('standard', docs, ['a', 'c']);
    // priority a (250) + c (100) = 350. b (500) fits → 850 total.
    expect(r.selected).toContain('a');
    expect(r.selected).toContain('c');
  });

  it('drops docs that exceed budget', () => {
    const r = fitToBudget('quick', docs, []);
    // quick max is 700. c(100) + a(250) + b(500)=850 > 700, so b dropped.
    expect(r.dropped.length).toBeGreaterThan(0);
  });

  it('returns structured budget result', () => {
    const r = fitToBudget('standard', docs, []);
    expect(r.budget.estimated).toBeGreaterThan(0);
    expect(r.budget.max).toBe(MODE_BUDGETS.standard.max);
  });
});
