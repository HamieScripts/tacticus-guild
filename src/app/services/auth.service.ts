import { computed, Injectable, signal } from '@angular/core';
import type { User } from 'firebase/auth';
import { getFirebaseApp } from './firebase-app';
import { ADMINS_COLLECTION } from './war-metadata.model';

export interface AppUser {
  readonly uid: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly photoURL: string | null;
}

/**
 * The shell injects this, so firebase/auth and firebase/firestore are imported dynamically to keep
 * them out of the initial bundle. Most visitors never sign in.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
    private readonly userState = signal<AppUser | null>(null);
  private readonly adminState = signal(false);
  private readonly resolvedState = signal(false);
  private watching = false;

  readonly user = this.userState.asReadonly();
  /** UX affordance only; Firestore rules are the real boundary. */
  readonly isAdmin = this.adminState.asReadonly();
  readonly isSignedIn = computed(() => this.userState() !== null);
  /** False until the first auth state callback lands, so guards can wait it out. */
  readonly isResolved = this.resolvedState.asReadonly();

  private resolveFirst!: () => void;
  private readonly firstResolution = new Promise<void>((resolve) => {
    this.resolveFirst = resolve;
  });

  watch(): void {
    if (this.watching || typeof window === 'undefined') return;
    this.watching = true;

    void (async () => {
      const { getAuth, onAuthStateChanged } = await import('firebase/auth');
      onAuthStateChanged(getAuth(getFirebaseApp()), (user) => {
        void this.applyUser(user);
      });
    })();
  }

  whenResolved(): Promise<void> {
    this.watch();
    return this.firstResolution;
  }

  async signIn(): Promise<void> {
    const { browserLocalPersistence, getAuth, GoogleAuthProvider, setPersistence, signInWithPopup } =
      await import('firebase/auth');

    const auth = getAuth(getFirebaseApp());
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, new GoogleAuthProvider());
  }

  async signOut(): Promise<void> {
    const { getAuth, signOut } = await import('firebase/auth');
    await signOut(getAuth(getFirebaseApp()));
  }

  private async applyUser(user: User | null): Promise<void> {
    if (!user) {
      this.userState.set(null);
      this.adminState.set(false);
    } else {
      this.userState.set({
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
      });
      this.adminState.set(await this.checkAdmin(user.uid));
    }

    this.resolvedState.set(true);
    this.resolveFirst();
  }

  private async checkAdmin(uid: string): Promise<boolean> {
    try {
      const { doc, getDoc, getFirestore } = await import('firebase/firestore');
      const snapshot = await getDoc(doc(getFirestore(getFirebaseApp()), ADMINS_COLLECTION, uid));
      return snapshot.exists();
    } catch {
      return false;
    }
  }
}

