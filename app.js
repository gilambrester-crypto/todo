import {
  load, save, visible, addItem, editItem, clearDone, pending,
} from './store.js';
import { syncOnce, testConnection, isConfigured } from './sync.js';

const CONFIG_KEY = 'shopping-list/config';
const POLL_MS = 20000;
const PUSH_DEBOUNCE_MS = 800;

const state = load();
let config = await loadConfig();
let editingId = null;      // suppress repaints while the user types
let syncing = false;
let lastSyncAt = 0;
let lastError = '';

const el = {
  list: document.getElementById('list'),
  doneList: document.getElementById('done-list'),
  doneSection: document.getElementById('done-section'),
  empty: document.getElementById('empty'),
  status: document.getElementById('status'),
  form: document.getElementById('add-form'),
  input: document.getElementById('add-input'),
  clearDone: document.getElementById('clear-done'),
  settings: document.getElementById('settings'),
  settingsBtn: document.getElementById('settings-btn'),
  cfgUrl: document.getElementById('cfg-url'),
  cfgKey: document.getElementById('cfg-key'),
  cfgList: document.getElementById('cfg-list'),
  cfgResult: document.getElementById('cfg-result'),
  cfgTest: document.getElementById('cfg-test'),
  cfgSave: document.getElementById('cfg-save'),
};

/* ------------------------------------------------------------------ config */

async function loadConfig() {
  // A value saved on this phone wins over the one baked into config.js.
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (saved && saved.url && saved.anonKey && saved.listId) return saved;
  } catch { /* fall through to the bundled defaults */ }

  try {
    const mod = await import('./config.js');
    const d = mod.default || {};
    return { url: d.url || '', anonKey: d.anonKey || '', listId: d.listId || '' };
  } catch {
    return { url: '', anonKey: '', listId: '' };
  }
}

/* ------------------------------------------------------------------ render */

function icon(path, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

function rowFor(item) {
  const li = document.createElement('li');
  li.className = 'row' + (item.done ? ' is-done' : '');
  li.dataset.id = item.id;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'check';
  check.setAttribute('aria-pressed', String(item.done));
  check.setAttribute('aria-label', item.done ? `Uncheck ${item.text}` : `Check off ${item.text}`);
  const box = document.createElement('span');
  box.className = 'box';
  box.append(icon('M20 6 9 17l-5-5'));
  check.append(box);
  check.addEventListener('click', () => {
    editItem(state, item.id, { done: !item.done });
    commit();
  });

  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'label';
  label.textContent = item.text;
  label.addEventListener('click', () => startEdit(li, item));

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'del';
  del.setAttribute('aria-label', `Remove ${item.text}`);
  del.append(icon('M18 6 6 18M6 6l12 12'));
  del.addEventListener('click', () => {
    editItem(state, item.id, { deleted: true });
    commit();
  });

  li.append(check, label, del);
  return li;
}

function startEdit(li, item) {
  editingId = item.id;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'label-edit';
  input.value = item.text;
  input.setAttribute('aria-label', 'Edit item');

  let settled = false;
  const finish = (keep) => {
    if (settled) return;
    settled = true;
    editingId = null;
    const text = input.value.trim();
    if (keep && text && text !== item.text) {
      editItem(state, item.id, { text });
    } else if (keep && !text) {
      editItem(state, item.id, { deleted: true }); // emptied out == removed
    }
    commit();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));

  li.replaceChild(input, li.querySelector('.label'));
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function render() {
  if (editingId) return; // don't yank the input out from under the keyboard

  const items = visible(state);
  const todo = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  el.list.replaceChildren(...todo.map(rowFor));
  el.doneList.replaceChildren(...done.map(rowFor));

  el.empty.hidden = items.length > 0;
  el.doneSection.hidden = done.length === 0;

  renderStatus();
}

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 7200) return 'an hour ago';
  return `${Math.round(s / 3600)} hours ago`;
}

