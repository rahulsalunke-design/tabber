// Tab Debt logger. Keeps chrome.storage.local "tabLog" keyed by tabId:
//   { url, title, firstSeen, lastActivated, activationCount, openerTabId }
// and "closedLog": an array of closed tabs, oldest first, capped at 2000:
//   { url, title, firstSeen, lastActivated, activationCount, closedAt, tabId, openerTabId }
// NOTE: Chrome can assign a new tabId when a tab is discarded (handled by onReplaced)
// and on browser restart (partly recovered by url matching in seed()).

const CLOSED_LOG_CAP = 2000;

let queue = Promise.resolve();

// Serialize read-modify-write cycles so overlapping events don't clobber each other.
// fn(tabLog, data) gets any extraKeys in data; it may return extra keys to write
// in the same storage.set call.
function mutate(fn, extraKeys = []) {
  queue = queue
    .then(async () => {
      const data = await chrome.storage.local.get(['tabLog', ...extraKeys]);
      const tabLog = data.tabLog || {};
      const extra = fn(tabLog, data);
      await chrome.storage.local.set({ tabLog, ...extra });
    })
    .catch((err) => console.error('Tab Debt: tabLog update failed', err));
  return queue;
}

function newEntry(url, title, openerTabId) {
  return {
    url: url || '',
    title: title || '',
    firstSeen: Date.now(),
    lastActivated: null,
    activationCount: 0,
    openerTabId: openerTabId ?? null,
  };
}

async function seed() {
  const tabs = await chrome.tabs.query({});
  const { backfillDone } = await chrome.storage.local.get('backfillDone');
  mutate((log) => {
    const live = new Set(tabs.map((t) => String(t.id)));
    // Orphan recovery: a live tab with no entry takes over an entry whose tabId is
    // gone but whose url matches (history lost to an earlier discard). Each orphan
    // is used at most once; unmatched orphans are then dropped.
    const orphans = Object.keys(log).filter((id) => !live.has(id));
    for (const t of tabs) {
      if (log[t.id]) continue;
      const url = t.url || t.pendingUrl || '';
      const i = url ? orphans.findIndex((id) => log[id].url === url) : -1;
      if (i === -1) continue;
      log[t.id] = log[orphans[i]];
      delete log[orphans[i]];
      orphans.splice(i, 1);
    }
    for (const id of orphans) delete log[id];
    for (const t of tabs) {
      if (!log[t.id]) log[t.id] = newEntry(t.url || t.pendingUrl, t.title, t.openerTabId);
      else log[t.id].title = t.title || log[t.id].title || '';
    }
    if (backfillDone) return;
    // One-time backfill: rescue Chrome's own lastAccessed history before it is lost.
    for (const t of tabs) {
      const e = log[t.id];
      if (e.lastActivated === null && t.lastAccessed) {
        e.lastActivated = t.lastAccessed;
        e.firstSeen = Math.min(e.firstSeen, t.lastAccessed);
      }
    }
    return { backfillDone: true };
  });
}

chrome.runtime.onInstalled.addListener(seed);
chrome.runtime.onStartup.addListener(seed);

// openerTabId links a tab to the tab it was opened from (rabbit-hole chains).
chrome.tabs.onCreated.addListener((tab) => {
  mutate((log) => {
    log[tab.id] = newEntry(tab.url || tab.pendingUrl, tab.title, tab.openerTabId);
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  mutate((log) => {
    const e = log[tabId] || (log[tabId] = newEntry(''));
    e.lastActivated = Date.now();
    e.activationCount += 1;
  });
});

// Track url and title; title is needed for closedLog since onRemoved can't read it.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.title === undefined) return;
  mutate((log) => {
    const e = log[tabId] || (log[tabId] = newEntry(tab.url, tab.title, tab.openerTabId));
    if (changeInfo.url) e.url = changeInfo.url;
    if (changeInfo.title !== undefined) e.title = changeInfo.title;
  });
});

// A discard can swap the tab for one with a new id. Move the entry with all its
// fields, and repoint children's openerTabId so chains survive. Discards never land
// in closedLog: the old id's entry is gone, and onRemoved ignores ids with no entry.
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  mutate((log) => {
    if (log[removedTabId]) log[addedTabId] = log[removedTabId];
    delete log[removedTabId];
    for (const e of Object.values(log)) {
      if (e.openerTabId === removedTabId) e.openerTabId = addedTabId;
    }
  });
});

// Move the closed tab's entry into closedLog (dropping the oldest past the cap).
chrome.tabs.onRemoved.addListener((tabId) => {
  mutate((log, { closedLog = [] }) => {
    const e = log[tabId];
    if (!e) return undefined;
    delete log[tabId];
    closedLog.push({
      url: e.url,
      title: e.title || '',
      firstSeen: e.firstSeen,
      lastActivated: e.lastActivated,
      activationCount: e.activationCount,
      closedAt: Date.now(),
      tabId,
      openerTabId: e.openerTabId ?? null,
    });
    if (closedLog.length > CLOSED_LOG_CAP) closedLog.splice(0, closedLog.length - CLOSED_LOG_CAP);
    return { closedLog };
  }, ['closedLog']);
});
