import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PageCard, type PageCardAccent } from '@components/page-card/page-card';

interface OverviewCard {
  readonly title: string;
  readonly description: string;
  readonly route: string;
  readonly badge: string;
  readonly icon: string;
  readonly accent: PageCardAccent;
}

// Sections not yet built simply are not listed; the POC hid them with a data-prod-hidden script.
const CARDS: readonly OverviewCard[] = [
  {
    title: 'Guild Wars',
    description: 'Compare player performance, track token use, and review guild projections.',
    route: '/guild-wars',
    badge: 'Guild',
    icon: '⚔️',
    accent: 'cyan',
  },
  {
    title: 'Battle Log',
    description: 'Inspect completed matches, score outcomes, cleanup events, and tile details.',
    route: '/battle-log',
    badge: 'Log',
    icon: '📜',
    accent: 'emerald',
  },
];

@Component({
  selector: 'app-home-page',
  imports: [PageCard],
  templateUrl: './home-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  protected readonly cards = CARDS;
}
