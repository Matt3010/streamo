import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-account-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button class="account-btn" (click)="toggle($event)">{{ displayName() }}</button>
    @if (open()) {
      <div class="account-menu open">
        <div class="username">{{ auth.currentUser()?.email }}</div>
        <button (click)="goTo('watchlist')">La mia lista</button>
        <button (click)="goTo('history')">Cronologia</button>
        <label class="menu-toggle">
          <input type="checkbox" [checked]="autoplayChecked()" (change)="onAutoplayChange($event)">
          <span>Autoplay episodio successivo</span>
        </label>
        <button class="danger" (click)="logout()">Esci</button>
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
  protected readonly autoplayChecked = computed(() => this.auth.currentUser()?.autoplay_next === 1);

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

  protected async onAutoplayChange(ev: Event): Promise<void> {
    const target = ev.target;
    if (!(target instanceof HTMLInputElement)) return;
    const enabled: 0 | 1 = target.checked ? 1 : 0;
    const ok = await this.auth.setAutoplay(enabled);
    if (!ok) target.checked = !target.checked;
  }

  protected async logout(): Promise<void> {
    this.open.set(false);
    await this.auth.logout();
    this.toast.show('Logout effettuato');
  }
}
