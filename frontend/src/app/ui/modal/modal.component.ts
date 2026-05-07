import { ChangeDetectionStrategy, Component, HostListener, effect, inject, input, model, output } from '@angular/core';
import { IconComponent } from '../../components/icon/icon.component';
import { BodyScrollLockService } from '../../services/body-scroll-lock.service';

@Component({
  selector: 'ui-modal',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="modal active" (click)="onBackdropClick($event)">
        <div class="modal-content" [class.ui-modal-sm]="size() === 'sm'">
          <div class="modal-header">
            <h3>{{ title() }}</h3>
            <div class="modal-actions">
              <ng-content select="[modalActions]"></ng-content>
              <button class="close-btn" aria-label="Chiudi" (click)="dismiss()">
                <app-icon name="close"></app-icon>
              </button>
            </div>
          </div>
          <ng-content></ng-content>
        </div>
      </div>
    }
  `,
  styleUrl: './modal.component.css'
})
export class UiModalComponent {
  private readonly scrollLock = inject(BodyScrollLockService);

  readonly open = model.required<boolean>();
  readonly title = input<string>('');
  readonly size = input<'sm' | 'md'>('md');
  readonly closed = output<void>();

  constructor() {
    effect(onCleanup => {
      if (this.open()) {
        this.scrollLock.acquire();
        onCleanup(() => this.scrollLock.release());
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.dismiss();
  }

  protected onBackdropClick(ev: MouseEvent): void {
    if (ev.target === ev.currentTarget) this.dismiss();
  }

  protected dismiss(): void {
    this.open.set(false);
    this.closed.emit();
  }
}
