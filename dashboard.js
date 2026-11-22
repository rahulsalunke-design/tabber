// Full-page view entry point: the primary surface, with the full tab table.
// Shared logic lives in tabs-core.js.

initTabDebt();

// Keep the table's sticky header row just below the sticky page header.
const pageHeader = $('header');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--head-h', `${pageHeader.offsetHeight}px`);
}).observe(pageHeader);

// This page can stay open for a long time; refresh the list whenever it is shown again.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});
