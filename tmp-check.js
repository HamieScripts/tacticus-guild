const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('./src/app.js', 'utf8');
const context = {
  console,
  window: { location: { search: '', pathname: '/', hash: '' }, history: { replaceState() {} } },
  document: { body: { dataset: {} }, getElementById() { return null; }, addEventListener() {}, querySelector() { return null; } },
  fetch: async () => ({ ok: false }),
  URLSearchParams,
  Intl,
  Map,
  Set,
  Date,
  Number,
  String,
  Object,
  Array,
  Math,
  globalThis: null
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(code, context);
const data = JSON.parse(fs.readFileSync('./data/current/live-war.json', 'utf8'));
const snapshots = context.buildSnapshot(data);
let easyCount = 0;
for (const s of snapshots) {
  for (const p of s.players || []) {
    for (const t of p.tokens || []) {
      if (t && t.easyGame) {
        easyCount += 1;
        console.log('easy token:', p.name, t.score, t.hasScore, t.easyGame);
      }
    }
  }
}
console.log('total easy tokens:', easyCount);
console.log('snapshots:', snapshots.length);
