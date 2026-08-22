import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { getCoreScore } from '@core/scoring/score-splitter';
import { isPlayedToken, type Token } from '@core/snapshot/build-snapshot';
import { getScoreTier, getTokenOutcome } from '@core/snapshot/token-display';

const OUTCOME_CLASSES: Record<string, string> = {
  win: 'bg-emerald-400/20 text-lime-100',
  defeat: 'bg-rose-400/20 text-rose-200',
  abandoned: 'bg-slate-400/20 text-slate-300',
  unused: 'bg-slate-400/20 text-slate-300',
};

const TIER_CLASSES: Record<string, string> = {
  gold: 'outline outline-2 outline-offset-2 outline-amber-400',
  silver: 'outline outline-2 outline-offset-2 outline-zinc-300',
  bronze: 'outline outline-2 outline-offset-2 outline-amber-700',
};

@Component({
  selector: 'app-token-cell',
  // Block-level host so the score block and buff chips stack and centre reliably.
  host: { class: 'flex flex-col items-center justify-center gap-1.5' },
  templateUrl: './token-cell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokenCell {
  readonly token = input.required<Token>();

  protected readonly outcome = computed(() => getTokenOutcome(this.token()));
  protected readonly played = computed(() => isPlayedToken(this.token()));

  protected readonly split = computed(() => {
    const token = this.token();
    return isPlayedToken(token) ? getCoreScore(token.score) : { core: 0, bonus: 0 };
  });

  protected readonly cleanup = computed(() => {
    const token = this.token();
    return isPlayedToken(token) && token.cleanup;
  });

  protected readonly easyGame = computed(() => {
    const token = this.token();
    return isPlayedToken(token) && token.easyGame;
  });

  protected readonly wonTile = computed(() => {
    const token = this.token();
    return isPlayedToken(token) && token.tileScore > 0;
  });

  protected readonly buffs = computed(() => {
    const token = this.token();
    if (!isPlayedToken(token)) return [];

    const seen = new Map<string, string>();
    for (const buff of token.buffs) {
      const name = buff.abilityId ?? buff.name ?? buff.id ?? '';
      if (name && !seen.has(name)) seen.set(name, buffColour(name));
    }
    return [...seen.entries()].map(([name, colour]) => ({ name, colour }));
  });

  protected readonly stateClass = computed(() => {
    const tier = getScoreTier(this.token());
    const tierClass = tier ? TIER_CLASSES[tier] : '';
    return `rounded-md px-2 py-1 ${OUTCOME_CLASSES[this.outcome()]} ${tierClass ?? ''}`.trim();
  });
}

/** Stable per-buff hue, ported from the POC so colours stay recognisable. */
function buffColour(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }
  return `hsl(${hash},72%,56%)`;
}
