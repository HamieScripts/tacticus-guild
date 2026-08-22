import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Praetorians of Terra',
    loadComponent: () => import('@pages/home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'guild-wars',
    title: 'Guild Wars',
    loadComponent: () => import('@pages/guild-wars/guild-wars-page').then((m) => m.GuildWarsPage),
  },
  {
    path: 'battle-log',
    title: 'Battle Log',
    loadComponent: () => import('@pages/placeholder/placeholder-page').then((m) => m.PlaceholderPage),
    data: { title: 'Battle Log', phase: 'phase 06' },
  },
  {
    path: '**',
    title: 'Page not found',
    loadComponent: () => import('@pages/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
