begin;

alter table public.war_guilds
  add column name text,
  add column icon text,
  add column status text;

alter table public.war_participants
  add column display_name text,
  add column avatar_unit_id text,
  add column avatar_frame_id text,
  add column title text,
  add column title_gender integer;

alter table public.war_battles
  add column source_user_id text,
  add column attacking_side integer,
  add column zone_id text,
  add column zone_type text,
  add column zone_visual_id text,
  add column attempt_debuff integer,
  add column attacker_user_id text,
  add column attacker_power bigint,
  add column attacker_mow_unit_id text,
  add column attacker_mow_progression_index integer,
  add column defender_user_id text,
  add column defender_power bigint,
  add column defender_mow_unit_id text,
  add column defender_mow_progression_index integer;

create table public.war_battle_units (
  battle_id text not null references public.war_battles (source_battle_id) on delete cascade,
  attacking boolean not null,
  slot integer not null,
  unit_id text not null,
  progression_index integer,
  rank integer,
  start_hp_before integer,
  remaining_hp_before integer,
  start_hp_after integer,
  remaining_hp_after integer,
  primary key (battle_id, attacking, slot)
);

create table public.war_battle_buffs (
  battle_id text not null references public.war_battles (source_battle_id) on delete cascade,
  slot integer not null,
  ability_id text not null,
  scope text,
  primary key (battle_id, slot)
);

alter table public.war_battle_units enable row level security;
alter table public.war_battle_buffs enable row level security;
create policy "war battle units are publicly readable" on public.war_battle_units for select using (true);
create policy "war battle buffs are publicly readable" on public.war_battle_buffs for select using (true);
grant select on public.war_battle_units, public.war_battle_buffs to anon, authenticated;
grant select, insert on public.war_battle_units, public.war_battle_buffs to service_role;

create function public.insert_war_battle_details(battle_id text, battle jsonb) returns void
language sql set search_path = ''
as $$
  insert into public.war_battle_units (battle_id, attacking, slot, unit_id, progression_index,
    rank, start_hp_before, remaining_hp_before, start_hp_after, remaining_hp_after)
  select $1, side.attacking, unit.slot, unit.value->>'unitId', (unit.value->>'progressionIndex')::integer,
    (unit.value->>'rank')::integer, (unit.value->>'startHPBefore')::integer,
    (unit.value->>'remainingHPBefore')::integer, (unit.value->>'startHPAfter')::integer,
    (unit.value->>'remainingHPAfter')::integer
  from (values (true, battle->'attacker'->'units'), (false, battle->'defender'->'units')) side(attacking, units)
  cross join lateral pg_catalog.jsonb_array_elements(nullif(side.units, 'null'::jsonb)) with ordinality unit(value, slot);

  insert into public.war_battle_buffs (battle_id, slot, ability_id, scope)
  select $1, buff.slot, buff.value->>'abilityId', buff.value->>'scope'
  from pg_catalog.jsonb_array_elements(nullif(battle->'buffs', 'null'::jsonb)) with ordinality buff(value, slot);
$$;

revoke execute on function public.insert_war_battle_details(text, jsonb) from public, anon, authenticated;
grant execute on function public.insert_war_battle_details(text, jsonb) to service_role;

create function public.war_battle_fields(battle jsonb, out source_user_id text, out attacking_side integer,
  out zone_id text, out zone_type text, out zone_visual_id text, out attempt_debuff integer,
  out attacker_user_id text, out attacker_power bigint, out attacker_mow_unit_id text,
  out attacker_mow_progression_index integer, out defender_user_id text, out defender_power bigint,
  out defender_mow_unit_id text, out defender_mow_progression_index integer)
