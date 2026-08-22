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
  // Mirrors the projection table's colgroup so the skeleton does not shift on load.
  protected readonly projectionCells = [
    '20%',
    '7%',
    '6%',
    '7%',
    '8%',
    '9%',
    '6%',
    '8%',
    '9%',
    '10%',
    '10%',
  ].map((width, index) => ({ key: index, width }));
  protected readonly headerGroups = [
    { key: 'tokens', width: '28%' },
    { key: 'performance', width: '23%' },
    { key: 'player-score', width: '19%' },
    { key: 'tile-score', width: '10%' },
  ];
  protected readonly tokenCells = Array.from({ length: 10 }, (_, i) => i);
  protected readonly statCells = [0, 1, 2];
  protected readonly rows = computed(() =>
    Array.from({ length: Math.max(1, this.playerRows()) }, (_, i) => i),
  );
}
