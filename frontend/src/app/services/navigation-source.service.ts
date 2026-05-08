import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

/**
 * Tracks the URL the user came from so page-level "Indietro" buttons can
 * return to it without relying on browser history (which is unreliable when
 * the user landed on the page via a deep link, refresh, or new tab).
 *
 * The "previous URL" is the route that was active immediately before the
 * current navigation finished — i.e., the page that contained the link or
 * card the user clicked to arrive here.
 */
@Injectable({ providedIn: 'root' })
export class NavigationSourceService {
  private readonly router = inject(Router);

  private previousUrl: string | null = null;
  private currentUrl: string | null = null;

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        this.previousUrl = this.currentUrl;
        this.currentUrl = e.urlAfterRedirects;
      });
  }

  /**
   * Navigate to the page that was active before the current one. If no
   * previous URL has been recorded (deep link / fresh tab), navigate to the
   * provided fallback route instead. Never invokes browser history.back().
   */
  goBack(fallback: string): void {
    const target = this.previousUrl ?? fallback;
    void this.router.navigateByUrl(target);
  }
}
