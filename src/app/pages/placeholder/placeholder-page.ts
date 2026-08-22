import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Temporary landing for routes whose pages arrive in a later phase. */
@Component({
  selector: 'app-placeholder-page',
  imports: [RouterLink],
  template: `
    <div class="rounded-2xl border border-slate-800 bg-slate-900/60 p-10 text-center">
      <h2 class="text-2xl font-bold text-white">{{ title() }}</h2>
      <p class="mt-2 text-sm text-slate-400">Not built yet — arriving in {{ phase() }}.</p>
      <a
        routerLink="/"
        class="mt-6 inline-flex rounded-lg border border-slate-600/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-400/70 hover:text-white"
      >
        Back to home
      </a>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderPage {
  readonly title = input('Coming soon');
  readonly phase = input('a later phase');
}
