import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type { NavLink } from '../site-header/nav-link.model';

@Component({
  selector: 'app-mobile-nav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './mobile-nav.html',
  // Escape must work wherever focus sits, including on the toggle that opened the panel.
  host: { '(document:keydown.escape)': 'onEscape()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileNav {
  readonly links = input.required<readonly NavLink[]>();
  readonly open = input(false);
  readonly dismissed = output<void>();

  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    effect(() => {
      const isOpen = this.open();
      if (typeof document === 'undefined') return;

      document.body.style.overflow = isOpen ? 'hidden' : '';
      if (isOpen) this.closeButton()?.nativeElement.focus();
    });
  }

  protected onEscape(): void {
    if (this.open()) this.dismissed.emit();
  }
}
