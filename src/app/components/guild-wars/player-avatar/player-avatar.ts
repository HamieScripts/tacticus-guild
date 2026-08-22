import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const AVATAR_BASE = 'https://webstore-assets.loki.snowprintstudios.com/live/images';

// Frame filenames on tacticus.xyz are hashed, so only known ids can be resolved.
const FRAME_URLS: Readonly<Record<string, string>> = {
  frameMythic01: 'https://tacticus.xyz/assets/frames/ui_avatar_frame_framemythic01-90960f24.png',
};

@Component({
  selector: 'app-player-avatar',
  // Sizing lives on the host: an inline element would ignore the width and height.
  host: { class: 'relative block h-11 w-11 shrink-0' },
  template: `
    @if (avatarUrl(); as src) {
      <img
        class="absolute inset-1 z-10 h-9 w-9 rounded-full bg-slate-900/95 object-cover"
        [src]="src"
        [alt]="name() + ' avatar'"
        loading="lazy"
        referrerpolicy="no-referrer"
      />
    }
    @if (frameUrl(); as frame) {
      <img
        class="pointer-events-none absolute inset-0 z-0 h-11 w-11 object-contain"
        [src]="frame"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerAvatar {
  readonly name = input.required<string>();
  readonly avatarUnitId = input<string | null>(null);
  readonly avatarFrameId = input<string | null>(null);

  protected readonly avatarUrl = computed(() => {
    const unitId = this.avatarUnitId()?.trim().toLowerCase();
    return unitId ? `${AVATAR_BASE}/avatar_${unitId}.png` : null;
  });

  protected readonly frameUrl = computed(() => {
    const frameId = this.avatarFrameId();
    return frameId ? (FRAME_URLS[frameId] ?? null) : null;
  });
}
