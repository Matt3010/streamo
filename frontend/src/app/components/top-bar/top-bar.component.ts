import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { IconComponent } from '../icon/icon.component';
import { AccountMenuComponent } from '../account-menu/account-menu.component';
import { UiTabsComponent, UiTab } from '../../ui/tabs/tabs.component';
import { AuthService } from '../../services/auth.service';
import { AuthModalService } from '../../services/auth-modal.service';
import type { MediaType } from '../../models';

const TABS: ReadonlyArray<UiTab<MediaType>> = [
  { value: 'movie', label: 'Film' },
  { value: 'tv', label: 'Serie TV' }
];

@Component({
  selector: 'app-top-bar',
  standalone: true,
  imports: [IconComponent, AccountMenuComponent, UiTabsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="top-bar">
      @if (showTabs()) {
        <ui-tabs [tabs]="tabs" [value]="currentType()" (valueChange)="setType($event)" />
      }
      <div class="search-box">
        <input type="text" placeholder="Cerca..." [value]="query()" (input)="onInput($event)" (keydown.enter)="submitSearch()">
        <button class="search-btn" aria-label="Cerca" (click)="submitSearch()">
          <app-icon name="search"></app-icon>
        </button>
      </div>
      <div class="account-area">
        @if (auth.isLoggedIn()) {
          <app-account-menu />
        } @else {
          <button class="account-btn" (click)="authModal.open()">Accedi</button>
        }
      </div>
    </div>
  `,
  styleUrl: './top-bar.component.css'
})
export class TopBarComponent {
  protected readonly auth = inject(AuthService);
  protected readonly authModal = inject(AuthModalService);
  private readonly router = inject(Router);

  readonly showTabs = input(true);

  protected readonly tabs = TABS;
  readonly query = signal('');

  // Recompute the active tab whenever navigation finishes.
  private readonly nav = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)),
    { initialValue: null }
  );

  readonly currentType = computed<MediaType>(() => {
    this.nav();
    const m = this.router.url.match(/^\/(?:browse|watch|search)\/(movie|tv)\b/);
    return (m?.[1] as MediaType) ?? 'movie';
  });

  protected setType(t: MediaType): void {
    this.query.set('');
    void this.router.navigate(['/browse', t]);
  }

  protected onInput(ev: Event): void {
    const target = ev.target;
    if (target instanceof HTMLInputElement) this.query.set(target.value);
  }

  protected submitSearch(): void {
    const q = this.query().trim();
    if (q) void this.router.navigate(['/search', this.currentType()], { queryParams: { q } });
  }
}
