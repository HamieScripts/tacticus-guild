import { computed, inject, Injectable, signal } from '@angular/core';
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { FirebaseService } from './firebase.service';
import { ADMINS_COLLECTION } from './war-metadata.model';

export interface AppUser {
  readonly uid: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly photoURL: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly firebase = inject(FirebaseService);

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
    if (this.watching) return;
    this.watching = true;

    onAuthStateChanged(this.firebase.getAuth(), (user) => {
      void this.applyUser(user);
    });
  }

  whenResolved(): Promise<void> {
    this.watch();
    return this.firstResolution;
  }

  async signIn(): Promise<void> {
    const auth = this.firebase.getAuth();
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, new GoogleAuthProvider());
  }

  async signOut(): Promise<void> {
    await signOut(this.firebase.getAuth());
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
      const db = this.firebase.getFirestore();
      const snapshot = await getDoc(doc(db, ADMINS_COLLECTION, uid));
      return snapshot.exists();
    } catch {
      return false;
    }
  }
}
