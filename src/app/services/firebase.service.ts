import { Injectable } from '@angular/core';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { environment } from '../../environments/environment';

/** Owns Firebase initialisation; nothing else in the app calls initializeApp. */
@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private app: FirebaseApp | null = null;
  private firestore: Firestore | null = null;
  private auth: Auth | null = null;

  getApp(): FirebaseApp {
    this.app ??= getApps().length > 0 ? getApp() : initializeApp(environment.firebase);
    return this.app;
  }

  getFirestore(): Firestore {
    this.firestore ??= getFirestore(this.getApp());
    return this.firestore;
  }

  getAuth(): Auth {
    this.auth ??= getAuth(this.getApp());
    return this.auth;
  }
}
