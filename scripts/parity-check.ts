/**
 * Correctness gate for the rewrite: runs the ported buildSnapshot and the POC's original
 * side by side over every captured war and reports any divergence.
 *
 *   npm run verify:parity
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSnapshot } from '../src/app/core/snapshot/build-snapshot';
import { summarizeGuild } from '../src/app/core/snapshot/guild-summary';
import { gunzipJson, gzipJson } from '../src/app/core/util/gzip';
import { MAX_COMPRESSED_BYTES } from '../src/app/services/firestore-collections';
import type { WarSnapshot } from '../src/app/core/models/war-snapshot.model';

interface LegacyPlayer {
  userId: string;
  name: string;
  totalScore: number;
  tileScore: number;
  usedTokens: number;
  tilesCleared: number;
  averageScore: number;
  totalSkillRating: number;
}

interface LegacyGuild {
  teamIndex: number;
  name: string;
  players: LegacyPlayer[];
  battles: unknown[];
}

interface LegacySummary {
  totalPlayers: number;
  totalTokenSlots: number;
  usedTokens: number;
  remainingTokens: number;
  tokenScore: number;
  tileScore: number;
  avgPerUsedToken: number;
  projectedTokenScore: number;
  totalWins: number;
  totalCleanupWins: number;
  totalDefeats: number;
  totalAbandoned: number;
  totalUnused: number;
}

const require = createRequire(import.meta.url);
const legacy = require('../legacy/src/app.js') as {
  buildSnapshot: (data: unknown) => LegacyGuild[];
  summarizeGuild: (guild: LegacyGuild) => LegacySummary;
};

const HISTORY_DIR = join(process.cwd(), 'data', 'history');
const files = readdirSync(HISTORY_DIR).filter((file) => file.endsWith('.json'));

let failures = 0;
let tileSplitDiffs = 0;

async function main(): Promise<void> {
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(HISTORY_DIR, file), 'utf8')) as WarSnapshot;
    const ported = buildSnapshot(raw);
    const original = legacy.buildSnapshot(raw);

    const fail = (message: string): void => {
      failures += 1;
      console.error(`  FAIL ${file}: ${message}`);
    };

    // The gzip round trip must be lossless, and must fit inside a Firestore document.
    const compressed = await gzipJson(raw);
    if (compressed.length > MAX_COMPRESSED_BYTES) {
      fail(`compressed to ${compressed.length} bytes, over the ${MAX_COMPRESSED_BYTES} limit`);
    }
    const restored = await gunzipJson<WarSnapshot>(compressed);
    if (JSON.stringify(restored) !== JSON.stringify(raw)) {
      fail('gzip round trip did not reproduce the capture');
    }

    if (ported.length !== original.length) {
      fail(`guild count ${ported.length} vs ${original.length}`);
      continue;
    }

    ported.forEach((guild, index) => {
      const originalGuild = original[index];
      if (!originalGuild) return;

      if (guild.name !== originalGuild.name) {
        fail(`guild name "${guild.name}" vs "${originalGuild.name}"`);
      }
      if (guild.players.length !== originalGuild.players.length) {
        fail(
          `${guild.name} player count ${guild.players.length} vs ${originalGuild.players.length}`,
        );
      }
      if (guild.battles.length !== originalGuild.battles.length) {
        fail(
          `${guild.name} battle count ${guild.battles.length} vs ${originalGuild.battles.length}`,
        );
      }

      for (const player of guild.players) {
        const before = originalGuild.players.find((p) => p.userId === player.userId);
        if (!before) {
          fail(`${guild.name} player ${player.userId} missing from POC output`);
          continue;
        }

        if (player.usedTokens !== before.usedTokens) {
          fail(`${player.name} usedTokens ${player.usedTokens} vs ${before.usedTokens}`);
        }
        if (player.averageScore !== before.averageScore) {
          fail(`${player.name} averageScore ${player.averageScore} vs ${before.averageScore}`);
        }
        if (Math.abs(player.totalSkillRating - before.totalSkillRating) > 1e-6) {
          fail(`${player.name} skillRating ${player.totalSkillRating} vs ${before.totalSkillRating}`);
        }
        if (player.tilesCleared !== before.tilesCleared) {
          fail(`${player.name} tilesCleared ${player.tilesCleared} vs ${before.tilesCleared}`);
        }

        const portedCombined = player.totalScore + player.tileScore;
        const beforeCombined = before.totalScore + before.tileScore;
        if (portedCombined !== beforeCombined) {
          fail(`${player.name} combined score ${portedCombined} vs ${beforeCombined}`);
        } else if (player.tileScore !== before.tileScore) {
          tileSplitDiffs += 1;
          console.log(
            `  tile split differs for ${player.name}: ` +
              `${player.totalScore}+${player.tileScore} vs ${before.totalScore}+${before.tileScore}`,
          );
        }
      }

      // Everything the guild token projection table renders.
      const summary = summarizeGuild(guild);
      const legacySummary = legacy.summarizeGuild(originalGuild);
      const summaryFields: (keyof LegacySummary)[] = [
        'totalPlayers',
        'totalTokenSlots',
        'usedTokens',
        'remainingTokens',
        'tokenScore',
        'tileScore',
        'projectedTokenScore',
        'totalWins',
        'totalCleanupWins',
        'totalDefeats',
        'totalAbandoned',
        'totalUnused',
      ];

      for (const field of summaryFields) {
        if (summary[field] !== legacySummary[field]) {
          fail(`${guild.name} summary.${field} ${summary[field]} vs ${legacySummary[field]}`);
        }
      }

      if (Math.abs(summary.avgPerUsedToken - legacySummary.avgPerUsedToken) > 1e-6) {
        fail(
          `${guild.name} summary.avgPerUsedToken ${summary.avgPerUsedToken} vs ${legacySummary.avgPerUsedToken}`,
        );
      }
    });

    if (failures === 0) console.log(`  ok ${file}`);
  }

  console.log(
    `\n${files.length} captures checked, ${tileSplitDiffs} tile-split differences, ${failures} failures.`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

