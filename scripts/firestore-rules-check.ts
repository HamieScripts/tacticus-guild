/**
 * Security rules tests. Run via the emulator:
 *   npm run test:rules
 *
 * Asserts the boundary the app relies on: war data is world-readable, only an account with an
 * admins/{uid} document may write, and nobody may write the allowlist itself.
 */
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const ADMIN_UID = 'admin-user';
const PLAIN_UID = 'plain-user';

let failures = 0;

async function check(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'warhammer-40k-tacticus-app',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  await testEnv.clearFirestore();

  // Seed the allowlist and a war behind the rules, as the console/migration would.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'admins', ADMIN_UID), { email: 'admin@example.com' });
    await setDoc(doc(db, 'wars', 'war-1'), { label: 'Rival (2026-01-01)' });
    await setDoc(doc(db, 'wars', 'war-1', 'payload', 'snapshot'), { gzip: 'x' });
    await setDoc(doc(db, 'static', 'portraitMap'), { map: {} });
  });

  const anon = testEnv.unauthenticatedContext().firestore();
  const plain = testEnv.authenticatedContext(PLAIN_UID).firestore();
  const admin = testEnv.authenticatedContext(ADMIN_UID).firestore();

  console.log('\nPublic reads:');
  await check('anonymous reads a war', () => assertSucceeds(getDoc(doc(anon, 'wars', 'war-1'))));
  await check('anonymous reads a war payload', () =>
    assertSucceeds(getDoc(doc(anon, 'wars', 'war-1', 'payload', 'snapshot'))),
  );
  await check('anonymous reads static data', () =>
    assertSucceeds(getDoc(doc(anon, 'static', 'portraitMap'))),
  );

  console.log('\nWrites are admin-only:');
  await check('anonymous cannot write a war', () =>
    assertFails(setDoc(doc(anon, 'wars', 'war-2'), { label: 'nope' })),
  );
  await check('signed-in non-admin cannot write a war', () =>
    assertFails(setDoc(doc(plain, 'wars', 'war-2'), { label: 'nope' })),
  );
  await check('signed-in non-admin cannot write a payload', () =>
    assertFails(setDoc(doc(plain, 'wars', 'war-1', 'payload', 'snapshot'), { gzip: 'nope' })),
  );
  await check('admin writes a war', () =>
    assertSucceeds(setDoc(doc(admin, 'wars', 'war-2'), { label: 'Rival (2026-02-01)' })),
  );
  await check('admin writes a payload', () =>
    assertSucceeds(setDoc(doc(admin, 'wars', 'war-2', 'payload', 'snapshot'), { gzip: 'y' })),
  );
  await check('admin writes static data', () =>
    assertSucceeds(setDoc(doc(admin, 'static', 'imageManifest'), { files: [] })),
  );

  console.log('\nThe allowlist is not client-writable:');
  await check('admin cannot grant admin', () =>
    assertFails(setDoc(doc(admin, 'admins', PLAIN_UID), { email: 'x@example.com' })),
  );
  await check('user reads only their own admin doc', () =>
    assertSucceeds(getDoc(doc(admin, 'admins', ADMIN_UID))),
  );
  await check('user cannot read another admin doc', () =>
    assertFails(getDoc(doc(plain, 'admins', ADMIN_UID))),
  );

  console.log('\nUnknown collections are denied:');
  await check('anonymous cannot read an unlisted collection', () =>
    assertFails(getDoc(doc(anon, 'secrets', 'a'))),
  );

  await testEnv.cleanup();

  console.log(failures === 0 ? '\nAll rules checks passed.' : `\n${failures} rules check(s) failed.`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
