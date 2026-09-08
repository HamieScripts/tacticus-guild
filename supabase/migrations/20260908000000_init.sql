-- Initial schema: players directory + guild raid data
-- Source of truth going forward; JSON files under data/ become optional exports.

-- ---------------------------------------------------------------------------
-- players: guild member directory (built from war data via generate:players)
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  id uuid primary key,
  name text not null default '',
  avatar_unit_id text not null default '',
  avatar_frame_id text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- raid_seasons: one row per guild raid season. The entries/players/damage/
-- start/end columns are summary fields maintained by the import script and
-- mirror data/raid/manifest.json.
-- ---------------------------------------------------------------------------
create table if not exists public.raid_seasons (
  season integer primary key,
  guild_id text not null default '',
  season_config_id text,
  guild_name text not null default '',
  guild_tag text not null default '',
  guild_level integer,
  fetched_on timestamptz,
  entries integer not null default 0,
  players integer not null default 0,
  damage bigint not null default 0,
  start timestamptz,
  "end" timestamptz
);

-- ---------------------------------------------------------------------------
-- raid_entries: one row per boss attack, with the full lineup flattened onto
-- the row (heroDetails + machineOfWarDetails). `set` is a reserved word ->
-- set_index. Unix seconds -> timestamptz.
-- guild_id scopes the row to a guild (its tag) so other guilds can be added
-- later. Historical raids can reference players no longer in the directory,
-- so the raw id is always kept in user_id_text and the FK is nullable.
-- ---------------------------------------------------------------------------
create table if not exists public.raid_entries (
  id bigint generated always as identity primary key,
  guild_id text not null default '',
  season integer not null references public.raid_seasons (season) on delete cascade,
  user_id uuid references public.players (id) on delete set null,
  user_id_text text,
  tier integer not null default 0,
  set_index integer not null default 0,
  encounter_index integer not null default 0,
  encounter_type text not null default '',
  boss_unit_id text not null default '',
  boss_type text not null default '',
  rarity text not null default '',
  damage_dealt bigint not null default 0,
  damage_type text not null default '',
  remaining_hp bigint not null default 0,
  max_hp bigint not null default 0,
  started_on timestamptz,
  completed_on timestamptz,
  unit_id_1 text, unit_1_power integer,
  unit_id_2 text, unit_2_power integer,
  unit_id_3 text, unit_3_power integer,
  unit_id_4 text, unit_4_power integer,
  unit_id_5 text, unit_5_power integer,
  mow_unit_id text,
  mow_power integer,
  -- Safety net: every attack so far uses 5 hero slots, but if the game ever
  -- sends more, the overflow lands here instead of being dropped.
  extra_unit_ids text[],
  extra_unit_powers integer[]
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists raid_entries_guild_id_idx on public.raid_entries (guild_id);
create index if not exists raid_entries_season_idx on public.raid_entries (season);
create index if not exists raid_entries_user_id_idx on public.raid_entries (user_id);
create index if not exists raid_entries_user_id_text_idx on public.raid_entries (user_id_text);
create index if not exists raid_entries_boss_type_idx on public.raid_entries (boss_type);

-- ---------------------------------------------------------------------------
-- Row-level security: public read-only access via the anon key.
-- No write policies: the service role bypasses RLS, so scripts can write
-- while browsers/anon clients can only read.
-- ---------------------------------------------------------------------------
alter table public.players enable row level security;
alter table public.raid_seasons enable row level security;
alter table public.raid_entries enable row level security;

-- Drop-then-create so the migration can be rerun cleanly.
drop policy if exists "players are readable by everyone" on public.players;
drop policy if exists "raid seasons are readable by everyone" on public.raid_seasons;
drop policy if exists "raid entries are readable by everyone" on public.raid_entries;

create policy "players are readable by everyone"
  on public.players for select
  using (true);

create policy "raid seasons are readable by everyone"
  on public.raid_seasons for select
  using (true);

create policy "raid entries are readable by everyone"
  on public.raid_entries for select
  using (true);
