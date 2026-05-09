import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { IconComponent } from '../icon/icon.component';
import { AccountMenuComponent } from '../account-menu/account-menu.component';
import { AuthService } from '../../services/auth.service';
import { AuthModalService } from '../../services/auth-modal.service';

@Component({
  selector: 'app-top-bar',
  standalone: true,
  imports: [IconComponent, AccountMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="top-bar">
      <div class="account-area">
        @if (auth.isLoggedIn()) {
          <app-account-menu />
        } @else {
          <button class="account-btn" (click)="authModal.open()">Accedi</button>
        }
      </div>
      @if (showSearch()) {
        <div class="search-box">
          <input type="text" placeholder="Cerca..." [value]="query()" (input)="onInput($event)" (keydown.enter)="submitSearch()">
          <button class="search-btn" aria-label="Cerca" (click)="submitSearch()">
            <app-icon name="search"></app-icon>
          </button>
        </div>
      }
    </div>
  `,
  styleUrl: './top-bar.component.css'
})
export class TopBarComponent {
  protected readonly auth = inject(AuthService);
  protected readonly authModal = inject(AuthModalService);
  private readonly router = inject(Router);

  readonly query = signal('');

  // Re-fires whenever a navigation completes so the URL-derived computeds
  // below can recalculate.
  private readonly nav = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)),
    { initialValue: null }
  );

  // Search is only meaningful on the home/browse page — hide it elsewhere
  // (watch, list, search results) so the top bar shows just the account area.
  protected readonly showSearch = computed<boolean>(() => {
    this.nav();
    return /^\/browse(?:[/?#]|$)/.test(this.router.url);
  });

  protected onInput(ev: Event): void {
    const target = ev.target;
    if (target instanceof HTMLInputElement) this.query.set(target.value);
  }

  protected submitSearch(): void {
    const q = this.query().trim();
    if (q) void this.router.navigate(['/search'], { queryParams: { q } });
  }
}
