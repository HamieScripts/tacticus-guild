import type { Environment } from './environment.model';

// Firebase web config is public by design; access is governed by Firestore/Storage rules.
export const environment: Environment = {
  production: true,
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },
};
