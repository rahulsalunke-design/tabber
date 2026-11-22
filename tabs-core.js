// Tab Debt shared logic, used by popup.html (stats, stalest tabs, quick actions)
// and dashboard.html (the full table). Each page calls initTabDebt() once; parts a
// page doesn't have (search, filters, the table, the stalest list) are skipped.

const $ = (sel) => document.querySelector(sel);

// Set by initTabDebt(). closeOnActivate: close this page after switching to a tab
// (the popup does; the dashboard stays open).
const options = { closeOnActivate: false };

// The extension's own pages (popup or dashboard opened as a tab) are not listed or counted.
const OWN_ORIGIN = chrome.runtime.getURL('');

const state = {
  tabs: [],
  windowCount: 0,
  dupeExtra: 0,
  query: '',
  sort: 'domain',
  colSort: null, // { key, dir } from a dashboard column header; null = default order
  filters: { dupes: false, audio: false, discarded: false, stale7: false, stale14: false },
  collapsed: new Set(),
};

let statusTimer = null;

// Undo buffer: the last close/archive batch ({ url, title } per tab). It is stored in
// chrome.storage.local as "undoBuffer" with a savedAt timestamp, so it survives the
// popup closing; Undo is offered while the batch is under 2 minutes old.
const UNDO_MS = 2 * 60 * 1000;
const undo = { items: [], timer: null };

// Duplicate key: the full URL (including search and hash) with only a trailing
// slash removed. The hash is kept so hash-routed apps (e.g. Gmail) aren't flagged.
function normalizeUrl(url) {
  return url ? url.replace(/\/$/, '') : '';
}

function domainOf(url) {
  try {
    const u = new URL(url);
    return u.hostname || u.protocol.replace(/:$/, '') || 'other';
  } catch {
    return 'other';
  }
}

const DAY_MS = 86400000;

// Whole days since the tab was last touched, or null if unknown.
function daysUntouched(t) {
  return t._touched ? Math.floor(Math.max(0, Date.now() - t._touched) / DAY_MS) : null;
}

// "10d", "<1d" or "unknown" for the Untouched column.
function untouchedShort(t) {
  const d = daysUntouched(t);
  if (d === null) return 'unknown';
  return d < 1 ? '<1d' : `${d}d`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function showStatus(msg) {
  $('#status').textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('#status').textContent = ''; }, 4000);
}

function clearUndo() {
  clearTimeout(undo.timer);
  undo.items = [];
  $('#undo').hidden = true;
  chrome.storage.local.remove('undoBuffer');
}

function showUndo(remainingMs) {
  clearTimeout(undo.timer);
  undo.timer = setTimeout(clearUndo, remainingMs);
  const btn = $('#undo');
  btn.textContent = `Undo (${undo.items.length})`;
  btn.hidden = false;
}

// Replace the buffer with the tabs that were actually closed and offer Undo for 2 minutes.
function pushUndo(closedTabs) {
  if (!closedTabs.length) return;
  undo.items = closedTabs.map((t) => ({ url: t._url, title: t.title || '' }));
  chrome.storage.local.set({ undoBuffer: { items: undo.items, savedAt: Date.now() } });
  showUndo(UNDO_MS);
}

// On popup open, bring back the last batch if it is still under 2 minutes old.
async function restoreUndo() {
  const { undoBuffer } = await chrome.storage.local.get('undoBuffer');
  if (!undoBuffer?.items?.length) return;
  const remaining = undoBuffer.savedAt + UNDO_MS - Date.now();
  if (remaining <= 0) return;
  undo.items = undoBuffer.items;
  showUndo(remaining);
}

async function runUndo() {
  const items = undo.items;
  clearUndo();
  let reopened = 0;
  for (const item of items) {
    if (!item.url) continue;
    try {
      await chrome.tabs.create({ url: item.url, active: false });
      reopened += 1;
    } catch {
      // Counted as a failure below.
    }
  }
  const failed = items.length - reopened;
  showStatus(`Reopened ${plural(reopened, 'tab')}${failed ? `; ${failed} could not be reopened` : ''}`);
  await load();
}

// Close the given tabs (skipping any already gone), reload, and feed the undo buffer
// with the ones that are really gone. Returns the closed tabs.
async function closeTabs(victims) {
  const live = new Set(state.tabs.map((t) => t.id));
  const targets = victims.filter((t) => live.has(t.id));
  if (!targets.length) return [];
  try {
    await chrome.tabs.remove(targets.map((t) => t.id));
  } catch {
    // Some may have closed anyway; checked below.
  }
  await load();
  const still = new Set(state.tabs.map((t) => t.id));
  const closed = targets.filter((t) => !still.has(t.id));
  pushUndo(closed);
  return closed;
}

