import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { environment } from '../../environments/environment';

/**
 * Only firebase/app is imported here, so consumers that need nothing else - notably AuthService,
 * which the shell injects - do not drag Firestore into the initial bundle.
 */
export function getFirebaseApp(): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(environment.firebase);
}
