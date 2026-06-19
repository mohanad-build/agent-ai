'use strict';

const { getStorageRoot } = require('../src/storagePaths');

describe('getStorageRoot', () => {
  let saved;

  beforeEach(() => {
    saved = process.env.STORAGE_ROOT;
    delete process.env.STORAGE_ROOT;
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.STORAGE_ROOT;
    } else {
      process.env.STORAGE_ROOT = saved;
    }
  });

  test('returns STORAGE_ROOT when set', () => {
    process.env.STORAGE_ROOT = '/data/volume';
    expect(getStorageRoot()).toBe('/data/volume');
  });

  test('falls back to process.cwd() when STORAGE_ROOT is unset', () => {
    expect(getStorageRoot()).toBe(process.cwd());
  });

  test('falls back to process.cwd() when STORAGE_ROOT is empty string', () => {
    process.env.STORAGE_ROOT = '';
    expect(getStorageRoot()).toBe(process.cwd());
  });

  test('re-evaluates on each call', () => {
    process.env.STORAGE_ROOT = '/first';
    expect(getStorageRoot()).toBe('/first');
    process.env.STORAGE_ROOT = '/second';
    expect(getStorageRoot()).toBe('/second');
  });
});
