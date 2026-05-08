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

  // Stack of URLs visited, *excluding* the current page. Each forward
  // navigation pushes the previously-active URL; goBack() pops one entry.
  // This prevents the infinite "Indietro → A → Indietro → B → A → B…" loop
  // that a single previousUrl would cause: when the goBack-triggered
  // navigation lands on its target, isGoingBack tells us not to push the
  // page we just came from back onto the stack.
  private stack: string[] = [];
  private currentUrl: string | null = null;
  private isGoingBack = false;

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        if (this.isGoingBack) {
          this.isGoingBack = false;
        } else if (this.currentUrl !== null && this.currentUrl !== e.urlAfterRedirects) {
          this.stack.push(this.currentUrl);
        }
        this.currentUrl = e.urlAfterRedirects;
      });
  }

  /**
   * Navigate to the page that was active before the current one. If the
   * stack is empty (deep link / fresh tab), navigate to the provided
   * fallback route instead. Never invokes browser history.back().
   */
  goBack(fallback: string): void {
    const target = this.stack.pop() ?? fallback;
    this.isGoingBack = true;
    void this.router.navigateByUrl(target);
  }
}
