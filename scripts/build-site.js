const { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { dirname, extname, join, relative } = require('node:path');
const { gzipSync } = require('node:zlib');
const CleanCSS = require('clean-css');
const { minify: minifyHtml } = require('html-minifier-terser');
const postcss = require('postcss');
const tailwindcss = require('@tailwindcss/postcss');
const { minify: minifyJs } = require('terser');

const root = join(__dirname, '..');
const output = join(root, 'dist', 'site');
const template = readFileSync(join(root, 'guild-wars.html'), 'utf8');
const tailwindStylesheet = 'src/tailwind.css';
const supabaseCdn = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
const supabaseBundle = 'src/vendor/supabase.min.js';

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
const supabasePackage = dirname(require.resolve('@supabase/supabase-js/package.json'));
mkdirSync(dirname(join(output, supabaseBundle)), { recursive: true });
cpSync(join(supabasePackage, 'dist', 'umd', 'supabase.js'), join(output, supabaseBundle));
cpSync(join(supabasePackage, 'LICENSE'), join(dirname(join(output, supabaseBundle)), 'supabase.LICENSE'));

const jsOptions = { toplevel: false, mangle: { toplevel: false } };
const optimizers = new Map([
  ['.html', source => minifyHtml(source.replace(supabaseCdn, supabaseBundle), {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: jsOptions,
  })],
  ['.js', async source => (await minifyJs(source, jsOptions)).code],
  ['.css', source => {
    const result = new CleanCSS().minify(source);
    if (result.errors.length) throw new Error(result.errors.join('\n'));
    return result.styles;
  }],
  ['.json', source => JSON.stringify(JSON.parse(source))],
]);

function* siteFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* siteFiles(path);
    else if (entry.isFile()) yield path;
  }
}

async function optimizeSite() {
  const sizes = new Map();
  let unchangedBytes = 0;
  for (const path of siteFiles(output)) {
    const extension = extname(path);
    const optimize = optimizers.get(extension);
    if (!optimize || path === join(output, tailwindStylesheet) || path === join(output, supabaseBundle)) {
      unchangedBytes += statSync(path).size;
      continue;
    }

    const original = readFileSync(path);
    try {
      const optimized = Buffer.from(await optimize(original.toString('utf8')));
      writeFileSync(path, optimized);
      const size = sizes.get(extension) || { before: 0, after: 0, gzipBefore: 0, gzipAfter: 0 };
      size.before += original.length;
      size.after += optimized.length;
      size.gzipBefore += gzipSync(original).length;
      size.gzipAfter += gzipSync(optimized).length;
      sizes.set(extension, size);
    } catch (error) {
      throw new Error(`Could not optimize ${relative(output, path)}`, { cause: error });
    }
  }

  const files = [...sizes.values()];
  for (const [extension, size] of sizes) {
    console.log(`${extension}: ${size.before} -> ${size.after} bytes (${size.gzipBefore} -> ${size.gzipAfter} bytes gzipped)`);
  }
  const totalBefore = files.reduce((total, size) => total + size.before, unchangedBytes);
  const totalAfter = files.reduce((total, size) => total + size.after, unchangedBytes);
  console.log(`Site total: ${totalBefore} -> ${totalAfter} bytes (including unchanged assets)`);
}

async function buildStyles() {
  const { css } = await postcss([tailwindcss({ base: output, optimize: true })]).process(`
    @import "tailwindcss" source(none);
    @import "./src/mobile-responsive.css";
    @source "./*.html";
    @source "./src/**/*.js";
  `, { from: join(output, 'tailwind.input.css') });
  writeFileSync(join(root, tailwindStylesheet), css);
  writeFileSync(join(output, tailwindStylesheet), css);
  rmSync(join(output, 'src', 'mobile-responsive.css'));
}

buildStyles().then(optimizeSite).catch(error => {
  console.error(error);
  process.exitCode = 1;
});