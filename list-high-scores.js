const data = require('./data/65648500-b63c-4a80-8862-c36e9e7d800f.json');
const playerNames = new Map(data.eventResults[0].eventResponseData.playerData.map(p => [p.userId, p.displayName]));
const logs = data.eventResults[0].eventResponseData.activityLogs.filter(l => l.type === 'battleFinished' && l.score);

function getCoreScore(value) {
  const numericValue = Number(value) || 0;
  if (numericValue >= 10000 && numericValue <= 99999) {
    const bonus = Math.floor(numericValue / 1000) * 1000;
    const core = numericValue - bonus;
    return { core, bonus };
  }
  return { core: numericValue, bonus: 0 };
}

const highScores = logs
  .map(log => {
    const { core, bonus } = getCoreScore(Number(log.score || 0));
    return {
      player: playerNames.get(log.userId) || log.userId.slice(0, 8),
      userId: log.userId.slice(0, 8),
      core,
      bonus,
      total: core + bonus,
      abandoned: log.abandoned,
      zone: log.zone
    };
  })
  .filter(entry => entry.core > 1600)
  .sort((a, b) => b.core - a.core);

console.log(`Battles with core score > 1600: ${highScores.length}\n`);
console.log('Player                           | Core  | Bonus  | Total  | Zone');
console.log('-'.repeat(70));
highScores.slice(0, 50).forEach(entry => {
  const bonus = entry.bonus > 0 ? entry.bonus.toString() : '-';
  console.log(`${entry.player.padEnd(30)} | ${entry.core.toString().padStart(5)} | ${bonus.padStart(6)} | ${entry.total.toString().padStart(6)} | ${entry.zone}`);
});

console.log(`\n... (showing first 50 of ${highScores.length} results)`);
