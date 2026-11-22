// Fake chrome.* API with made-up tabs, so the popup and dashboard can be
// screenshotted outside Chrome. Loaded before tabs-core.js by capture.sh.
//
// URL options:
//   ?scenario=stale   (default) a mix of fresh and 7+ day old tabs
//   ?scenario=fresh   nothing is 7+ days old
//   &then=a,b         clicks to make after loading:
//                     confirm-archive, sort-staleness, sort-title

(() => {
  const params = new URLSearchParams(location.search);
  const scenario = params.get('scenario') || 'stale';
  const now = Date.now();
  const H = 3600000;
  const D = 24 * H;

  const COLORS = ['#1a73e8', '#0f766e', '#c2410c', '#6d28d9', '#334155', '#15803d', '#be123c', '#0369a1'];
  const iconFor = (domain) => {
    let hash = 0;
    for (const ch of domain) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const color = COLORS[hash % COLORS.length];
    const letter = domain.replace(/^www\./, '')[0].toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="${color}"/><text x="16" y="22" text-anchor="middle" font-family="system-ui,sans-serif" font-size="18" font-weight="700" fill="#fff">${letter}</text></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  };

  // [url, title, age in days (null = unknown), extras]
  const RAW = [
    ['https://mail.google.com/mail/u/0/#inbox', 'Inbox (12)', 0, { active: true }],
    ['https://github.com/acme/web-app/pulls', 'Pull requests · acme/web-app', 0.2],
    ['https://github.com/acme/web-app/issues/482', 'Fix flaky login test · Issue #482', 3],
    ['https://github.com/acme/web-app/issues/482', 'Fix flaky login test · Issue #482', 9],
    ['https://github.com/acme/design-tokens', 'acme/design-tokens: Shared colour and type tokens', 21],
    ['https://docs.google.com/document/d/1/edit', 'Q3 planning notes', 1],
    ['https://docs.google.com/spreadsheets/d/2/edit', 'Hiring tracker', 12],
    ['https://docs.google.com/presentation/d/3/edit', 'Team offsite deck (draft)', 34],
    ['https://developer.chrome.com/docs/extensions/reference/api/tabs', 'chrome.tabs  |  API  |  Chrome for Developers', 2, { pinned: true }],
    ['https://developer.chrome.com/docs/extensions/develop/concepts/service-workers', 'Extension service workers', 15],
    ['https://developer.mozilla.org/en-US/docs/Web/CSS/position', 'position - CSS: Cascading Style Sheets | MDN', 8],
    ['https://developer.mozilla.org/en-US/docs/Web/CSS/text-overflow', 'text-overflow - CSS | MDN', 8],
    ['https://stackoverflow.com/questions/1/sticky-table-header', 'html - Sticky table header with a sticky page header - Stack Overflow', 26],
    ['https://stackoverflow.com/questions/2/chrome-tabs-discard', 'javascript - Does chrome.tabs.discard change the tab id? - Stack Overflow', 19],
    ['https://www.youtube.com/watch?v=abc', 'Lo-fi beats to focus to', 0.1, { audible: true }],
    ['https://www.youtube.com/watch?v=def', 'Conference talk: Designing calm software', 41, { discarded: true }],
    ['https://en.wikipedia.org/wiki/Technical_debt', 'Technical debt - Wikipedia', 30, { saved: true }],
    ['https://en.wikipedia.org/wiki/Zeigarnik_effect', 'Zeigarnik effect - Wikipedia', 52, { discarded: true }],
    ['https://news.ycombinator.com/item?id=1', 'Ask HN: How many tabs do you keep open?', 4],
    ['https://news.ycombinator.com/item?id=2', 'Show HN: A tiny tab tracker', 11],
    ['https://www.figma.com/design/abc/Onboarding', 'Onboarding flow v3 – Figma', 6],
    ['https://www.figma.com/design/def/Settings', 'Settings redesign – Figma', 23, { saved: true }],
    ['https://calendar.google.com/calendar/u/0/r/week', 'Google Calendar - Week of Nov 16', 0.5],
    ['https://www.notion.so/Reading-list-1', 'Reading list', 17],
    ['https://www.notion.so/Reading-list-1', 'Reading list', 2],
    ['https://medium.com/@someone/on-tab-hoarding', 'On tab hoarding and the cost of open loops', 64],
    ['https://www.nytimes.com/2026/11/01/technology/attention.html', 'The attention economy, revisited', 21],
    ['https://maps.google.com/?q=coffee', 'coffee - Google Maps', null],
  ];

  const tabs = RAW.map(([url, title, age, extra = {}], i) => {
    const domain = new URL(url).hostname;
    let days = age;
    if (scenario === 'fresh' && days !== null) days = Math.min(days, 0.2 + (i % 6) * 0.9);
    return {
      id: 100 + i,
      windowId: i < 18 ? 1 : 2,
      index: i,
      url,
      title,
      favIconUrl: iconFor(domain),
      lastAccessed: days === null ? undefined : now - days * D,
      active: !!extra.active,
      pinned: !!extra.pinned,
      audible: !!extra.audible,
      discarded: !!extra.discarded,
    };
  });
  // The dashboard itself, which the extension leaves out of the list.
  tabs.push({ id: 999, windowId: 1, url: 'chrome-extension://mock/dashboard.html', title: 'Tab Debt' });

  const savedUrls = RAW.filter((r) => r[3] && r[3].saved).map((r) => ({ url: r[0], title: r[1] }));

  window.chrome = {
    runtime: { getURL: (p) => 'chrome-extension://mock/' + p },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    bookmarks: {
      getTree: async () => [{ id: '0', children: [{ id: '1', title: 'Bookmarks bar', children: savedUrls }] }],
      search: async () => [],
      create: async () => ({ id: 'x' }),
    },
    tabs: {
      query: async () => tabs.map((t) => ({ ...t })),
      update: async () => {},
      remove: async () => {},
      discard: async () => undefined,
      create: async () => {},
    },
    windows: { update: async () => {} },
  };

  const steps = (params.get('then') || '').split(',').filter(Boolean);
  const click = (sel) => document.querySelector(sel)?.click();
  const ACTIONS = {
    'confirm-archive': () => click('#archive-stale'),
    'sort-staleness': () => click('[data-sort="staleness"]'),
    'sort-title': () => click('th.c-title .th-sort'),
  };
  window.addEventListener('load', () => {
    let delay = 150;
    for (const step of steps) {
      setTimeout(() => ACTIONS[step] && ACTIONS[step](), delay);
      delay += 100;
    }
  });
})();
