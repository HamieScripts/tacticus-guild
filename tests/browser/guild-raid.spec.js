const { test, expect } = require('@playwright/test');

test('Guild Raid requests its season catalog before DOMContentLoaded', async ({ page }) => {
  let releaseDeferredScript;
  const deferredScript = new Promise(resolve => { releaseDeferredScript = resolve; });
  await page.route('**/src/numeric-font.js', async route => {
    await deferredScript;
    await route.continue();
  });
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));

  const catalogRequest = page.waitForRequest('**/rest/v1/raid_seasons?**', { timeout: 5000 });
  try {
    await page.goto('/guild-raid.html', { waitUntil: 'commit' });
    await catalogRequest;
    expect(await page.evaluate(() => performance.getEntriesByType('navigation')[0].domContentLoadedEventStart)).toBe(0);
  } finally {
    releaseDeferredScript();
  }
  await page.waitForLoadState('domcontentloaded');
});

test('Guild Raid requests the selected season entries while the player directory is pending', async ({ page }) => {
  let releasePlayers;
  const playersGate = new Promise(resolve => { releasePlayers = resolve; });
  const requestedSeasons = [];
  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/players')) await playersGate;
    if (url.pathname.endsWith('/raid_entries')) requestedSeasons.push(url.searchParams.get('season'));
    const rows = url.pathname.endsWith('/raid_seasons')
      ? [114, 113, 112].map(season => ({ season, guild_id: 'test-guild' }))
      : [];
    await route.fulfill({ json: rows });
  });

  try {
    await page.goto('/guild-raid.html?season=113');
    await expect.poll(() => [...requestedSeasons].sort()).toEqual(['eq.112', 'eq.113']);
  } finally {
    releasePlayers();
  }
});