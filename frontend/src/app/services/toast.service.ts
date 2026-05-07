import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal<string | null>(null);
  private timer: number | null = null;

  show(message: string): void {
    this.message.set(message);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.message.set(null), 3000);
  }
}
