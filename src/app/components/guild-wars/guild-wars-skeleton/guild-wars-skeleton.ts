import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Mirrors the Guild Wars layout so the page does not reflow when data lands. */
@Component({
  selector: 'app-guild-wars-skeleton',
  host: { class: 'flex flex-col gap-6' },
  templateUrl: './guild-wars-skeleton.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuildWarsSkeleton {
  readonly playerRows = input(12);

  protected readonly guildRows = [0, 1];
  protected readonly projectionCells = Array.from({ length: 11 }, (_, i) => i);
  // Widths track the real table's grouped header: Tokens(4), Performance(3), Player score(2), Tile(1).
  protected readonly headerGroups = [
    { key: 'tokens', width: 21.5 },
    { key: 'performance', width: 15.5 },
    { key: 'player-score', width: 10 },
    { key: 'tile-score', width: 5 },
  ];
  protected readonly tokenCells = Array.from({ length: 10 }, (_, i) => i);
  protected readonly statCells = [0, 1, 2];
  protected readonly rows = computed(() =>
    Array.from({ length: Math.max(1, this.playerRows()) }, (_, i) => i),
  );
}