function renderStatus() {
  const waiting = pending(state).length;
  let text;
  let warn = false;

  if (!isConfigured(config)) {
    text = 'This phone only — tap ⚙ to share with another phone';
  } else if (!navigator.onLine) {
    text = waiting
      ? `Offline — ${waiting} change${waiting > 1 ? 's' : ''} saved, will sync later`
      : 'Offline — saved on this phone';
  } else if (syncing) {
    text = 'Syncing…';
  } else if (lastError) {
    text = lastError;
    warn = true;
  } else if (lastSyncAt) {
    text = `Synced ${ago(lastSyncAt)}`;
  } else {
    text = 'Connecting…';
  }

  el.status.textContent = text;
  el.status.classList.toggle('warn', warn);
}

/** Persist, repaint, and schedule a push of whatever just changed. */
function commit() {
  save(state);
  render();
  scheduleSync();
}

/* -------------------------------------------------------------------- sync */

let syncTimer = null;

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, PUSH_DEBOUNCE_MS);
}

async function runSync() {
  if (syncing || !isConfigured(config) || !navigator.onLine) {
    renderStatus();
    return;
  }
  syncing = true;
  renderStatus();
  try {
    const changed = await syncOnce(config, state);
    lastError = '';
    lastSyncAt = Date.now();
    save(state);
    if (changed) render();
  } catch (err) {
    lastError = err.name === 'AbortError'
      ? 'Sync timed out — will retry'
      : `Sync problem: ${err.message}`;
  } finally {
    syncing = false;
    renderStatus();
  }
}

/* ----------------------------------------------------------------- settings */

function openSettings() {
  el.cfgUrl.value = config.url;
  el.cfgKey.value = config.anonKey;
  el.cfgList.value = config.listId;
  el.cfgResult.hidden = true;
  el.settings.showModal();
}

function readForm() {
  return {
    url: el.cfgUrl.value.trim(),
    anonKey: el.cfgKey.value.trim(),
    listId: el.cfgList.value.trim(),
  };
}

function showResult(ok, message) {
  el.cfgResult.textContent = message;
  el.cfgResult.className = `cfg-result ${ok ? 'ok' : 'bad'}`;
  el.cfgResult.hidden = false;
}

el.settingsBtn.addEventListener('click', openSettings);

el.cfgTest.addEventListener('click', async () => {
  el.cfgTest.disabled = true;
  showResult(true, 'Testing…');
  const result = await testConnection(readForm());
  showResult(result.ok, result.message);
  el.cfgTest.disabled = false;
});

el.cfgSave.addEventListener('click', () => {
  config = readForm();
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch { /* storage blocked; settings last for this session only */ }

  // Everything local becomes unsynced work for the newly-pointed-at list.
  if (isConfigured(config)) {
    for (const item of Object.values(state.items)) item.dirty = true;
    save(state);
  }
  lastError = '';
  lastSyncAt = 0;
  el.settings.close();
  render();
  runSync();
});

/* -------------------------------------------------------------------- input */

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.input.value.trim();
  if (!text) return;
  addItem(state, text);
  el.input.value = '';
  el.input.focus(); // keep the keyboard up for a second item
  commit();
});

el.clearDone.addEventListener('click', () => {
  clearDone(state);
  commit();
});

window.addEventListener('online', runSync);
window.addEventListener('offline', renderStatus);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) runSync();
});

setInterval(() => {
  if (!document.hidden) runSync();
}, POLL_MS);

// Keep the "Synced 3 min ago" line honest without a full repaint.
setInterval(renderStatus, 30000);

/* ---------------------------------------------------------- service worker */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    reg.update();
  } catch { /* app still works, just without offline caching */ }
}

// This module uses top-level await, so `load` has usually already fired by the
// time we get here — listening for it would silently never register the worker,
// and the app would quietly stop working offline.
if (document.readyState === 'complete') {
  registerServiceWorker();
} else {
  window.addEventListener('load', registerServiceWorker, { once: true });
}

render();
runSync();