let archiveFolder = null;

// Find (or create, under Other Bookmarks) the "Tab Debt" bookmarks folder.
async function archiveFolderId() {
  if (archiveFolder) return archiveFolder;
  const hits = await chrome.bookmarks.search({ title: 'Tab Debt' });
  const folder = hits.find((n) => !n.url);
  archiveFolder = folder ? folder.id : (await chrome.bookmarks.create({ title: 'Tab Debt' })).id;
  return archiveFolder;
}

// Bookmark each tab into the Tab Debt folder, then close ONLY the ones whose
// bookmark write succeeded. A failed bookmark leaves its tab open.
async function archiveTabs(victims) {
  let folderId;
  try {
    folderId = await archiveFolderId();
  } catch {
    showStatus('Could not open the "Tab Debt" bookmarks folder. Nothing was closed.');
    return;
  }
  const saved = [];
  for (const t of victims) {
    if (!t._url) continue; // An empty url would create a folder, not a bookmark.
    try {
      await chrome.bookmarks.create({ parentId: folderId, title: t.title || t._url, url: t._url });
      saved.push(t);
    } catch {
      // Not bookmarked, so not closed.
    }
  }
  const closed = await closeTabs(saved);
  const notSaved = victims.length - saved.length;
  const notClosed = saved.length - closed.length;
  let msg = `Archived ${plural(closed.length, 'tab')}`;
  if (notSaved) msg += `; ${notSaved} could not be bookmarked and ${notSaved === 1 ? 'was' : 'were'} left open`;
  if (notClosed) msg += `; ${notClosed} bookmarked but could not be closed`;
  showStatus(msg);
}

// Discard tabs (frees memory, keeps the tab). Returns how many were discarded.
async function discardTabs(tabs) {
  let discarded = 0;
  for (const t of tabs) {
    try {
      if (await chrome.tabs.discard(t.id)) discarded += 1;
    } catch {
      // Counted as a failure by the caller.
    }
  }
  await load();
  return discarded;
}

// Every bookmarked URL, keyed the same way as tabs (trailing slash removed).
async function bookmarkedUrls() {
  const urls = new Set();
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.url) urls.add(normalizeUrl(n.url));
      if (n.children) walk(n.children);
    }
  };
  try {
    walk(await chrome.bookmarks.getTree());
  } catch {
    // No SAVED badges if the tree can't be read.
  }
  return urls;
}

async function load() {
  const [allTabs, { tabLog = {} }, saved] = await Promise.all([
    chrome.tabs.query({}),
    chrome.storage.local.get('tabLog'),
    bookmarkedUrls(),
  ]);
  const tabs = allTabs.filter((t) => !(t.url || t.pendingUrl || '').startsWith(OWN_ORIGIN));
  for (const t of tabs) {
    t._url = t.url || t.pendingUrl || '';
    t._key = normalizeUrl(t._url);
    t._domain = domainOf(t._url);
    t._touched = tabLog[t.id]?.lastActivated ?? t.lastAccessed ?? null;
    t._saved = saved.has(t._key);
  }
  state.tabs = tabs;
  state.windowCount = new Set(tabs.map((t) => t.windowId)).size;
  analyze();
  render();
}

// Mark duplicate tabs and count how many are redundant (set size minus one each).
function analyze() {
  const counts = new Map();
  for (const t of state.tabs) {
    if (t._key) counts.set(t._key, (counts.get(t._key) || 0) + 1);
  }
  let extra = 0;
  for (const n of counts.values()) extra += n - 1;
  for (const t of state.tabs) t._dupe = (counts.get(t._key) || 0) > 1;
  state.dupeExtra = extra;
}

function matches(t, q) {
  const f = state.filters;
  if (f.dupes && !t._dupe) return false;
  if (f.audio && !t.audible) return false;
  if (f.discarded && !t.discarded) return false;
  if (f.stale7 && !(daysUntouched(t) >= 7)) return false;
  if (f.stale14 && !(daysUntouched(t) >= 14)) return false;
  if (!q) return true;
  return (t.title || '').toLowerCase().includes(q) || t._url.toLowerCase().includes(q);
}

