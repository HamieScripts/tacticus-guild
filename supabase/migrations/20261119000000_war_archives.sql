create table public.guilds (
  id uuid primary key,
  name text not null
);

create table public.wars (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  ended_at timestamptz not null
);

create table public.war_archives (
  event_id uuid primary key,
  archive_key text not null unique,
  war_id uuid not null references public.wars (id)
);

create table public.war_guilds (
  war_id uuid not null references public.wars (id),
  guild_id uuid not null references public.guilds (id),
  side integer not null,
  snapshot jsonb not null,
  primary key (war_id, guild_id),
  unique (war_id, side)
);

create table public.war_participants (
  war_id uuid not null references public.wars (id),
  player_id uuid not null references public.players (id),
  guild_id uuid,
  profile jsonb not null,
  primary key (war_id, player_id),
  foreign key (war_id, guild_id) references public.war_guilds (war_id, guild_id)
);

create table public.war_battles (
  source_battle_id text primary key,
  war_id uuid not null references public.wars (id),
  attacker_guild_id uuid not null,
  defender_guild_id uuid not null,
  attacker_id uuid,
  defender_id uuid,
  fought_at timestamptz not null,
  score integer,
  abandoned boolean not null,
  log jsonb not null,
  foreign key (war_id, attacker_guild_id) references public.war_guilds (war_id, guild_id),
  foreign key (war_id, defender_guild_id) references public.war_guilds (war_id, guild_id),
  foreign key (war_id, attacker_id) references public.war_participants (war_id, player_id),
  foreign key (war_id, defender_id) references public.war_participants (war_id, player_id),
  check (attacker_guild_id <> defender_guild_id)
);

create index war_archives_war_idx on public.war_archives (war_id);
create index war_guilds_guild_idx on public.war_guilds (guild_id, war_id);
create index war_participants_player_idx on public.war_participants (player_id, war_id);
create index war_battles_war_idx on public.war_battles (war_id, fought_at, source_battle_id);
create index war_battles_attacker_guild_idx on public.war_battles (attacker_guild_id, fought_at);
create index war_battles_defender_guild_idx on public.war_battles (defender_guild_id, fought_at);
create index war_battles_attacker_idx on public.war_battles (attacker_id, fought_at);
create index war_battles_defender_idx on public.war_battles (defender_id, fought_at);

alter table public.guilds enable row level security;
alter table public.wars enable row level security;
alter table public.war_archives enable row level security;
alter table public.war_guilds enable row level security;
alter table public.war_participants enable row level security;
alter table public.war_battles enable row level security;

create policy "guilds are publicly readable" on public.guilds for select using (true);
create policy "wars are publicly readable" on public.wars for select using (true);
create policy "war archives are publicly readable" on public.war_archives for select using (true);
create policy "war guilds are publicly readable" on public.war_guilds for select using (true);
create policy "war participants are publicly readable" on public.war_participants for select using (true);
create policy "war battles are publicly readable" on public.war_battles for select using (true);

grant select on public.guilds, public.wars, public.war_archives, public.war_guilds,
  public.war_participants, public.war_battles to anon, authenticated;
grant select, insert on public.guilds, public.wars, public.war_archives, public.war_guilds,
  public.war_participants, public.war_battles to service_role;

create function public.import_war_archive(
  archive_event_id uuid, source_key text, first_battle timestamptz, last_battle timestamptz,
  guild_rows jsonb, participant_rows jsonb, battle_rows jsonb
) returns uuid
language plpgsql set search_path = ''
as $$
declare
  imported_war_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(194813, 1);
  select war_id into imported_war_id from public.war_archives where event_id = archive_event_id;
  if found then
    return imported_war_id;
  end if;

  if exists (
    select 1 from public.war_battles existing
    join pg_catalog.jsonb_to_recordset(battle_rows) incoming(source_battle_id text) using (source_battle_id)
  ) then
    raise exception 'Archive % shares battles with an existing war; review before linking', archive_event_id;
  end if;

  insert into public.wars (started_at, ended_at) values (first_battle, last_battle)
    returning id into imported_war_id;
  insert into public.war_archives (event_id, archive_key, war_id)
    values (archive_event_id, source_key, imported_war_id);

  insert into public.guilds (id, name)
    select guild_id, coalesce(snapshot->>'name', '')
    from pg_catalog.jsonb_to_recordset(guild_rows) as entry(guild_id uuid, snapshot jsonb)
    on conflict (id) do nothing;
  insert into public.war_guilds (war_id, guild_id, side, snapshot)
    select imported_war_id, guild_id, side, snapshot
    from pg_catalog.jsonb_to_recordset(guild_rows) as entry(guild_id uuid, side integer, snapshot jsonb);

  insert into public.players (id, name, avatar_unit_id, avatar_frame_id)
    select player_id, coalesce(profile->>'displayName', ''), coalesce(profile->>'avatarUnitId', ''),
      coalesce(profile->>'avatarFrameId', '')
    from pg_catalog.jsonb_to_recordset(participant_rows) as entry(player_id uuid, profile jsonb)
    on conflict (id) do nothing;
  insert into public.war_participants (war_id, player_id, guild_id, profile)
    select imported_war_id, player_id, guild_id, profile
    from pg_catalog.jsonb_to_recordset(participant_rows) as entry(player_id uuid, guild_id uuid, profile jsonb);

  insert into public.war_battles (source_battle_id, war_id, attacker_guild_id, defender_guild_id,
    attacker_id, defender_id, fought_at, score, abandoned, log)
    select source_battle_id, imported_war_id, attacker_guild_id, defender_guild_id,
      attacker_id, defender_id, fought_at, score, abandoned, log
    from pg_catalog.jsonb_to_recordset(battle_rows) as entry(source_battle_id text, attacker_guild_id uuid,
      defender_guild_id uuid, attacker_id uuid, defender_id uuid, fought_at timestamptz, score integer,
      abandoned boolean, log jsonb);
  return imported_war_id;
end;
$$;

revoke execute on function public.import_war_archive(uuid, text, timestamptz, timestamptz, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_war_archive(uuid, text, timestamptz, timestamptz, jsonb, jsonb, jsonb)
  to service_role;