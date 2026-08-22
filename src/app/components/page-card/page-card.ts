import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export type PageCardAccent = 'cyan' | 'emerald' | 'violet' | 'amber';

const ACCENT_CLASSES: Record<PageCardAccent, string> = {
  cyan: 'border-cyan-400/25 shadow-cyan-500/10 hover:border-cyan-300/60',
  emerald: 'border-emerald-400/25 shadow-emerald-500/10 hover:border-emerald-300/60',
  violet: 'border-violet-400/25 shadow-violet-500/10 hover:border-violet-300/60',
  amber: 'border-amber-400/25 shadow-amber-500/10 hover:border-amber-300/60',
};

const BADGE_CLASSES: Record<PageCardAccent, string> = {
  cyan: 'border-cyan-400/35 bg-cyan-500/10 text-cyan-200',
  emerald: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200',
  violet: 'border-violet-400/35 bg-violet-500/10 text-violet-200',
  amber: 'border-amber-400/35 bg-amber-500/10 text-amber-200',
};

@Component({
  selector: 'app-page-card',
  imports: [RouterLink],
  templateUrl: './page-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageCard {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly route = input.required<string>();
  readonly badge = input.required<string>();
  readonly icon = input('');
  readonly accent = input<PageCardAccent>('cyan');

  protected cardClasses(): string {
    return ACCENT_CLASSES[this.accent()];
  }

  protected badgeClasses(): string {
    return BADGE_CLASSES[this.accent()];
  }
}
