/**
 * Seeds Firestore from the POC's data/ folder. Idempotent - re-running overwrites in place.
 *
 * Against the emulator (no credentials needed):
 *   npm run migrate:emulator
 *
 * Against production, with a service account key downloaded from the Firebase console:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\key.json"; npm run migrate
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { cert, initializeApp, applicationDefault, type AppOptions } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { WarSnapshot } from '../src/app/core/models/war-snapshot.model';
import { buildWarMetadata, validateSnapshot } from '../src/app/core/snapshot/war-metadata';
import { MAX_COMPRESSED_BYTES } from '../src/app/services/war-metadata.model';

const PROJECT_ID = process.env['FIREBASE_PROJECT_ID'] ?? 'warhammer-40k-tacticus-app';
const DATA_ROOT = join(process.cwd(), 'data');
const usingEmulator = Boolean(process.env['FIRESTORE_EMULATOR_HOST']);

function buildOptions(): AppOptions {
  if (usingEmulator) return { projectId: PROJECT_ID };

  const keyPath = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
  if (keyPath && existsSync(keyPath)) {
    return { projectId: PROJECT_ID, credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) };
  }
  return { projectId: PROJECT_ID, credential: applicationDefault() };
}

async function writeWar(db: Firestore, warId: string, raw: WarSnapshot, isCurrent: boolean) {
  const validation = validateSnapshot(raw);
  if (!validation.ok) {
    console.error(`  skip ${warId}: ${validation.reason}`);
    return false;
  }

  const json = Buffer.from(JSON.stringify(raw), 'utf8');
  const compressed = gzipSync(json, { level: 9 });

  if (compressed.length > MAX_COMPRESSED_BYTES) {
    console.error(
      `  skip ${warId}: ${compressed.length} compressed bytes exceeds the ${MAX_COMPRESSED_BYTES} limit`,
    );
    return false;
  }

  const metadata = buildWarMetadata(raw);

  await db
    .collection('wars')
    .doc(warId)
    .set({
      id: warId,
      label: metadata.label,
      sourceLabel: metadata.sourceLabel,
      opponentName: metadata.opponentName,
      warDate: Timestamp.fromMillis(metadata.warDate ?? 0),
      isCurrent,
      rawBytes: json.length,
      compressedBytes: compressed.length,
      uploadedBy: null,
      uploadedAt: Timestamp.now(),
    });

  await db
    .collection('wars')
    .doc(warId)
    .collection('payload')
    .doc('snapshot')
    .set({ gzip: compressed });

  const pct = Math.round((compressed.length / json.length) * 100);
  console.log(`  ok ${metadata.label} (${json.length} -> ${compressed.length} bytes, ${pct}%)`);
  return true;
}

async function writeStatic(db: Firestore) {
  const staticDir = join(DATA_ROOT, 'static');
  const read = <T>(name: string): T | null => {
    const path = join(staticDir, name);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
  };

  const portraitMap = read<Record<string, string>>('portrait-map.json');
  if (portraitMap) {
    await db.collection('static').doc('portraitMap').set({ map: portraitMap });
    console.log(`  ok portraitMap (${Object.keys(portraitMap).length} units)`);
  }

  const imageManifest = read<string[]>('image-manifest.json');
  if (imageManifest) {
    await db.collection('static').doc('imageManifest').set({ files: imageManifest });
    console.log(`  ok imageManifest (${imageManifest.length} files)`);
  }

  const guildTeams = read<unknown[]>('guild-teams.json');
  if (guildTeams) {
    await db.collection('static').doc('guildTeams').set({ teams: guildTeams });
    console.log(`  ok guildTeams (${guildTeams.length} teams)`);
  }
}

async function main() {
  console.log(
    `Migrating to ${usingEmulator ? `emulator (${process.env['FIRESTORE_EMULATOR_HOST']})` : 'production'} ` +
      `project ${PROJECT_ID}\n`,
  );

  initializeApp(buildOptions());
  const db = getFirestore();

  const historyDir = join(DATA_ROOT, 'history');
  const files = existsSync(historyDir)
    ? readdirSync(historyDir).filter((file) => file.endsWith('.json'))
    : [];

  console.log(`History (${files.length} captures):`);
  let written = 0;
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(historyDir, file), 'utf8')) as WarSnapshot;
    if (await writeWar(db, file.replace(/\.json$/, ''), raw, false)) written += 1;
  }

  const livePath = join(DATA_ROOT, 'current', 'live-war.json');
  if (existsSync(livePath)) {
    const raw = JSON.parse(readFileSync(livePath, 'utf8')) as WarSnapshot;
    if (validateSnapshot(raw).ok) {
      console.log('\nLive war:');
      if (await writeWar(db, 'live-war', raw, true)) written += 1;
    } else {
      console.log('\nLive war: empty, skipped.');
    }
  }

  console.log('\nStatic data:');
  await writeStatic(db);

  console.log(`\nDone. ${written} wars written.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
