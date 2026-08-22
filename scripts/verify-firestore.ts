/**
 * End-to-end check against the live project: war data is publicly readable, payloads round trip
 * back into snapshots, and anonymous writes are refused.
 *
 *   npm run verify:firestore
 */
import { initializeApp } from 'firebase/app';
import { Bytes, collection, doc, getDoc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import type { WarSnapshot } from '../src/app/core/models/war-snapshot.model';
import { buildSnapshot } from '../src/app/core/snapshot/build-snapshot';
import { gunzipJson } from '../src/app/core/util/gzip';
import { environment } from '../src/environments/environment';

let failures = 0;

function report(ok: boolean, message: string): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}`);
}

async function main(): Promise<void> {
  const db = getFirestore(initializeApp(environment.firebase));

  console.log(`Checking ${environment.firebase.projectId}\n`);

  console.log('Public reads:');
  const wars = await getDocs(query(collection(db, 'wars'), orderBy('warDate', 'desc')));
  report(wars.size === 6, `war list returned ${wars.size} documents`);
  for (const war of wars.docs) {
    console.log(`       ${war.get('label')}  (${war.get('compressedBytes')} bytes)`);
  }

  const newest = wars.docs[0];
  if (!newest) {
    console.error('No wars found; nothing further to check.');
    process.exit(1);
  }

  const payload = await getDoc(doc(db, 'wars', newest.id, 'payload', 'snapshot'));
  report(payload.exists(), 'payload subcollection is readable');

  const gzipField = payload.get('gzip') as Bytes | undefined;
  report(gzipField instanceof Bytes, 'payload carries gzip bytes');

  if (gzipField instanceof Bytes) {
    const raw = await gunzipJson<WarSnapshot>(gzipField.toUint8Array());
    const guilds = buildSnapshot(raw);
    report(guilds.length === 2, `snapshot rebuilt into ${guilds.length} guilds`);
    for (const guild of guilds) {
      console.log(`       ${guild.name}: ${guild.players.length} players, ${guild.battles.length} battles`);
    }
  }

  const staticDoc = await getDoc(doc(db, 'static', 'portraitMap'));
  report(staticDoc.exists(), 'static portraitMap is readable');

  console.log('\nAnonymous writes are refused:');
  const denied = async (label: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
      report(false, `${label} was ALLOWED`);
    } catch {
      report(true, `${label} was denied`);
    }
  };

  await denied('writing a war', () => setDoc(doc(db, 'wars', 'intruder'), { label: 'nope' }));
  await denied('writing a payload', () =>
    setDoc(doc(db, 'wars', newest.id, 'payload', 'snapshot'), { gzip: 'nope' }),
  );
  await denied('writing static data', () => setDoc(doc(db, 'static', 'portraitMap'), { map: {} }));
  await denied('granting admin', () => setDoc(doc(db, 'admins', 'intruder'), { email: 'x' }));

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
