const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_FILE = path.join(__dirname, '..', '.env.local');
const KEY_NAME = 'GUILD_RAID_API_KEY';

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function upsertKey(contents, value) {
  const lines = contents.split(/\r?\n/).filter((line) => line.trim() !== '');
  const index = lines.findIndex((line) => line.trim().startsWith(`${KEY_NAME}=`));
  const entry = `${KEY_NAME}=${value}`;

  if (index >= 0) {
    lines[index] = entry;
  } else {
    lines.push(entry);
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  console.log('Paste the Tacticus API key with the "Guild Raid" scope.');
  console.log('It is stored in .env.local, which is git-ignored.\n');

  const apiKey = await prompt('GUILD_RAID_API_KEY: ');

  if (!apiKey) {
    console.error('No key entered, nothing was written.');
    process.exitCode = 1;
    return;
  }

  const existing = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  fs.writeFileSync(ENV_FILE, upsertKey(existing, apiKey), 'utf8');

  console.log('\nSaved to .env.local. Now run: npm run fetch:raid');
}

main();
