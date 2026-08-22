import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-skeleton-loader',
  templateUrl: './skeleton-loader.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkeletonLoader {
  readonly rows = input(5);
  readonly variant = input<'table' | 'card'>('table');

  protected readonly placeholders = computed(() =>
    Array.from({ length: Math.max(1, this.rows()) }, (_, index) => index),
  );
}
