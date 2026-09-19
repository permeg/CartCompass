import { describe, expect, it } from 'vitest';
import { SEED_PRODUCTS } from '../data/seed';
import { searchCatalog } from './search';
import type { Product } from './types';

const catalog = SEED_PRODUCTS as Product[];
const ids = (q: string) => searchCatalog(catalog, q).map((p) => p.id);

describe('catalog', () => {
  it('has unique ids', () => {
    expect(new Set(catalog.map((p) => p.id)).size).toBe(catalog.length);
  });
});

describe('searchCatalog', () => {
  it('finds cucumbers, singular or plural', () => {
    expect(ids('cucumber')[0]).toBe('cucumber');
    expect(ids('cucumbers')[0]).toBe('cucumber');
  });

  it('forgives a single typo', () => {
    expect(ids('cucmber')).toContain('cucumber');
    expect(ids('brocoli')).toContain('broccoli');
  });

  it('handles irregular plurals', () => {
    expect(ids('tomatoes')).toEqual(expect.arrayContaining(['tomatoes', 'cherry-tomatoes']));
    expect(ids('strawberries')[0]).toBe('strawberries');
    expect(ids('peaches')).toContain('peaches');
  });

  it('matches aliases like "12 eggs"', () => {
    expect(ids('12 eggs')[0]).toBe('eggs-12');
    expect(ids('eggs')).toEqual(expect.arrayContaining(['eggs-12', 'eggs-18']));
  });

  it('requires every word to match', () => {
    expect(ids('whole milk')).toContain('milk-whole');
    expect(ids('whole milk')).not.toContain('oj');
  });

  it('returns nothing for gibberish or an empty query', () => {
    expect(ids('zzzzq')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });

  it('does not treat short words as typos', () => {
    expect(ids('rob')).toEqual([]);
  });
});
