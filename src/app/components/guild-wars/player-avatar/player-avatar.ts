import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const AVATAR_BASE = 'https://webstore-assets.loki.snowprintstudios.com/live/images';

@Component({
  selector: 'app-player-avatar',
  template: `
    <span class="relative h-11 w-11 shrink-0">
      @if (avatarUrl(); as src) {
        <img
          class="absolute inset-1 z-10 h-9 w-9 rounded-full bg-slate-900/95 object-cover"
          [src]="src"
          [alt]="name() + ' avatar'"
          loading="lazy"
          referrerpolicy="no-referrer"
        />
      }
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerAvatar {
  readonly name = input.required<string>();
  readonly avatarUnitId = input<string | null>(null);

  protected readonly avatarUrl = computed(() => {
    const unitId = this.avatarUnitId()?.trim().toLowerCase();
    return unitId ? `${AVATAR_BASE}/avatar_${unitId}.png` : null;
  });
}
