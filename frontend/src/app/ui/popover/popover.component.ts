import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  model,
  output
} from '@angular/core';

@Component({
  selector: 'ui-popover',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open() && anchor()) {
      <div class="ui-popover-backdrop" aria-hidden="true"></div>
      <div class="ui-popover"
           [style.top.px]="panelTop()"
           [style.left.px]="panelLeft()"
           [style.width.px]="panelWidth()"
           [class.ui-popover-below]="placement() === 'below'">
        <ng-content></ng-content>
      </div>
    }
  `,
  styleUrl: './popover.component.css'
})
export class UiPopoverComponent {
  readonly open = model.required<boolean>();
  readonly anchor = input<HTMLElement | null>(null);
  readonly width = input(248);
  readonly closed = output<void>();
  protected readonly panelWidth = computed(() => Math.min(this.width(), window.innerWidth - 24));

  protected readonly panelLeft = computed(() => {
    const anchor = this.anchor();
    if (!anchor) return 0;
    const rect = anchor.getBoundingClientRect();
    const width = this.panelWidth();
    const desired = rect.left + (rect.width / 2) - (width / 2);
    const min = 12;
    const max = window.innerWidth - width - 12;
    return Math.max(min, Math.min(desired, max));
  });

  protected readonly placement = computed<'above' | 'below'>(() => {
    const anchor = this.anchor();
    if (!anchor) return 'above';
    const rect = anchor.getBoundingClientRect();
    return rect.top < 170 ? 'below' : 'above';
  });

  protected readonly panelTop = computed(() => {
    const anchor = this.anchor();
    if (!anchor) return 0;
    const rect = anchor.getBoundingClientRect();
    return this.placement() === 'above'
      ? Math.max(12, rect.top - 12)
      : Math.min(window.innerHeight - 12, rect.bottom + 12);
  });

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.dismiss();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.open()) this.dismiss();
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    if (!this.open()) return;
    const target = event.target;
    const anchor = this.anchor();
    if (!(target instanceof Node)) return;
    if (anchor?.contains(target)) return;
    const panel = target instanceof Element ? target.closest('.ui-popover') : null;
    if (panel) return;
    this.dismiss();
  }

  private dismiss(): void {
    this.open.set(false);
    this.closed.emit();
  }
}
