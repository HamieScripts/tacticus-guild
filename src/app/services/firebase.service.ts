import { Injectable } from '@angular/core';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFirebaseApp } from './firebase-app';

/** Firestore handle for the data services. Only lazy-routed pages inject these. */
@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private firestore: Firestore | null = null;

  getFirestore(): Firestore {
    this.firestore ??= getFirestore(getFirebaseApp());
    return this.firestore;
  }
}
