import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { POSSIBLE_TILE_SCORE } from '@core/scoring/tile-scores';
import type { GuildSummary } from '@core/snapshot/guild-summary';

@Component({
  selector: 'app-token-projection-table',
  imports: [DecimalPipe],
  templateUrl: './token-projection-table.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokenProjectionTable {
  readonly summaries = input.required<readonly GuildSummary[]>();

  protected tilePercent(tileScore: number): number {
    return POSSIBLE_TILE_SCORE > 0 ? Math.round((tileScore / POSSIBLE_TILE_SCORE) * 100) : 0;
  }
}