language sql immutable set search_path = ''
as $$
  select battle->>'userId', (battle->>'teamIndex')::integer,
    battle#>>'{zone,id}', battle#>>'{zone,type}', battle#>>'{zone,visualId}', (battle->>'attemptDebuff')::integer,
    battle#>>'{attacker,userId}', (battle#>>'{attacker,lineupPower}')::bigint,
    battle#>>'{attacker,machineOfWar,unitId}', (battle#>>'{attacker,machineOfWar,progressionIndex}')::integer,
    battle#>>'{defender,userId}', (battle#>>'{defender,lineupPower}')::bigint,
    battle#>>'{defender,machineOfWar,unitId}', (battle#>>'{defender,machineOfWar,progressionIndex}')::integer;
$$;

revoke execute on function public.war_battle_fields(jsonb) from public, anon, authenticated;
grant execute on function public.war_battle_fields(jsonb) to service_role;

update public.war_guilds set name = snapshot->>'name', icon = snapshot->>'guildIcon', status = snapshot->>'guildStatus';
update public.war_participants set display_name = profile->>'displayName', avatar_unit_id = profile->>'avatarUnitId',
  avatar_frame_id = profile->>'avatarFrameId', title = profile->>'title', title_gender = (profile->>'titleGender')::integer;

update public.war_battles as battle set
  (source_user_id, attacking_side, zone_id, zone_type, zone_visual_id, attempt_debuff,
   attacker_user_id, attacker_power, attacker_mow_unit_id, attacker_mow_progression_index,
   defender_user_id, defender_power, defender_mow_unit_id, defender_mow_progression_index) =
  (select * from public.war_battle_fields(battle.log));

do $$
begin
  perform public.insert_war_battle_details(source_battle_id, log) from public.war_battles;
end;
$$;

create or replace function public.import_war_archive(
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
  insert into public.war_guilds (war_id, guild_id, side, name, icon, status)
    select imported_war_id, guild_id, side, snapshot->>'name', snapshot->>'guildIcon', snapshot->>'guildStatus'
    from pg_catalog.jsonb_to_recordset(guild_rows) as entry(guild_id uuid, side integer, snapshot jsonb);

  insert into public.players (id, name, avatar_unit_id, avatar_frame_id)
    select player_id, coalesce(profile->>'displayName', ''), coalesce(profile->>'avatarUnitId', ''),
      coalesce(profile->>'avatarFrameId', '')
    from pg_catalog.jsonb_to_recordset(participant_rows) as entry(player_id uuid, profile jsonb)
    on conflict (id) do nothing;
  insert into public.war_participants (war_id, player_id, guild_id, display_name, avatar_unit_id, avatar_frame_id,
    title, title_gender)
    select imported_war_id, player_id, guild_id, profile->>'displayName', profile->>'avatarUnitId',
      profile->>'avatarFrameId', profile->>'title', (profile->>'titleGender')::integer
    from pg_catalog.jsonb_to_recordset(participant_rows) as entry(player_id uuid, guild_id uuid, profile jsonb);

  insert into public.war_battles (source_battle_id, war_id, attacker_guild_id, defender_guild_id,
    attacker_id, defender_id, fought_at, score, abandoned, source_user_id, attacking_side, zone_id, zone_type,
    zone_visual_id, attempt_debuff, attacker_user_id, attacker_power, attacker_mow_unit_id,
    attacker_mow_progression_index, defender_user_id, defender_power, defender_mow_unit_id, defender_mow_progression_index)
    select source_battle_id, imported_war_id, attacker_guild_id, defender_guild_id,
      attacker_id, defender_id, fought_at, score, abandoned, fields.*
    from pg_catalog.jsonb_to_recordset(battle_rows) as entry(source_battle_id text, attacker_guild_id uuid,
      defender_guild_id uuid, attacker_id uuid, defender_id uuid, fought_at timestamptz, score integer,
      abandoned boolean, log jsonb)
    cross join lateral public.war_battle_fields(entry.log) fields;

  perform public.insert_war_battle_details(source_battle_id, log)
    from pg_catalog.jsonb_to_recordset(battle_rows) as entry(source_battle_id text, log jsonb);
  return imported_war_id;
end;
$$;

alter table public.war_guilds drop column snapshot;
alter table public.war_participants drop column profile;
alter table public.war_battles drop column log, alter column attacking_side set not null;

commit;