import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterOutlet } from '@angular/router';
import { AuthModalComponent } from './components/auth-modal/auth-modal.component';
import { OfflineBannerComponent } from './components/offline-banner/offline-banner.component';
import { PullToRefreshComponent } from './components/pull-to-refresh/pull-to-refresh.component';
import { ToastComponent } from './ui/toast/toast.component';
import { AuthService } from './services/auth.service';
import { WatchlistLiveService } from './services/watchlist-live.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AuthModalComponent, OfflineBannerComponent, PullToRefreshComponent, ToastComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-offline-banner />
    <app-pull-to-refresh />
    <router-outlet />
    <app-auth-modal />
    <app-toast />
  `
})
export class AppComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Injected to eagerly initialize the WebSocket connection for live watchlist updates. */
  private readonly _watchlistLive = inject(WatchlistLiveService);
  private sawAuthenticated = false;

  constructor() {
    void this.auth.checkAuth();

    effect(() => {
      const user = this.auth.currentUser();
      const resolved = this.auth.authResolved();
      if (!resolved) return;

      if (user) {
        this.sawAuthenticated = true;
        return;
      }

      if (!this.sawAuthenticated) return;
      if (!routeRequiresAuth(this.router.routerState.snapshot.root)) return;

      void this.router.navigate(['/browse']);
    });
  }
}

function routeRequiresAuth(route: ActivatedRouteSnapshot | null): boolean {
  if (!route) return false;
  if (route.data['requiresAuth'] === true) return true;
  return route.children.some(child => routeRequiresAuth(child));
}
