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
        <span class="ui-popover-arrow"
              [style.left.px]="arrowLeft()"
              aria-hidden="true"></span>
        @if (title() || secondary()) {
          <div class="ui-popover-header">
            @if (title()) {
              <strong class="ui-popover-title">{{ title() }}</strong>
            }
            @if (secondary()) {
              <span class="ui-popover-secondary">{{ secondary() }}</span>
            }
          </div>
        }
        <ng-content></ng-content>
      </div>
    }
  `,
  styleUrl: './popover.component.css'
})
export class UiPopoverComponent {
  private readonly arrowSize = 14;
  readonly open = model.required<boolean>();
  readonly anchor = input<HTMLElement | null>(null);
  readonly width = input(228);
  readonly title = input('');
  readonly secondary = input('');
  readonly preferredHeight = input(96);
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
    const spaceAbove = rect.top - 12;
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const needed = this.preferredHeight();
    if (spaceBelow >= needed) return 'below';
    if (spaceAbove >= needed) return 'above';
    return spaceBelow > spaceAbove ? 'below' : 'above';
  });

  protected readonly panelTop = computed(() => {
    const anchor = this.anchor();
    if (!anchor) return 0;
    const rect = anchor.getBoundingClientRect();
    return this.placement() === 'above'
      ? Math.max(12, rect.top - 12)
      : Math.min(window.innerHeight - 12, rect.bottom + 12);
  });

  protected readonly arrowLeft = computed(() => {
    const anchor = this.anchor();
    if (!anchor) return 24;
    const rect = anchor.getBoundingClientRect();
    const center = rect.left + (rect.width / 2);
    const relative = center - this.panelLeft();
    const halfArrow = this.arrowSize / 2;
    const min = 18;
    const max = this.panelWidth() - 18;
    return Math.max(min, Math.min(relative - halfArrow, max - this.arrowSize));
  });

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.dismiss();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (!this.open()) return;
    const active = document.activeElement;
    if (active instanceof Element && active.closest('.ui-popover')) return;
    this.dismiss();
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
