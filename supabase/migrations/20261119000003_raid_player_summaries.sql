create view public.raid_player_summaries
with (security_invoker = true) as
select
  seasons.season,
  identity.player_id,
  coalesce(seasons."end", seasons.start) as season_time,
  sum(entries.damage_dealt) as total_damage,
  coalesce(sum(entries.damage_dealt) filter (where entries.damage_type <> 'Bomb'), 0) as battle_damage,
  count(*) filter (where entries.damage_type <> 'Bomb') as tokens
from public.raid_seasons seasons
join public.raid_entries entries
  on entries.season = seasons.season and entries.guild_id = seasons.guild_id
cross join lateral (values (nullif(btrim(coalesce(entries.user_id::text, entries.user_id_text)), ''))) identity(player_id)
where identity.player_id is not null
group by seasons.season, identity.player_id, seasons."end", seasons.start;

grant select on public.raid_player_summaries to anon, authenticated;