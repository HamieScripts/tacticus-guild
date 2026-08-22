import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { WarMetadata } from '@core/models/war-metadata.model';

@Component({
  selector: 'app-dataset-selector',
  templateUrl: './dataset-selector.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DatasetSelector {
  readonly wars = input.required<readonly WarMetadata[]>();
  readonly selectedId = input<string | null>(null);
  readonly selectionChange = output<string>();

  protected onChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value) this.selectionChange.emit(value);
  }
}

