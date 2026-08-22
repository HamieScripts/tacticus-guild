/**
 * Seeds Firestore from the POC's data/ folder. Idempotent - re-running overwrites in place.
 *
 * Uses the client SDK, so it needs no service account. That means it can only run while writes
 * are permitted: either against the emulator, or during a deliberate rules window.
 *
 *   npm run migrate:emulator   # against the local emulator
 *   npm run migrate            # against production
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { initializeApp } from 'firebase/app';
import {
  Bytes,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  setDoc,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import type { WarSnapshot } from '../src/app/core/models/war-snapshot.model';
import { buildWarMetadata, validateSnapshot } from '../src/app/core/snapshot/war-metadata';
import { environment } from '../src/environments/environment';
import { MAX_COMPRESSED_BYTES } from '../src/app/services/firestore-collections';

const DATA_ROOT = join(process.cwd(), 'data');

function connect(): Firestore {
  const db = getFirestore(initializeApp(environment.firebase));

  const emulator = process.env['FIRESTORE_EMULATOR_HOST'];
  if (emulator) {
    const [host, port] = emulator.split(':');
    connectFirestoreEmulator(db, host ?? '127.0.0.1', Number(port ?? 8080));
  }

  return db;
}

async function writeWar(
  db: Firestore,
  warId: string,
  raw: WarSnapshot,
  isCurrent: boolean,
): Promise<boolean> {
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

  await setDoc(doc(db, 'wars', warId), {
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

  await setDoc(doc(db, 'wars', warId, 'payload', 'snapshot'), {
    gzip: Bytes.fromUint8Array(new Uint8Array(compressed)),
  });

  const pct = Math.round((compressed.length / json.length) * 100);
  console.log(`  ok ${metadata.label} (${json.length} -> ${compressed.length} bytes, ${pct}%)`);
  return true;
}

async function writeStatic(db: Firestore): Promise<void> {
  const staticDir = join(DATA_ROOT, 'static');
  const read = <T>(name: string): T | null => {
    const path = join(staticDir, name);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
  };

  const portraitMap = read<Record<string, string>>('portrait-map.json');
  if (portraitMap) {
    await setDoc(doc(db, 'static', 'portraitMap'), { map: portraitMap });
    console.log(`  ok portraitMap (${Object.keys(portraitMap).length} units)`);
  }

  const imageManifest = read<string[]>('image-manifest.json');
  if (imageManifest) {
    await setDoc(doc(db, 'static', 'imageManifest'), { files: imageManifest });
    console.log(`  ok imageManifest (${imageManifest.length} files)`);
  }

  const guildTeams = read<unknown[]>('guild-teams.json');
  if (guildTeams) {
    await setDoc(doc(db, 'static', 'guildTeams'), { teams: guildTeams });
    console.log(`  ok guildTeams (${guildTeams.length} teams)`);
  }
}

async function main(): Promise<void> {
  const target = process.env['FIRESTORE_EMULATOR_HOST']
    ? `emulator (${process.env['FIRESTORE_EMULATOR_HOST']})`
    : `production project ${environment.firebase.projectId}`;
  console.log(`Migrating to ${target}\n`);

  const db = connect();

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
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

