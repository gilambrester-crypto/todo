// Local-first storage for the shopping list.
//
// Every change is written to localStorage synchronously, so the app is fully
// usable with no network. Each item carries an `updatedAt` stamp and a
// tombstone flag, which is what lets two phones merge their lists later
// without a server deciding who "won".

const KEY = 'shopping-list/v1';
const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000; // forget deletions after 30 days

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback for older WebViews: RFC-4122 v4 from getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function blank() {
  return { items: {}, deviceId: newId() };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object' || !state.items) return blank();
    if (!state.deviceId) state.deviceId = newId();
    return state;
  } catch {
    // Corrupt or unavailable storage (private mode, quota) — start clean
    // rather than leaving the user with a broken app.
    return blank();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* Out of quota or storage blocked: the in-memory list still works. */
  }
}

/** Items to show, newest additions last, in the order they were added. */
export function visible(state) {
  return Object.values(state.items)
    .filter((i) => !i.deleted)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function addItem(state, text) {
  const now = Date.now();
  const item = {
    id: newId(),
    text: text.trim(),
    done: false,
    deleted: false,
    createdAt: now,
    updatedAt: now,
    dirty: true,
  };
  state.items[item.id] = item;
  return item;
}

/** Apply a local edit. `patch` is any subset of {text, done, deleted}. */
export function editItem(state, id, patch) {
  const item = state.items[id];
  if (!item) return null;
  Object.assign(item, patch, { updatedAt: Date.now(), dirty: true });
  return item;
}

export function clearDone(state) {
  for (const item of Object.values(state.items)) {
    if (item.done && !item.deleted) {
      editItem(state, item.id, { deleted: true });
    }
  }
}

/**
 * Last-write-wins merge of one remote row into local state.
 *
 * Two phones can stamp the same millisecond, so timestamps alone cannot settle
 * every conflict. We fall back to comparing content: both phones run the
 * identical comparison and pick the same winner without coordinating.
 *
 * The server itself keeps whichever row was written last, which will sometimes
 * be the loser of that comparison. So when our copy wins we re-flag it dirty,
 * which pushes the agreed winner back up. Without that, the two phones can
 * disagree forever, each politely refusing the other's version.
 */
function rank(item) {
  return `${item.deleted ? 1 : 0}|${item.done ? 1 : 0}|${item.text}`;
}

function same(a, b) {
  return a.updatedAt === b.updatedAt && rank(a) === rank(b);
}

function winner(local, remote) {
  if (remote.updatedAt > local.updatedAt) return remote;
  if (remote.updatedAt < local.updatedAt) return local;
  return rank(remote) > rank(local) ? remote : local;
}

export function mergeRemote(state, remote) {
  const local = state.items[remote.id];

  if (!local) {
    state.items[remote.id] = { ...remote, dirty: false };
    return true;
  }

  if (winner(local, remote) === remote) {
    // Remote supersedes ours, including any edit we had not pushed yet.
    state.items[remote.id] = { ...remote, dirty: false };
    return true;
  }

  // Ours won. Push it back unless the server already agrees with us.
  local.dirty = !same(local, remote);
  return false;
}

/** Drop tombstones both phones have long since seen. */
export function purge(state) {
  const cutoff = Date.now() - TOMBSTONE_TTL;
  for (const [id, item] of Object.entries(state.items)) {
    if (item.deleted && !item.dirty && item.updatedAt < cutoff) {
      delete state.items[id];
    }
  }
}

export function pending(state) {
  return Object.values(state.items).filter((i) => i.dirty);
}
