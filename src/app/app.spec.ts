import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { AuthService } from '@services/auth.service';

class AuthServiceStub {
  readonly user = signal<{ displayName: string | null; photoURL: string | null } | null>(null);
  readonly isAdmin = signal(false);
  watch = (): void => undefined;
  signIn = (): Promise<void> => Promise.resolve();
  signOut = (): Promise<void> => Promise.resolve();
}

describe('App', () => {
  let auth: AuthServiceStub;

  beforeEach(async () => {
    auth = new AuthServiceStub();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    }).compileComponents();
  });

  it('should create the app', () => {
    expect(TestBed.createComponent(App).componentInstance).toBeTruthy();
  });

  it('renders the guild name', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Praetorians of Terra');
  });

  it('hides admin-only nav links until the user is an admin', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const labels = () =>
      Array.from(compiled.querySelectorAll('nav a')).map((a) => a.textContent?.trim());

    expect(labels()).not.toContain('Upload');

    auth.isAdmin.set(true);
    await fixture.whenStable();
    expect(labels()).toContain('Upload');
  });
});
