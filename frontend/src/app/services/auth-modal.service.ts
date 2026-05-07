import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthModalService {
  readonly visible = signal(false);

  open(): void {
    this.visible.set(true);
  }
}
