const { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const output = join(root, 'dist', 'site');
const template = readFileSync(join(root, 'guild-wars.html'), 'utf8');

function replaceSection(html, name, replacement) {
  const section = new RegExp(`(?:<!--|/\\*) ${name}:start (?:-->|\\*/)[\\s\\S]*?(?:<!--|/\\*) ${name}:end (?:-->|\\*/)`);
  if (!section.test(html)) throw new Error(`Missing War template section: ${name}`);
  return html.replace(section, replacement);
}

function renderWarPage(view) {
  const isLog = view === 'log';
  const link = (id, href, label, active) => `<a id="${id}" href="${href}"${active ? ' aria-current="page"' : ''} class="rounded-t-lg border-b-2 ${active ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400'} px-5 py-3 text-sm font-semibold hover:text-slate-100">${label}</a>`;
  const navigation = `<nav class="top-tab-strip flex flex-wrap gap-2 border-b border-slate-700" aria-label="Guild War views">
        ${link('war-top-tab-season', 'guild-wars.html', 'Seasons', !isLog)}
        ${link('war-top-tab-log', 'guild-wars-battle-log.html', 'Battle Log', isLog)}
      </nav>`;
  let html = replaceSection(template, 'war-view-navigation', navigation);
  html = replaceSection(html, 'war-view-switch', '');
  html = replaceSection(html, isLog ? 'war-season' : 'war-log', '');
  html = html.replace("const topView = params.get('warView') === 'log' ? 'log' : 'season';", `const topView = '${view}';`);
  if (isLog) {
    html = html.replace(/<body\b([^>]*)>/, '<body$1 data-page="battle-log">')
      .replace('id="war-top-panel-log" class="hidden"', 'id="war-top-panel-log"')
      .replace('>Guild Wars</h2>', '>Battle Log</h2>')
      .replace('>Showing 0 logs</p>', ' role="status">Loading battle log...</p>');
  }
  return html.replace(/<!-- war-(?:season|log):(?:start|end) -->/g, '');
}

const season = renderWarPage('season');
const log = renderWarPage('log');
const currentWar = 'data/war/current.json';
const dataFolders = ['data/static', 'data/raid'];
const publishedJson = dataFolders.flatMap(folder => readdirSync(join(root, folder))
  .filter(file => file.endsWith('.json')).map(file => join(folder, file)));
for (const path of [currentWar, ...publishedJson]) {
  try {
    JSON.parse(readFileSync(join(root, path), 'utf8'));
  } catch (error) {
    throw new Error(`Invalid published JSON: ${path}`, { cause: error });
  }
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const path of ['index.html', 'guild-raid.html', 'guild-teams.html', 'player-page.html', 'report-cards.html', 'src', 'img', 'img-temp', ...dataFolders, currentWar]) {
  cpSync(join(root, path), join(output, path), { recursive: true });
}
writeFileSync(join(output, 'guild-wars.html'), season);
writeFileSync(join(output, 'guild-wars-battle-log.html'), log);