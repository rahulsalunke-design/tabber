// Popup entry point: a glance (stats, the 3 stalest tabs, quick actions). The full
// tab list lives in dashboard.html; shared logic is in tabs-core.js.

const DASHBOARD_URL = chrome.runtime.getURL('dashboard.html');

// Focus the full view if it is already open in any window; otherwise open it.
async function openFullView() {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => (t.url || t.pendingUrl || '').startsWith(DASHBOARD_URL));
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: DASHBOARD_URL });
  }
  window.close();
}

$('#open-full').addEventListener('click', openFullView);

initTabDebt({ closeOnActivate: true });
