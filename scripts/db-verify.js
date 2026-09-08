// One-off verification of the imported data against the new schema.
const { createClient } = require('@supabase/supabase-js');
const { readEnvValue, createAdminClient } = require('./lib/supabase-admin');

async function main() {
  const admin = createAdminClient();
  if (!admin) { process.exitCode = 1; return; }

  // 1. Row counts
  for (const table of ['players', 'raid_seasons', 'raid_entries']) {
    const { count, error } = await admin.from(table).select('*', { head: true, count: 'exact' });
    console.log(`${table}: ${error ? 'ERROR ' + error.message : count + ' rows'}`);
  }

  // 2. Season 108 summary columns vs manifest expectations (1063 entries / 35 players / 184.6M damage)
  const { data: s108, error: s108Error } = await admin
    .from('raid_seasons')
    .select('season, guild_id, entries, players, damage')
    .eq('season', 108)
    .single();
  console.log('season 108 summary:', s108Error ? 'ERROR ' + s108Error.message : JSON.stringify(s108));

  // 3. Lineup flattening spot check on one entry
  const { data: entry, error: entryError } = await admin
    .from('raid_entries')
    .select('season, boss_type, unit_id_1, unit_1_power, unit_id_5, unit_5_power, mow_unit_id, guild_id, user_id, user_id_text')
    .eq('season', 108)
    .limit(1)
    .single();
  console.log('sample entry:', entryError ? 'ERROR ' + entryError.message : JSON.stringify(entry));

  // 4. FK linkage: how many entries have user_id set vs only user_id_text
  const { count: linked } = await admin
    .from('raid_entries')
    .select('*', { head: true, count: 'exact' })
    .not('user_id', 'is', null);
  console.log(`entries with linked player FK: ${linked}`);

  // 5. Anon key read access (RLS check)
  const anon = createClient(readEnvValue('SUPABASE_URL'), readEnvValue('SUPABASE_ANON_KEY'));
  const { count: anonCount, error: anonError } = await anon
    .from('raid_entries')
    .select('*', { head: true, count: 'exact' });
  console.log('anon read:', anonError ? 'DENIED ' + anonError.message : `ok, sees ${anonCount} entries`);

  const { error: anonWriteError } = await anon
    .from('raid_entries')
    .insert({ season: 999, guild_id: 'TEST' });
  console.log('anon write:', anonWriteError ? 'correctly denied (' + anonWriteError.code + ')' : 'NOT DENIED — PROBLEM');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