// Column sorts for the dashboard table. Untouched compares by days untouched
// (dir 1 = fewest days first); tabs with unknown staleness always sort last.
const COLUMN_SORTS = {
  title: (a, b) => (a.title || a._url).localeCompare(b.title || b._url),
  domain: (a, b) => a._domain.localeCompare(b._domain),
  badges: (a, b) => badgeLabels(a).join(' ').localeCompare(badgeLabels(b).join(' ')),
  untouched: (a, b) => b._touched - a._touched,
};

function sortByColumn(items) {
  const { key, dir } = state.colSort;
  items.sort((a, b) => {
    if (key === 'untouched' && (a._touched == null || b._touched == null)) {
      return (a._touched == null) - (b._touched == null);
    }
    return dir * COLUMN_SORTS[key](a, b);
  });
}

// "Label (N)" when there is something to act on; plain label and disabled at zero.
function setBulkButton(sel, label, count) {
  const btn = $(sel);
  if (!btn) return;
  btn.textContent = count ? `${label} (${count})` : label;
  btn.disabled = count === 0;
}

// Popup: up to 3 stalest tabs (7+ days untouched), or the 3 oldest if none are stale.
// Tabs with unknown staleness are left out.
function renderStalest() {
  const section = $('#stalest');
  if (!section) return;
  const known = state.tabs
    .filter((t) => t._touched != null)
    .sort((a, b) => a._touched - b._touched);
  const stale = known.filter((t) => daysUntouched(t) >= 7);
  const picks = (stale.length ? stale : known).slice(0, 3);

  section.hidden = picks.length === 0;
  section.querySelector('.mini-heading').textContent = stale.length
    ? 'Stalest tabs'
    : 'Nothing is 7+ days stale. Oldest tabs:';
  const ul = section.querySelector('.mini-list');
  ul.replaceChildren();
  for (const t of picks) {
    const p = rowParts(t);
    const li = el('li', 'mini-row');
    bindActivate(li, p.activate);
    li.title = t._url;
    li.append(p.icon, p.title, el('span', 'age', untouchedShort(t)), p.close);
    ul.append(li);
  }
}

function render() {
  const staleCount = state.tabs.filter((t) => daysUntouched(t) >= 7).length;
  $('#stats').textContent =
    `${plural(state.tabs.length, 'tab')} · ${plural(state.windowCount, 'window')} · ${plural(state.dupeExtra, 'duplicate')} · ${staleCount} stale`;
  setBulkButton('#close-dupes', 'Close all duplicates', state.dupeExtra);
  setBulkButton('#discard-stale', 'Discard all stale', discardableStale().length);
  setBulkButton('#archive-stale', 'Archive all stale', staleCount);
  renderStalest();

  // The popup has no full tab list; it stops here.
  const list = $('#list');
  if (!list) return;

  const q = state.query.trim().toLowerCase();
  const visible = state.tabs.filter((t) => matches(t, q));

  list.replaceChildren();
  if (!visible.length) {
    list.append(el('div', 'empty', 'No tabs match.'));
    return;
  }

  // Build ordered sections: [domain, items] per group, or a single [null, items].
  let sections;
  if (state.sort === 'staleness') {
    // Flat list, most stale first; tabs with unknown staleness go last.
    if (state.colSort) {
      sortByColumn(visible);
    } else {
      const key = (t) => t._touched ?? Number.MAX_SAFE_INTEGER;
      visible.sort((a, b) => key(a) - key(b));
    }
    sections = [[null, visible]];
  } else {
    const groups = new Map();
    for (const t of visible) {
      if (!groups.has(t._domain)) groups.set(t._domain, []);
      groups.get(t._domain).push(t);
    }
    // Sorting by the Domain column orders the groups by name; other columns sort within groups.
    const byName = state.colSort?.key === 'domain';
    sections = [...groups].sort((a, b) => (byName
      ? state.colSort.dir * a[0].localeCompare(b[0])
      : b[1].length - a[1].length || a[0].localeCompare(b[0])));
    for (const [, items] of sections) {
      if (state.colSort && !byName) sortByColumn(items);
      else items.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));
    }
  }

  renderTable(list, sections);
}

function groupHeader(domain, count, collapsed) {
  const header = el('button', 'group-header');
  header.type = 'button';
  header.setAttribute('aria-expanded', String(!collapsed));
  header.append(el('span', 'domain', domain), el('span', 'count', String(count)));
  header.addEventListener('click', () => {
    if (state.collapsed.has(domain)) state.collapsed.delete(domain);
    else state.collapsed.add(domain);
    render();
  });
  return header;
}

