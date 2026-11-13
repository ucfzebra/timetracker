import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBlocked } from '../app/src/core/guard.js';

test('whole-word, case-insensitive match', () => {
  assert.deepEqual(findBlocked('Orion review', ['orion']), ['orion']);
  assert.deepEqual(findBlocked('horizon', ['orion']), []);
});

test('trailing * is a prefix match', () => {
  assert.deepEqual(findBlocked('ORIONX build', ['Ori*']), ['Ori*']);
  assert.deepEqual(findBlocked('orbital', ['Ori*']), []);
});

test('entries are regex-escaped', () => {
  assert.deepEqual(findBlocked('a.b fix', ['a.b']), ['a.b']);
  assert.deepEqual(findBlocked('axb fix', ['a.b']), []);
});

test('empty list, blank entries and duplicates', () => {
  assert.deepEqual(findBlocked('anything', []), []);
  assert.deepEqual(findBlocked('anything', ['', '   ', '*']), []);
  assert.deepEqual(findBlocked('Orion and orion', ['Orion']), ['Orion']);
  assert.deepEqual(findBlocked('orion', ['orion', 'orion']), ['orion']);
});

test('unicode-aware boundaries', () => {
  assert.deepEqual(findBlocked("Orion's plan", ['Orion']), ['Orion']);
  assert.deepEqual(findBlocked('Ünder review', ['under']), []);
  assert.deepEqual(findBlocked('über build', ['über']), ['über']);
  assert.deepEqual(findBlocked('xüber build', ['über']), []);
});
