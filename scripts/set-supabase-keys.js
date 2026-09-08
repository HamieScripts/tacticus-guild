// Interactive CLI to store Supabase credentials in .env.local (git-ignored),
// mirroring scripts/set-guild-raid-key.js.
//
// Find the values in the Supabase dashboard under Project Settings -> API:
//   Project URL        -> SUPABASE_URL
//   anon public key    -> SUPABASE_ANON_KEY
//   service_role key   -> SUPABASE_SERVICE_ROLE_KEY  (secret, never ship it)

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_FILE = path.join(__dirname, '..', '.env.local');
const KEY_NAMES = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function upsertKeys(contents, values) {
  const lines = contents.split(/\r?\n/).filter((line) => line.trim() !== '');

  for (const [name, value] of Object.entries(values)) {
    if (!value) continue;

    const index = lines.findIndex((line) => line.trim().startsWith(`${name}=`));
    const entry = `${name}=${value}`;

    if (index >= 0) {
      lines[index] = entry;
    } else {
      lines.push(entry);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  console.log('Paste the Supabase credentials from Project Settings -> API.');
  console.log('They are stored in .env.local, which is git-ignored.');
  console.log('Leave a value blank to keep the existing one.\n');

  const values = {};
  for (const name of KEY_NAMES) {
    values[name] = await prompt(`${name}: `);
  }

  if (Object.values(values).every((value) => !value)) {
    console.error('Nothing entered, nothing was written.');
    process.exitCode = 1;
    return;
  }

  const existing = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  fs.writeFileSync(ENV_FILE, upsertKeys(existing, values), 'utf8');

  console.log('\nSaved to .env.local. Now run: npm run db:import');
}

main();
