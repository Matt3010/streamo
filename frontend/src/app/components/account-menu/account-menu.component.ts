import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { UiButtonDirective } from '../../ui/ui-button.directive';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-account-menu',
  standalone: true,
  imports: [UiButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button uiButton="panel-pill" type="button" [attr.aria-expanded]="open()" (click)="toggle($event)">
      <span class="account-dot" aria-hidden="true"></span>
      <span class="account-name">{{ displayName() }}</span>
      <span class="account-chevron" aria-hidden="true"></span>
    </button>
    @if (open()) {
      <div class="account-menu open">
        <div class="username">{{ auth.currentUser()?.email }}</div>
        @if (auth.isAdmin()) {
          <button uiButton="menu-item" type="button" (click)="goToAdmin()">Admin</button>
        }
        <button uiButton="menu-item" type="button" (click)="goTo('watchlist')">La mia lista</button>
        <button uiButton="menu-item" type="button" (click)="goTo('history')">Cronologia</button>
        <button uiButton="menu-item" type="button" (click)="goToSettings()">Impostazioni</button>
        <button uiButton="menu-item" type="button" uiButtonTone="danger" (click)="logout()">Esci</button>
      </div>
    }
  `,
  styleUrl: './account-menu.component.css'
})
export class AccountMenuComponent {
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly open = signal(false);
  protected readonly displayName = computed(() => {
    const email = this.auth.currentUser()?.email ?? '';
    return email.split('@')[0] || email;
  });

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (!this.open()) return;
    const target = ev.target;
    if (target instanceof Node && !this.host.nativeElement.contains(target)) {
      this.open.set(false);
    }
  }

  protected toggle(ev: MouseEvent): void {
    ev.stopPropagation();
    this.open.update(o => !o);
  }

  protected goTo(kind: 'watchlist' | 'history'): void {
    this.open.set(false);
    void this.router.navigate(['/list', kind]);
  }

  protected goToAdmin(): void {
    this.open.set(false);
    void this.router.navigate(['/admin']);
  }

  protected goToSettings(): void {
    this.open.set(false);
    void this.router.navigate(['/settings']);
  }

  protected async logout(): Promise<void> {
    this.open.set(false);
    await this.auth.logout();
    this.toast.show('Logout effettuato');
  }
}
