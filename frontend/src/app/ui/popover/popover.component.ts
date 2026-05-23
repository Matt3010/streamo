import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  viewChild
} from '@angular/core';
import { IconComponent, type IconName } from '../icon/icon.component';

@Component({
  selector: 'ui-popover',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open() && anchor()) {
      <div class="ui-popover-backdrop" aria-hidden="true"></div>
      <div class="ui-popover"
           #panel
           [style.top.px]="panelTop()"
           [style.left.px]="panelLeft()"
           [style.width.px]="panelWidth()"
           [class.ui-popover-below]="placement() === 'below'">
        <span class="ui-popover-arrow"
              [style.left.px]="arrowLeft()"
              aria-hidden="true"></span>
        @if (title() || secondary() || icon()) {
          <div class="ui-popover-header" [class.ui-popover-header-with-icon]="!!icon()">
            @if (icon(); as iconName) {
              <span class="ui-popover-badge" aria-hidden="true">
                <app-icon [name]="iconName"></app-icon>
              </span>
            }
            <div class="ui-popover-copy">
              @if (title()) {
                <strong class="ui-popover-title">{{ title() }}</strong>
              }
              @if (secondary()) {
                <span class="ui-popover-secondary">{{ secondary() }}</span>
              }
            </div>
          </div>
        }
        <ng-content></ng-content>
      </div>
    }
  `,
  styleUrl: './popover.component.css'
})
export class UiPopoverComponent {
  /* Must match .ui-popover-arrow's width in popover.component.css —
   * otherwise the arrow tip ends up offset from the anchor centre by
   * (cssWidth - tsSize) / 2 pixels. */
  private readonly arrowSize = 18;
  private readonly edgePadding = 16;
  private readonly anchorGap = 8;
  /* Keep the arrow off the rounded corner curve, but not so far that
   * an anchor near the viewport edge ends up with the arrow visibly
   * offset from it. 6 lets the arrow approach the corner curve
   * without overlapping while still allowing accurate alignment. */
  private readonly arrowCornerClearance = 6;
  private readonly viewportTick = signal(0);
  readonly open = model.required<boolean>();
  readonly anchor = input<HTMLElement | null>(null);
  readonly width = input(228);
  readonly horizontalAlign = input<'center' | 'start' | 'end'>('center');
  readonly preferredPlacement = input<'above' | 'below'>('below');
  readonly title = input('');
  readonly secondary = input('');
  readonly icon = input<IconName | null>(null);
  readonly preferredHeight = input(96);
  readonly closed = output<void>();
  private readonly panel = viewChild<ElementRef<HTMLDivElement>>('panel');

  constructor() {
    effect((onCleanup) => {
      if (!this.open() || !this.anchor()) return;

      let frameId = 0;
      let lastRect = '';
      let lastViewport = '';

      const syncPosition = () => {
        const anchor = this.anchor();
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        const nextRect = `${rect.top}:${rect.left}:${rect.width}:${rect.height}`;
        const nextViewport = `${window.innerWidth}:${window.innerHeight}`;
        if (nextRect !== lastRect || nextViewport !== lastViewport) {
          lastRect = nextRect;
          lastViewport = nextViewport;
          this.viewportTick.update((value) => value + 1);
        }
      };

      const loop = () => {
        syncPosition();
        frameId = window.requestAnimationFrame(loop);
      };

      syncPosition();
      frameId = window.requestAnimationFrame(loop);
      onCleanup(() => window.cancelAnimationFrame(frameId));
    });
  }

  protected readonly panelWidth = computed(() =>
    Math.min(this.width(), window.innerWidth - this.edgePadding * 2)
  );
  protected readonly panelHeight = computed(() => {
    this.viewportTick();
    const panel = this.panel();
    return panel?.nativeElement.offsetHeight ?? this.preferredHeight();
  });

  protected readonly panelLeft = computed(() => {
    this.viewportTick();
    const anchor = this.anchor();
    if (!anchor) return 0;
    const rect = anchor.getBoundingClientRect();
    const width = this.panelWidth();
    const desired = this.horizontalAlign() === 'start'
      ? rect.left
      : this.horizontalAlign() === 'end'
        ? rect.right - width
        : rect.left + (rect.width / 2) - (width / 2);
    const min = this.edgePadding;
    const max = window.innerWidth - width - this.edgePadding;
    return Math.max(min, Math.min(desired, max));
  });

  protected readonly placement = computed<'above' | 'below'>(() => {
    this.viewportTick();
    const anchor = this.anchor();
    if (!anchor) return 'above';
    const rect = anchor.getBoundingClientRect();
    const spaceAbove = rect.top - this.edgePadding - this.anchorGap;
    const spaceBelow = window.innerHeight - rect.bottom - this.edgePadding - this.anchorGap;
    const needed = this.panelHeight();
    if (this.preferredPlacement() === 'above') {
      if (spaceAbove >= needed) return 'above';
      if (spaceBelow >= needed) return 'below';
      return spaceAbove >= spaceBelow ? 'above' : 'below';
    }
    if (spaceBelow >= needed) return 'below';
    if (spaceAbove >= needed) return 'above';
    return spaceBelow >= spaceAbove ? 'below' : 'above';
  });

  protected readonly panelTop = computed(() => {
    this.viewportTick();
    const anchor = this.anchor();
    if (!anchor) return 0;
    const rect = anchor.getBoundingClientRect();
    return this.placement() === 'above'
      ? Math.max(this.edgePadding, rect.top - this.panelHeight() - this.anchorGap)
      : Math.min(window.innerHeight - this.panelHeight() - this.edgePadding, rect.bottom + this.anchorGap);
  });

  protected readonly arrowLeft = computed(() => {
    this.viewportTick();
    const anchor = this.anchor();
    if (!anchor) return 24;
    const rect = anchor.getBoundingClientRect();
    const center = rect.left + (rect.width / 2);
    const relative = center - this.panelLeft();
    const halfArrow = this.arrowSize / 2;
    const min = this.arrowCornerClearance;
    const max = this.panelWidth() - this.arrowCornerClearance - this.arrowSize;
    return Math.max(min, Math.min(relative - halfArrow, max));
  });

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.dismiss();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.viewportTick.update((value) => value + 1);
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
