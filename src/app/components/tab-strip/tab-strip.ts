import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface TabDef {
  readonly id: string;
  readonly label: string;
}

@Component({
  selector: 'app-tab-strip',
  templateUrl: './tab-strip.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabStrip {
  readonly tabs = input.required<readonly TabDef[]>();
  readonly activeId = input.required<string>();
  readonly tabChange = output<string>();

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const tabs = this.tabs();
    const last = tabs.length - 1;

    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;

    if (target === null) return;

    event.preventDefault();
    const nextTab = tabs[target];
    if (nextTab) this.tabChange.emit(nextTab.id);
  }
}
