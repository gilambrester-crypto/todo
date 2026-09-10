// Supabase sync.
//
// Talks to PostgREST over plain fetch — no SDK, so there is nothing extra to
// cache for offline use. The list code is sent as an `x-list-key` header,
// which the row-level-security policy in supabase/schema.sql checks. That way
// the (public) anon key on its own is not enough to read anybody's list.

import { mergeRemote, pending, purge } from './store.js';

const TIMEOUT_MS = 10000;

export function isConfigured(cfg) {
  return Boolean(cfg && cfg.url && cfg.anonKey && cfg.listId);
}

function headers(cfg) {
  return {
    'apikey': cfg.anonKey,
    'Authorization': `Bearer ${cfg.anonKey}`,
    'x-list-key': cfg.listId,
    'Content-Type': 'application/json',
  };
}

function endpoint(cfg, query = '') {
  return `${cfg.url.replace(/\/+$/, '')}/rest/v1/items${query}`;
}

async function request(url, options) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(describe(res.status, body));
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function describe(status, body) {
  const detail = (body || '').slice(0, 200);
  if (status === 401 || status === 403) {
    return 'Rejected by Supabase (401/403). Check the anon key, and that the ' +
           'table and its policy from supabase/schema.sql exist.';
  }
  if (status === 404) {
    return 'Not found (404). The `items` table does not exist in this project yet.';
  }
  return `Supabase returned ${status}. ${detail}`;
}

// Wire format: snake_case columns <-> camelCase in the app.
function toRow(item, listId) {
  return {
    id: item.id,
    list_id: listId,
    text: item.text,
    done: item.done,
    deleted: item.deleted,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

function fromRow(row) {
  return {
    id: row.id,
    text: row.text ?? '',
    done: Boolean(row.done),
    deleted: Boolean(row.deleted),
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

async function pull(cfg, state) {
  const url = endpoint(cfg, `?list_id=eq.${encodeURIComponent(cfg.listId)}&select=*`);
  const res = await request(url, { method: 'GET', headers: headers(cfg) });
  const rows = await res.json();

  let changed = false;
  for (const row of rows) {
    if (mergeRemote(state, fromRow(row))) changed = true;
  }
  return changed;
}

async function push(cfg, state) {
  const outbox = pending(state);
  if (outbox.length === 0) return;

  const url = endpoint(cfg, '?on_conflict=id');
  await request(url, {
    method: 'POST',
    headers: { ...headers(cfg), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(outbox.map((item) => toRow(item, cfg.listId))),
  });

  // Only clear the flag on rows the user did not touch mid-flight.
  for (const item of outbox) {
    const current = state.items[item.id];
    if (current && current.updatedAt === item.updatedAt) current.dirty = false;
  }
}

/**
 * One full sync round. Pull first so that incoming remote edits can supersede
 * our own before we push, then send whatever is still ours to send.
 *
 * Returns true when local state changed and the UI should repaint.
 */
export async function syncOnce(cfg, state) {
  if (!isConfigured(cfg)) throw new Error('not-configured');
  const changed = await pull(cfg, state);
  await push(cfg, state);
  purge(state);
  return changed;
}

/** Settings-screen diagnostic: reports the real reason rather than "failed". */
export async function testConnection(cfg) {
  if (!cfg.url || !cfg.anonKey || !cfg.listId) {
    return { ok: false, message: 'Fill in all three fields first.' };
  }
  if (!/^https:\/\/[^/]+/.test(cfg.url)) {
    return { ok: false, message: 'The project URL should look like https://xxxx.supabase.co' };
  }
  try {
    const url = endpoint(cfg, `?list_id=eq.${encodeURIComponent(cfg.listId)}&select=id&limit=1`);
    await request(url, { method: 'GET', headers: headers(cfg) });
    return { ok: true, message: 'Connected. This phone is now sharing the list.' };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, message: 'Timed out. Is this phone online?' };
    }
    if (err instanceof TypeError) {
      return { ok: false, message: 'Could not reach Supabase. Check the URL and your connection.' };
    }
    return { ok: false, message: err.message };
  }
}
