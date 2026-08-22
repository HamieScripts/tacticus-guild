import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  template: `
    <div class="rounded-2xl border border-slate-800 bg-slate-900/60 p-10 text-center">
      <h2 class="text-2xl font-bold text-white">Page not found</h2>
      <p class="mt-2 text-sm text-slate-400">That route does not exist.</p>
      <a
        routerLink="/"
        class="mt-6 inline-flex rounded-lg border border-cyan-400/70 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-200"
      >
        Back to home
      </a>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
