begin;

select pg_catalog.pg_advisory_xact_lock(194813, 1);

alter table public.war_battle_units add constraint war_battle_units_slot_nonnegative check (slot >= 0);

insert into public.war_battle_units (battle_id, attacking, slot, unit_id, progression_index)
select battle.source_battle_id, machine.attacking, 0, machine.unit_id, machine.progression_index
from public.war_battles battle
cross join lateral (values
  (true, battle.attacker_mow_unit_id, battle.attacker_mow_progression_index),
  (false, battle.defender_mow_unit_id, battle.defender_mow_progression_index)
) machine(attacking, unit_id, progression_index)
where machine.unit_id is not null;

create or replace function public.insert_war_battle_details(battle_id text, battle jsonb) returns void
language sql set search_path = ''
as $$
  insert into public.war_battle_units (battle_id, attacking, slot, unit_id, progression_index,
    rank, start_hp_before, remaining_hp_before, start_hp_after, remaining_hp_after)
  select $1, side.attacking, unit.slot, unit.value->>'unitId', (unit.value->>'progressionIndex')::integer,
    (unit.value->>'rank')::integer, (unit.value->>'startHPBefore')::integer,
    (unit.value->>'remainingHPBefore')::integer, (unit.value->>'startHPAfter')::integer,
    (unit.value->>'remainingHPAfter')::integer
  from (values (true, battle->'attacker'), (false, battle->'defender')) side(attacking, lineup)
  cross join lateral (
    select hero.value, hero.slot
    from pg_catalog.jsonb_array_elements(nullif(side.lineup->'units', 'null'::jsonb)) with ordinality hero(value, slot)
    union all
    select side.lineup->'machineOfWar', 0 where side.lineup->'machineOfWar'->>'unitId' is not null
  ) unit;

  insert into public.war_battle_buffs (battle_id, slot, ability_id, scope)
  select $1, buff.slot, buff.value->>'abilityId', buff.value->>'scope'
  from pg_catalog.jsonb_array_elements(nullif(battle->'buffs', 'null'::jsonb)) with ordinality buff(value, slot);
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
    zone_visual_id, attempt_debuff, attacker_user_id, attacker_power, defender_user_id, defender_power)
    select source_battle_id, imported_war_id, attacker_guild_id, defender_guild_id,
      attacker_id, defender_id, fought_at, score, abandoned, log->>'userId', (log->>'teamIndex')::integer,
      log#>>'{zone,id}', log#>>'{zone,type}', log#>>'{zone,visualId}', (log->>'attemptDebuff')::integer,
      log#>>'{attacker,userId}', (log#>>'{attacker,lineupPower}')::bigint,
      log#>>'{defender,userId}', (log#>>'{defender,lineupPower}')::bigint
    from pg_catalog.jsonb_to_recordset(battle_rows) as entry(source_battle_id text, attacker_guild_id uuid,
      defender_guild_id uuid, attacker_id uuid, defender_id uuid, fought_at timestamptz, score integer,
      abandoned boolean, log jsonb);

  perform public.insert_war_battle_details(source_battle_id, log)
    from pg_catalog.jsonb_to_recordset(battle_rows) as entry(source_battle_id text, log jsonb);
  return imported_war_id;
end;
$$;

drop function public.war_battle_fields(jsonb);

alter table public.war_battles
  drop column attacker_mow_unit_id,
  drop column attacker_mow_progression_index,
  drop column defender_mow_unit_id,
  drop column defender_mow_progression_index;

commit;