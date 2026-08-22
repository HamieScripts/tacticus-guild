import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Static key for the token markers; the POC's version was non-interactive too. */
@Component({
  selector: 'app-token-legend',
  template: `
    <div class="flex flex-wrap items-center justify-start gap-2 text-sm">
      <span class="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-slate-400/20 bg-slate-900/60 px-2 py-1 text-blue-100">
        <span class="inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">🛑</span>
        <span class="font-semibold">Abandoned</span>
      </span>
      <span class="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-slate-400/20 bg-slate-900/60 px-2 py-1 text-blue-100">
        <span class="inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">🧹</span>
        <span class="font-semibold">Cleanup</span>
      </span>
      <span class="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-slate-400/20 bg-slate-900/60 px-2 py-1 text-blue-100">
        <span class="inline-flex h-5 w-5 items-center justify-center">
          <span class="inline-flex h-2.5 w-2.5 rounded-full border border-red-500 bg-black"></span>
        </span>
        <span class="font-semibold">NPC</span>
      </span>
      <span class="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-slate-400/20 bg-slate-900/60 px-2 py-1 text-blue-100">
        <span class="inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">🏢</span>
        <span class="font-semibold">Tile win</span>
      </span>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokenLegend {}
