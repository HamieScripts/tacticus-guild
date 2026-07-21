const data = require('./data/65648500-b63c-4a80-8862-c36e9e7d800f.json');
const logs = data.eventResults[0].eventResponseData.activityLogs.filter(l => l.type === 'battleFinished' && l.score);

function getCoreScore(value) {
  const numericValue = Number(value) || 0;
  if (numericValue >= 10000) {
    const bonus = Math.floor(numericValue / 1000) * 1000;
    return { core: numericValue - bonus, bonus };
  }
  return { core: numericValue, bonus: 0 };
}

const scores = logs.map(l => getCoreScore(Number(l.score || 0)).core).sort((a, b) => b - a);

console.log('Max battle score:', Math.max(...scores));
console.log('Min battle score:', Math.min(...scores));
console.log('Average battle score:', Math.round(scores.reduce((a, b) => a + b, 0) / scores.length));
console.log('\nTop 30 battle scores:');
scores.slice(0, 30).forEach((s, i) => console.log(`  ${i+1}. ${s}`));

const ranges = {
  '0': 0,
  '1-100': 0,
  '101-500': 0,
  '501-1000': 0,
  '1001-1600': 0,
  '1601+': 0
};

scores.forEach(s => {
  if (s === 0) ranges['0']++;
  else if (s <= 100) ranges['1-100']++;
  else if (s <= 500) ranges['101-500']++;
  else if (s <= 1000) ranges['501-1000']++;
  else if (s <= 1600) ranges['1001-1600']++;
  else ranges['1601+']++;
});

console.log('\nScore distribution:');
Object.entries(ranges).forEach(([range, count]) => {
  console.log(`  ${range}: ${count}`);
});