// One table; in "By domain" each group gets a full-width, collapsible group row.
const COLUMNS = [
  { cls: 'c-icon', label: '' },
  { cls: 'c-title', label: 'Title', key: 'title' },
  { cls: 'c-domain', label: 'Domain', key: 'domain' },
  { cls: 'c-badges', label: 'Badges', key: 'badges' },
  { cls: 'c-untouched', label: 'Untouched', key: 'untouched' },
  { cls: 'c-actions', label: 'Actions' },
];

function renderTable(list, sections) {
  const table = el('table', 'tab-table');
  const colgroup = el('colgroup');
  const headRow = el('tr');
  for (const c of COLUMNS) {
    colgroup.append(el('col', c.cls));
    const th = el('th', c.cls);
    th.scope = 'col';
    if (!c.key) {
      th.textContent = c.label;
    } else {
      const active = state.colSort?.key === c.key;
      if (active) th.setAttribute('aria-sort', state.colSort.dir === 1 ? 'ascending' : 'descending');
      const arrow = active ? (state.colSort.dir === 1 ? ' ↑' : ' ↓') : '';
      const btn = el('button', 'th-sort', c.label + arrow);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        // First click: A–Z, or most stale first for Untouched. Clicking again flips it.
        state.colSort = active
          ? { key: c.key, dir: -state.colSort.dir }
          : { key: c.key, dir: c.key === 'untouched' ? -1 : 1 };
        render();
      });
      th.append(btn);
    }
    headRow.append(th);
  }
  const thead = el('thead');
  thead.append(headRow);

  const tbody = el('tbody');
  for (const [domain, items] of sections) {
    if (domain !== null) {
      const collapsed = state.collapsed.has(domain);
      const tr = el('tr', 'group-row');
      const td = el('td');
      td.colSpan = COLUMNS.length;
      td.append(groupHeader(domain, items.length, collapsed));
      tr.append(td);
      tbody.append(tr);
      if (collapsed) continue;
    }
    for (const t of items) tbody.append(renderTableRow(t));
  }

  table.append(colgroup, thead, tbody);
  list.append(table);
}

function badgeLabels(t) {
  const labels = [];
  if (t.pinned) labels.push('PINNED');
  if (t.audible) labels.push('AUDIO');
  if (t.discarded) labels.push('DISCARDED');
  if (t._dupe) labels.push('DUPE');
  if (t._saved) labels.push('SAVED');
  return labels;
}

// The pieces of a tab row (dashboard table and popup stalest list): cells,
// actions and click-to-switch.
function rowParts(t) {
  const icon = el('span', 'favicon');
  if (t.favIconUrl && !t.favIconUrl.startsWith('chrome://')) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = t.favIconUrl;
    img.addEventListener('error', () => img.remove());
    icon.append(img);
  }

  const badges = el('span', 'badges');
  for (const label of badgeLabels(t)) badges.append(el('span', 'badge', label));

  const close = el('button', 'close', '×');
  close.type = 'button';
  close.title = 'Close tab';
  close.setAttribute('aria-label', `Close ${t.title || t._url}`);
  close.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await chrome.tabs.remove(t.id);
    } catch {
      showStatus('Could not close that tab.');
      return;
    }
    state.tabs = state.tabs.filter((x) => x.id !== t.id);
    state.windowCount = new Set(state.tabs.map((x) => x.windowId)).size;
    analyze();
    render();
    pushUndo([t]);
  });

  // Hover actions. The active tab can't be discarded, so it gets no Discard button.
  const actions = el('span', 'row-actions');
  if (!t.discarded && !t.active) {
    const discard = el('button', 'row-btn', 'Discard');
    discard.type = 'button';
    discard.title = 'Free this tab\'s memory; the tab stays open';
    discard.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!(await discardTabs([t]))) showStatus('Could not discard that tab.');
    });
    actions.append(discard);
  }
  const archive = el('button', 'row-btn', 'Archive');
  archive.type = 'button';
  archive.title = 'Bookmark into "Tab Debt", then close';
  archive.addEventListener('click', (e) => {
    e.stopPropagation();
    archiveTabs([t]);
  });
  actions.append(archive);

  const activate = async () => {
    try {
      await chrome.tabs.update(t.id, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
      if (options.closeOnActivate) window.close();
    } catch {
      showStatus('That tab no longer exists.');
      load();
    }
  };

  return { icon, title: el('span', 'title', t.title || t._url || '(untitled)'), badges, actions, close, activate };
}

function bindActivate(node, activate) {
  node.tabIndex = 0;
  node.addEventListener('click', activate);
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === node) activate();
  });
}

