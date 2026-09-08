const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.join(__dirname, '..', '..');
const ENV_FILE = path.join(ROOT, '.env.local');

// Minimal .env.local reader (same KEY=value format the other scripts use).
// Returns '' for missing values so callers can decide how to fail.
function readEnvValue(name) {
  const fromEnv = String(process.env[name] || '').trim();
  if (fromEnv) return fromEnv;

  if (!fs.existsSync(ENV_FILE)) return '';

  const line = fs.readFileSync(ENV_FILE, 'utf8')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));

  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
}

// Creates a service-role client for local scripts. Never use this in browser code.
// Returns null (and warns) when the env vars are missing so callers can decide
// whether the DB step is optional.
function createAdminClient({ optional = false } = {}) {
  const url = readEnvValue('SUPABASE_URL');
  const key = readEnvValue('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !key) {
    const message = 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local';
    if (optional) {
      console.warn(`${message} — skipping database write.`);
      return null;
    }
    console.error(message);
    return null;
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

module.exports = { readEnvValue, createAdminClient };
