import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MobileNav } from '../mobile-nav/mobile-nav';
import type { NavLink } from './nav-link.model';

export interface HeaderUser {
  readonly displayName: string | null;
  readonly photoURL: string | null;
}

@Component({
  selector: 'app-site-header',
  imports: [RouterLink, RouterLinkActive, MobileNav],
  templateUrl: './site-header.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteHeader {
  readonly title = input('Praetorians of Terra');
  readonly links = input.required<readonly NavLink[]>();
  readonly user = input<HeaderUser | null>(null);

  readonly signIn = output<void>();
  readonly signOut = output<void>();

  protected readonly menuOpen = signal(false);

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }
}
