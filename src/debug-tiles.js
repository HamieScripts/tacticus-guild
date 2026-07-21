const data = require('../data/history/65648500-b63c-4a80-8862-c36e9e7d800f.json');
const logs = data.eventResults[0].eventResponseData.activityLogs.filter(l => l.type === 'battleFinished' && l.score);

const tileCounts = {};
logs.forEach(log => {
  const value = Number(log.score || 0);
  if (value >= 10000) {
    const bonus = Math.floor(value / 1000) * 1000;
    if ([10000, 11000, 16000, 17000, 30000, 31000, 40000, 41000].includes(bonus)) {
      const key = bonus;
      if (!tileCounts[key]) tileCounts[key] = [];
      tileCounts[key].push({userId: log.userId.slice(0, 8), zone: log.zone});
    }
  }
});

console.log('Tile clears by value:');
Object.keys(tileCounts).sort((a, b) => Number(a) - Number(b)).forEach(bonus => {
  const entries = tileCounts[bonus];
  console.log(`\n${bonus/1000}k tile: ${entries.length} clears`);
  const players = {};
  entries.forEach(e => { players[e.userId] = (players[e.userId] || 0) + 1; });
  Object.keys(players).slice(0, 5).forEach(u => console.log(`  ${u}: ${players[u]} clears`));
});

const totalTiles = Object.values(tileCounts).reduce((sum, arr) => sum + arr.length, 0);
console.log(`\nTotal tile clears across all players: ${totalTiles}`);

