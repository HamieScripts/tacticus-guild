import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SiteHeader } from '@components/site-header/site-header';
import type { NavLink } from '@components/site-header/nav-link.model';
import { AuthService } from '@services/auth.service';

const NAV_LINKS: readonly NavLink[] = [
  { label: 'Home', route: '/' },
  { label: 'Guild Wars', route: '/guild-wars' },
  { label: 'Battle Log', route: '/battle-log' },
  { label: 'Upload', route: '/admin/upload', adminOnly: true },
];

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SiteHeader],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  // The shell owns auth so the header stays a plain input/output component.
  private readonly auth = inject(AuthService);

  protected readonly user = this.auth.user;
  protected readonly navLinks = computed<readonly NavLink[]>(() =>
    NAV_LINKS.filter((link) => !link.adminOnly || this.auth.isAdmin()),
  );

  constructor() {
    this.auth.watch();
  }

  protected onSignIn(): void {
    void this.auth.signIn();
  }

  protected onSignOut(): void {
    void this.auth.signOut();
  }
}
