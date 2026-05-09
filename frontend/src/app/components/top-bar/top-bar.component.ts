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
        <section class="search-panel" aria-label="Ricerca catalogo">
          <button type="button" class="search-intro" (click)="openSearch()">
            <span class="search-badge">
              <app-icon name="search"></app-icon>
            </span>
            <div class="search-copy">
              <p class="search-title">Cerca nel catalogo</p>
              <p class="search-hint">Film e serie TV, con i risultati più recenti in cima.</p>
            </div>
          </button>

          @if (searchOpen()) {
            <div class="search-box">
              <label class="search-field" aria-label="Termine di ricerca">
                <app-icon name="search"></app-icon>
                <input
                  type="text"
                  placeholder="Titolo, film o serie TV"
                  [value]="query()"
                  (input)="onInput($event)"
                  (keydown.enter)="submitSearch()"
                  (keydown.escape)="handleEscape()">
                @if (query().trim()) {
                  <button type="button" class="clear-btn" aria-label="Cancella ricerca" (click)="clearQuery()">
                    <app-icon name="close"></app-icon>
                  </button>
                }
              </label>

              <div class="search-actions">
                <button class="ghost-btn" type="button" (click)="closeSearch()">Chiudi</button>
                <button class="search-btn" type="button" [disabled]="!query().trim()" (click)="submitSearch()">
                  <app-icon name="search"></app-icon>
                  <span>Cerca</span>
                </button>
              </div>
            </div>
          }
        </section>
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
  readonly searchOpen = signal(false);

  private readonly nav = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)),
    { initialValue: null }
  );

  protected readonly showSearch = computed<boolean>(() => {
    this.nav();
    return /^\/browse(?:[/?#]|$)/.test(this.router.url);
  });

  protected onInput(ev: Event): void {
    const target = ev.target;
    if (target instanceof HTMLInputElement) this.query.set(target.value);
  }

  protected openSearch(): void {
    this.searchOpen.set(true);
  }

  protected closeSearch(): void {
    this.searchOpen.set(false);
  }

  protected clearQuery(): void {
    this.query.set('');
  }

  protected handleEscape(): void {
    if (this.query().trim()) this.clearQuery();
    else this.closeSearch();
  }

  protected submitSearch(): void {
    const q = this.query().trim();
    if (q) {
      this.searchOpen.set(false);
      void this.router.navigate(['/search'], { queryParams: { q } });
    }
  }
}
