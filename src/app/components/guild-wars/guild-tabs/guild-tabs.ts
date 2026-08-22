import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { GuildSnapshot } from '@core/snapshot/build-snapshot';

@Component({
  selector: 'app-guild-tabs',
  template: `
    <div class="flex flex-wrap gap-3" role="tablist" aria-label="Guild">
      @for (guild of guilds(); track guild.teamIndex) {
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="guild.teamIndex === activeTeamIndex()"
          class="inline-flex min-h-[2.25rem] items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold leading-4 transition"
          [class]="
            guild.teamIndex === activeTeamIndex()
              ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 shadow-lg shadow-cyan-500/10'
              : 'border-slate-700 bg-slate-800/70 text-slate-300 hover:border-slate-500 hover:text-white'
          "
          (click)="guildChange.emit(guild.teamIndex)"
        >
          {{ guild.name }}
        </button>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuildTabs {
  readonly guilds = input.required<readonly GuildSnapshot[]>();
  readonly activeTeamIndex = input<number | null>(null);
  readonly guildChange = output<number>();
}
