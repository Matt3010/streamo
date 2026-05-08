import { Injectable, signal } from '@angular/core';

/**
 * Holds the URL of the backdrop image rendered behind the whole app by
 * MainLayoutComponent. Pages that have a hero image (e.g. /watch) call
 * setUrl(...) when their item resolves and clear() on destroy/navigation
 * so the previous backdrop doesn't bleed into unrelated pages.
 */
@Injectable({ providedIn: 'root' })
export class BackgroundService {
  readonly url = signal<string | null>(null);

  setUrl(url: string | null): void {
    this.url.set(url);
  }

  clear(): void {
    this.url.set(null);
  }
}
