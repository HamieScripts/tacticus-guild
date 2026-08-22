import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { PlayerSnapshot, Token } from '@core/snapshot/build-snapshot';
import { orderTokensForCards } from '@core/snapshot/token-display';
import { PlayerAvatar } from '../player-avatar/player-avatar';
import { TokenCell } from '../token-cell/token-cell';

@Component({
  selector: 'app-leaderboard-cards',
  imports: [DecimalPipe, PlayerAvatar, TokenCell],
  templateUrl: './leaderboard-cards.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeaderboardCards {
  readonly players = input.required<readonly PlayerSnapshot[]>();

  protected orderTokens(tokens: readonly Token[]): readonly Token[] {
    return orderTokensForCards(tokens);
  }
}
