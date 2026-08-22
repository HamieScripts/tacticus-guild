import type { Environment } from './environment.model';

// Firebase web config is public by design; access is governed by Firestore rules.
export const environment: Environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyDiXdq2YjBcIps-UQzIeVbzrO0jls07uTc',
    authDomain: 'warhammer-40k-tacticus-app.firebaseapp.com',
    projectId: 'warhammer-40k-tacticus-app',
    storageBucket: 'warhammer-40k-tacticus-app.firebasestorage.app',
    messagingSenderId: '854957139467',
    appId: '1:854957139467:web:bf9886790743168028090e',
  },
};
