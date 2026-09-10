// Simulates two phones going offline, diverging, and reconciling.
// Run with: node test/merge.test.mjs

import assert from 'node:assert/strict';
import { addItem, editItem, mergeRemote, visible, pending, clearDone } from '../store.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); passed++; }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

const phone = () => ({ items: {}, deviceId: 'dev-' + Math.random() });
const strip = ({ dirty, ...rest }) => rest;

/**
 * A round trip through the server: push dirty rows, pull everything back.
 *
 * Note the server does NOT arbitrate. A PostgREST upsert overwrites the row
 * unconditionally, so the last writer in this loop wins regardless of its
 * timestamp. Convergence has to come from the merge rule on the phones.
 */
function sync(server, ...phones) {
  for (const p of phones) {
    for (const item of pending(p)) {
      server[item.id] = strip(item);
      item.dirty = false;
    }
  }
  for (const p of phones) {
    for (const row of Object.values(server)) mergeRemote(p, row);
  }
}

/** Sync repeatedly until nothing is left to push, or give up. */
function settle(server, ...phones) {
  for (let round = 1; round <= 6; round++) {
    sync(server, ...phones);
    if (phones.every((p) => pending(p).length === 0)) return round;
  }
  throw new Error('did not settle within 6 rounds');
}

const names = (p) => visible(p).map((i) => `${i.text}${i.done ? '*' : ''}`);

test('items added on both phones while offline all survive', () => {
  const server = {}, a = phone(), b = phone();
  addItem(a, 'Milk');
  addItem(b, 'Bread');
  sync(server, a, b);
  assert.deepEqual(names(a).sort(), ['Bread', 'Milk']);
  assert.deepEqual(names(b).sort(), ['Bread', 'Milk']);
});

test('checking off on one phone reaches the other', () => {
  const server = {}, a = phone(), b = phone();
  const milk = addItem(a, 'Milk');
  sync(server, a, b);

  editItem(a, milk.id, { done: true });
  sync(server, a, b);

  assert.equal(b.items[milk.id].done, true, 'phone B should see it checked');
});

test('a deletion propagates instead of resurrecting', () => {
  const server = {}, a = phone(), b = phone();
  const eggs = addItem(a, 'Eggs');
  sync(server, a, b);

  editItem(a, eggs.id, { deleted: true });
  sync(server, a, b);
  // B pushes nothing, then pulls again — the item must stay gone.
  sync(server, a, b);

  assert.deepEqual(names(b), [], 'deleted item must not come back');
});

test('later edit wins over earlier one', () => {
  const server = {}, a = phone(), b = phone();
  const item = addItem(a, 'Rice');
  sync(server, a, b);

  // Stamps must sit after the item was created, or they are stale by
  // definition and both phones are right to ignore them.
  const t0 = a.items[item.id].updatedAt;
  editItem(a, item.id, { text: 'Basmati rice' });
  a.items[item.id].updatedAt = t0 + 1000;
  editItem(b, item.id, { text: 'Brown rice' });
  b.items[item.id].updatedAt = t0 + 2000;   // b edited later

  sync(server, a, b);
  assert.equal(a.items[item.id].text, 'Brown rice');
  assert.equal(b.items[item.id].text, 'Brown rice');
});

test('simultaneous conflicting edits converge to the same answer', () => {
  const server = {}, a = phone(), b = phone();
  const item = addItem(a, 'Tea');
  sync(server, a, b);

  // Same millisecond on both phones — timestamps cannot break this tie.
  const t0 = a.items[item.id].updatedAt;
  editItem(a, item.id, { text: 'Green tea' });
  a.items[item.id].updatedAt = t0 + 5000;
  editItem(b, item.id, { text: 'Black tea' });
  b.items[item.id].updatedAt = t0 + 5000;

  const rounds = settle(server, a, b);
  assert.ok(rounds <= 3, `should settle quickly, took ${rounds} rounds`);

  assert.equal(a.items[item.id].text, b.items[item.id].text,
    'both phones must land on the same text');
  // ...and it must be one of the two edits, not the pre-edit value.
  assert.ok(['Green tea', 'Black tea'].includes(a.items[item.id].text),
    `expected one of the two edits, got ${a.items[item.id].text}`);
});

test('clear-done removes only checked items', () => {
  const server = {}, a = phone(), b = phone();
  const milk = addItem(a, 'Milk');
  addItem(a, 'Bread');
  editItem(a, milk.id, { done: true });

  clearDone(a);
  sync(server, a, b);

  assert.deepEqual(names(a), ['Bread']);
  assert.deepEqual(names(b), ['Bread']);
});

test('a long offline stretch of edits syncs as one batch', () => {
  const server = {}, a = phone(), b = phone();
  sync(server, a, b);

  const items = ['Apples', 'Pears', 'Oats'].map((t) => addItem(a, t));
  editItem(a, items[1].id, { done: true });
  editItem(a, items[2].id, { deleted: true });
  assert.equal(pending(a).length, 3, 'three rows queued while offline');

  sync(server, a, b);
  assert.deepEqual(names(b).sort(), ['Apples', 'Pears*']);
  assert.equal(pending(a).length, 0, 'queue drains after sync');
});

test('re-syncing repeatedly changes nothing (idempotent)', () => {
  const server = {}, a = phone(), b = phone();
  addItem(a, 'Salt');
  addItem(b, 'Pepper');
  sync(server, a, b);
  const before = JSON.stringify(names(a).sort());

  for (let i = 0; i < 5; i++) sync(server, a, b);

  assert.equal(JSON.stringify(names(a).sort()), before);
  assert.equal(JSON.stringify(names(b).sort()), before);
});

test('converges no matter which phone reaches the server first', () => {
  for (const order of [['a', 'b'], ['b', 'a']]) {
    const server = {}, a = phone(), b = phone();
    const item = addItem(a, 'Jam');
    sync(server, a, b);

    const t0 = a.items[item.id].updatedAt;
    editItem(a, item.id, { text: 'Strawberry jam' });
    a.items[item.id].updatedAt = t0 + 500;
    editItem(b, item.id, { done: true });
    b.items[item.id].updatedAt = t0 + 900;

    const phones = order[0] === 'a' ? [a, b] : [b, a];
    settle(server, ...phones);

    assert.deepEqual(names(a), names(b), `order ${order.join(',')} diverged`);
  }
});

test('a messy offline week on both phones still converges', () => {
  const server = {}, a = phone(), b = phone();
  const shared = ['Milk', 'Eggs', 'Bread'].map((t) => addItem(a, t));
  settle(server, a, b);

  // Both phones go off and do overlapping, conflicting things.
  const t0 = Date.now();
  editItem(a, shared[0].id, { done: true });
  a.items[shared[0].id].updatedAt = t0 + 10;
  editItem(b, shared[0].id, { deleted: true });
  b.items[shared[0].id].updatedAt = t0 + 10;      // exact tie

  editItem(a, shared[1].id, { text: 'Free-range eggs' });
  a.items[shared[1].id].updatedAt = t0 + 20;
  editItem(b, shared[1].id, { done: true });
  b.items[shared[1].id].updatedAt = t0 + 30;      // b later

  addItem(a, 'Coffee');
  addItem(b, 'Tea');

  settle(server, a, b);

  assert.deepEqual(names(a).sort(), names(b).sort(), 'phones must agree');
  assert.ok(names(a).includes('Coffee') && names(a).includes('Tea'),
    'additions from both phones survive');
});

console.log(`\n${passed} passed`);
