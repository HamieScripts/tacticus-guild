const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function playerId(value) {
  return typeof value === 'string' && UUID.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)
    ? value : null;
}

function parseWarArchive(payload) {
  const results = payload?.eventResults;
  if (results?.length !== 1 || results[0].eventResultType !== 'SUCCESS' || !UUID.test(results[0].eventId)) {
    throw new Error('Expected one successful event with an archive event ID');
  }
  const { eventId, eventResponseData: data } = results[0];
  const guilds = data?.guildData;
  if (guilds?.length !== 2 || new Set(guilds.map(guild => guild.teamIndex)).size !== 2
      || new Set(guilds.map(guild => guild.guildId)).size !== 2
      || guilds.some(guild => !playerId(guild.guildId) || !Number.isInteger(guild.teamIndex))
      || !Array.isArray(data.playerData) || !Array.isArray(data.activityLogs)) {
    throw new Error('Expected two distinct guilds, a roster, and activity logs');
  }

  const guildBySide = new Map(guilds.map(guild => [guild.teamIndex, guild.guildId]));
  const participants = new Map();
  const seenBattles = new Set();
  function addParticipant(rawId, guildId, profile = {}) {
    const id = playerId(rawId);
    if (!id) return null;
    const participant = participants.get(id) ?? { userId: id, sides: new Set() };
    Object.assign(participant, profile);
    if (guildId) participant.sides.add(guildId);
    participants.set(id, participant);
    return id;
  }

  for (const player of data.playerData) {
    addParticipant(player.userId, guildBySide.get(player.teamIndex), {
      displayName: player.displayName,
      avatarUnitId: player.avatarUnitId,
      avatarFrameId: player.avatarFrameId,
    });
  }

  const battles = [];
  for (const log of data.activityLogs) {
    if (log.type !== 'battleFinished') continue;
    const attackerGuildId = guildBySide.get(log.teamIndex);
    if (!log.id || seenBattles.has(log.id) || !attackerGuildId || !Number.isFinite(log.createdOn)) {
      throw new Error(`Missing or invalid identity, side, or timestamp for battle ${log.id}`);
    }
    seenBattles.add(log.id);
    const defenderGuildId = guilds.find(guild => guild.guildId !== attackerGuildId).guildId;
    const attackerId = addParticipant(log.attacker?.userId || log.userId, attackerGuildId);
    const defenderId = addParticipant(log.defender?.userId, defenderGuildId);
    battles.push({ log, attackerGuildId, defenderGuildId, attackerId, defenderId });
  }
  if (!battles.length) throw new Error('Archive contains no finished battles');

  return {
    eventId,
    guilds,
    participants: [...participants.values()].map(({ sides, ...participant }) => ({
      ...participant,
      guildId: sides.size === 1 ? [...sides][0] : null,
    })),
    battles,
  };
}

module.exports = { parseWarArchive };