import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { PlayerSnapshot } from '@core/snapshot/build-snapshot';
import type { LeaderboardSort, LeaderboardSortKey } from '@core/snapshot/token-display';
import { PlayerAvatar } from '../player-avatar/player-avatar';
import { TokenCell } from '../token-cell/token-cell';

@Component({
  selector: 'app-leaderboard-table',
  imports: [DecimalPipe, PlayerAvatar, TokenCell],
  templateUrl: './leaderboard-table.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeaderboardTable {
  readonly players = input.required<readonly PlayerSnapshot[]>();
  readonly sort = input.required<LeaderboardSort>();
  readonly sortChange = output<LeaderboardSortKey>();

  protected readonly columns = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  protected ariaSort(key: LeaderboardSortKey): 'ascending' | 'descending' | 'none' {
    const sort = this.sort();
    if (sort.key !== key) return 'none';
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }
}
