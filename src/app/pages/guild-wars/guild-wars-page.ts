import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { filterRowsByName } from '@core/util/format';
import { orderGuildSummaries, summarizeGuild } from '@core/snapshot/guild-summary';
import {
  DEFAULT_LEADERBOARD_SORT,
  sortPlayers,
  type LeaderboardSort,
  type LeaderboardSortKey,
} from '@core/snapshot/token-display';
import type { GuildSnapshot } from '@core/snapshot/build-snapshot';
import { DatasetSelector } from '@components/guild-wars/dataset-selector/dataset-selector';
import { GuildTabs } from '@components/guild-wars/guild-tabs/guild-tabs';
import { LeaderboardCards } from '@components/guild-wars/leaderboard-cards/leaderboard-cards';
import { LeaderboardTable } from '@components/guild-wars/leaderboard-table/leaderboard-table';
import { TokenLegend } from '@components/guild-wars/token-legend/token-legend';
import { TokenProjectionTable } from '@components/guild-wars/token-projection-table/token-projection-table';
import { GuildWarsSkeleton } from '@components/guild-wars/guild-wars-skeleton/guild-wars-skeleton';
import { EmptyState } from '@components/empty-state/empty-state';
import { ErrorState } from '@components/error-state/error-state';
import { WarDatasetService } from '@services/war-dataset.service';
import { WarSnapshotService } from '@services/war-snapshot.service';

type Layout = 'table' | 'cards';

const LAYOUT_KEY = 'guild-wars.layout';
const SORT_KEY = 'guild-wars.sort';

function readStored<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

@Component({
  selector: 'app-guild-wars-page',
  imports: [
    DatasetSelector,
    GuildTabs,
    LeaderboardCards,
    LeaderboardTable,
    TokenLegend,
    TokenProjectionTable,
    EmptyState,
    ErrorState,
    GuildWarsSkeleton,
  ],
  host: { class: 'flex flex-col gap-6' },
  templateUrl: './guild-wars-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuildWarsPage {
  private readonly datasets = inject(WarDatasetService);
  private readonly snapshots = inject(WarSnapshotService);
  private readonly router = inject(Router);

  /** Bound from ?war=; falls back to the current war once the list loads. */
  readonly war = input<string | undefined>(undefined);

  protected readonly wars = this.datasets.wars;
  protected readonly datasetError = this.datasets.error;

  protected readonly guilds = signal<readonly GuildSnapshot[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly activeTeamIndex = signal<number | null>(null);
  protected readonly search = signal('');
  protected readonly layout = signal<Layout>(readStored<Layout>(LAYOUT_KEY, 'table'));
  protected readonly sort = signal<LeaderboardSort>(
    readStored<LeaderboardSort>(SORT_KEY, DEFAULT_LEADERBOARD_SORT),
  );

  protected readonly selectedWarId = computed(
    () => this.war() ?? this.datasets.currentWar()?.id ?? null,
  );

  protected readonly activeGuild = computed(() => {
    const guilds = this.guilds();
    if (!guilds?.length) return null;
    return guilds.find((g) => g.teamIndex === this.activeTeamIndex()) ?? guilds[0] ?? null;
  });

  protected readonly summaries = computed(() =>
    orderGuildSummaries((this.guilds() ?? []).map(summarizeGuild), this.activeTeamIndex()),
  );

  protected readonly rows = computed(() => {
    const guild = this.activeGuild();
    if (!guild) return [];
    return sortPlayers(filterRowsByName(guild.players, this.search()), this.sort());
  });

  constructor() {
    void this.datasets.load();

    effect(() => {
      const warId = this.selectedWarId();
      if (!warId) return;
      void this.loadWar(warId);
    });

    effect(() => {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout()));
      localStorage.setItem(SORT_KEY, JSON.stringify(this.sort()));
    });
  }

  protected onSelectWar(warId: string): void {
    void this.router.navigate([], { queryParams: { war: warId }, queryParamsHandling: 'merge' });
  }

  protected onSort(key: LeaderboardSortKey): void {
    this.sort.update((current) =>
      current.key === key
        ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { key, direction: 'desc' },
    );
  }

  protected onSearch(value: string): void {
    this.search.set(value);
  }

  protected retry(): void {
    const warId = this.selectedWarId();
    if (warId) void this.loadWar(warId);
  }

  private async loadWar(warId: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const guilds = await this.snapshots.get(warId);
      this.guilds.set(guilds);
      // Default to our own guild when the war first loads.
      const home = guilds.find((g) => g.name.toLowerCase().includes('praetorians')) ?? guilds[0];
      this.activeTeamIndex.set(home?.teamIndex ?? null);
    } catch (error) {
      this.guilds.set(null);
      this.error.set(error instanceof Error ? error.message : 'Failed to load the war.');
    } finally {
      this.loading.set(false);
    }
  }
}