function renderTableRow(t) {
  const p = rowParts(t);
  const tr = el('tr', 'trow');
  bindActivate(tr, p.activate);
  tr.title = t._url;
  const cell = (cls, ...kids) => {
    const td = el('td', cls);
    td.append(...kids);
    return td;
  };
  tr.append(
    cell('c-icon', p.icon),
    cell('c-title', p.title),
    cell('c-domain', t._domain),
    cell('c-badges', p.badges),
    cell('c-untouched', untouchedShort(t)),
    cell('c-actions', p.actions, p.close),
  );
  return tr;
}

// Keep the oldest tab (lowest tabId = opened earliest) in each duplicate set.
function planDuplicateClose() {
  const sets = new Map();
  for (const t of state.tabs) {
    if (!t._dupe) continue;
    if (!sets.has(t._key)) sets.set(t._key, []);
    sets.get(t._key).push(t);
  }
  const toClose = [];
  for (const set of sets.values()) {
    set.sort((a, b) => a.id - b.id);
    toClose.push(...set.slice(1));
  }
  return toClose;
}

const BULK_BUTTONS = ['#close-dupes', '#discard-stale', '#archive-stale'];

function hideConfirm() {
  const box = $('#confirm');
  if (box) box.remove();
  for (const sel of BULK_BUTTONS) if ($(sel)) $(sel).hidden = false;
}

// Replace the trigger button with a confirm panel listing the titles it will act on.
// onConfirm runs only if the user clicks the confirm button.
function showConfirm(trigger, verb, victims, onConfirm) {
  hideConfirm();

  const box = el('div', 'confirm');
  box.id = 'confirm';
  box.append(el('div', 'confirm-title', `${verb} ${plural(victims.length, 'tab')}?`));

  const list = el('ul', 'confirm-list');
  for (const t of victims) {
    const li = el('li', null, t.title || t._url || '(untitled)');
    li.title = t._url;
    list.append(li);
  }

  const ok = el('button', 'confirm-ok', `${verb} ${plural(victims.length, 'tab')}`);
  ok.type = 'button';
  const cancel = el('button', 'confirm-cancel', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', hideConfirm);
  ok.addEventListener('click', () => {
    hideConfirm();
    onConfirm();
  });

  const actions = el('div', 'confirm-actions');
  actions.append(cancel, ok);
  box.append(list, actions);

  trigger.hidden = true;
  $('.actions').after(box);
  cancel.focus();
}

function closeAllDuplicates() {
  const victims = planDuplicateClose();
  if (!victims.length) return;
  showConfirm($('#close-dupes'), 'Close', victims, async () => {
    const closed = await closeTabs(victims);
    const failed = victims.length - closed.length;
    showStatus(`Closed ${plural(closed.length, 'tab')}${failed ? `; ${failed} could not be closed` : ''}`);
  });
}

const staleTabs = () => state.tabs.filter((t) => daysUntouched(t) >= 7);
const discardableStale = () => staleTabs().filter((t) => !t.discarded && !t.active);

// Reversible, so no confirm.
async function discardAllStale() {
  const targets = discardableStale();
  if (!targets.length) return;
  const n = await discardTabs(targets);
  const failed = targets.length - n;
  showStatus(`Discarded ${plural(n, 'tab')}${failed ? `; ${failed} could not be discarded` : ''}`);
}

function archiveAllStale() {
  const victims = staleTabs();
  if (!victims.length) return;
  showConfirm($('#archive-stale'), 'Bookmark and close', victims, () => archiveTabs(victims));
}

// Wire up whichever shared controls this page has, then load. Call once per page.
function initTabDebt(opts = {}) {
  Object.assign(options, opts);

  $('#search')?.addEventListener('input', (e) => {
    state.query = e.target.value;
    render();
  });

  for (const btn of document.querySelectorAll('.toggle[data-sort]')) {
    btn.addEventListener('click', () => {
      state.sort = btn.dataset.sort;
      state.colSort = null;
      for (const b of document.querySelectorAll('.toggle[data-sort]')) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
      render();
    });
  }

  for (const btn of document.querySelectorAll('.toggle[data-filter]')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.filter;
      state.filters[key] = !state.filters[key];
      btn.setAttribute('aria-pressed', String(state.filters[key]));
      render();
    });
  }

  $('#close-dupes').addEventListener('click', closeAllDuplicates);
  $('#discard-stale').addEventListener('click', discardAllStale);
  $('#archive-stale')?.addEventListener('click', archiveAllStale);
  $('#undo').addEventListener('click', runUndo);

  restoreUndo();
  load();
}
