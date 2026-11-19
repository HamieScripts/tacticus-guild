const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gzipSync } = require('node:zlib');

const archive = 'history-2026-11-06-08403c50';
const log = '/guild-wars-battle-log.html';
const fixture = join(__dirname, '../../data/war/effdbc91-0bed-48b6-9300-850c24c4e0d1.json');

async function stubWarData(page) {
  await page.route('https://**', route => route.abort());
  await page.route('**/src/lib/supabase-data.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.supabaseData = {
      listArchivedWars: async () => [{ key: '${archive}', label: 'Archived war' }],
      loadWarDataset: async () => ({ data: await fetch('/war-fixture.json').then(response => response.json()) })
    };`,
  }));
  await page.route('**/war-fixture.json', route => route.fulfill({ path: fixture }));
}

test('opens a filtered archive directly, restores it after reload, and supports browser history', async ({ page }) => {
  await stubWarData(page);
  await page.goto(`${log}?battleWar=${archive}&battleResult=win`);

  const win = page.locator('[data-result="win"]');
  const loss = page.locator('[data-result="loss"]');
  await expect(page.locator('#battle-filter-summary')).toContainText('Showing');
  await expect(page.locator('#battle-filter-war')).toHaveValue(archive);
  await expect(win).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await expect(win).toHaveAttribute('aria-checked', 'true');
  await loss.click();
  await expect(page).toHaveURL(/battleResult=loss/);
  await page.goBack();
  await expect(win).toHaveAttribute('aria-checked', 'true');
  await page.goForward();
  await expect(loss).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('link', { name: 'Seasons' }).click();
  await expect(page).toHaveURL(/\/guild-wars\.html/);
  await expect(page.locator('#war-top-panel-log')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/guild-wars-battle-log\.html.*battleResult=loss/);
});

test('leaves a missing archive in the URL and reports that it is unavailable', async ({ page }) => {
  await stubWarData(page);
  await page.goto(`${log}?battleWar=missing`);
  await expect(page.getByRole('status')).toHaveText('The requested war is unavailable.');
  await expect(page).toHaveURL(/battleWar=missing/);
});

test('generated documents load and their local page links resolve', async ({ browser, request }) => {
  const page = await browser.newPage({ javaScriptEnabled: false });
  const urls = new Set(['/index.html', '/guild-wars.html', log, '/guild-raid.html', '/guild-teams.html', '/player-page.html', '/report-cards.html']);
  for (const url of urls) {
    expect((await page.goto(url)).ok(), url).toBe(true);
    const links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(anchor => anchor.href));
    for (const link of links) {
      const target = new URL(link);
      if (target.origin === new URL(page.url()).origin && target.pathname.endsWith('.html')) {
        urls.add(target.pathname);
      }
    }
  }
  expect((await request.get('/data/war/current.json')).ok()).toBe(true);
  await page.close();
});

test('Battle Log stays within its first-party compressed payload budget', () => {
  const output = join(__dirname, '../../dist/site');
  const files = [
    log.slice(1), 'src/mobile-responsive.css', 'src/numeric-font.js', 'src/navigation.js',
    'src/consts/tile-scores.js', 'src/consts/score-splitter.js', 'src/lib/supabase-config.js',
    'src/lib/supabase-data.js', 'src/app.js', 'data/static/portrait-map.json',
    'data/static/unitid-missing-portrait-map.json', 'data/static/image-manifest.json',
  ];
  const bytes = [...files.map(file => join(output, file)), fixture]
    .reduce((total, file) => total + gzipSync(readFileSync(file)).length, 0);
  expect(bytes, 'first-party HTML, CSS, JS, and representative data (gzip bytes)').toBeLessThanOrEqual(170 * 1024);
});

test('reports a catalog failure without pretending the archive is missing', async ({ page }) => {
  await stubWarData(page);
  await page.route('**/src/lib/supabase-data.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.supabaseData = { listArchivedWars: async () => { throw new Error("Catalog unavailable"); } };',
  }));
  await page.goto(`${log}?battleWar=${archive}`);
  await expect(page.getByRole('status')).toHaveText('Could not load the battle log. Reload to try again.');
});

test('shows an empty result when the archive loads but contains no battles', async ({ page }) => {
  await stubWarData(page);
  await page.route('**/war-fixture.json', route => route.fulfill({ json: {} }));
  await page.goto(`${log}?battleWar=${archive}`);
  await expect(page.getByRole('status')).toHaveText('Showing 0 logs');
  await expect(page).toHaveURL(new RegExp(`battleWar=${archive}`));
});