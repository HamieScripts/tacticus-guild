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