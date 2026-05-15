import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  input,
  model,
  signal,
  viewChild,
  viewChildren
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export interface UiSelectOption<T = unknown> {
  value: T;
  label: string;
}

let instanceCounter = 0;

/* Fully custom select: trigger button styled like a ui-input, panel
 * positioned via fixed coords against the trigger's bounding rect.
 * Dismisses on click outside, Esc, and on scroll/resize (matching
 * the ui-popover behaviour). Keyboard nav (Up/Down/Enter) only
 * intercepts when the trigger has focus or the panel is open, so
 * arrow keys elsewhere on the page are untouched. */
@Component({
  selector: 'ui-select',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './select.component.css',
  template: `
    <button
      #trigger
      type="button"
      class="ui-select-trigger"
      [class.ui-select-trigger-compact]="variant() === 'compact'"
      [class.ui-select-trigger-open]="open()"
      [attr.aria-haspopup]="'listbox'"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="panelId"
      [disabled]="disabled()"
      (click)="toggle()"
      (keydown.arrowDown)="onTriggerArrowDown($event)"
      (keydown.arrowUp)="onTriggerArrowUp($event)"
      (keydown.enter)="onTriggerEnter($event)">
      <span class="ui-select-label" [class.ui-select-placeholder]="!selectedOption()">
        {{ selectedOption()?.label ?? placeholder() }}
      </span>
      <app-icon name="chevron-down" class="ui-select-chevron"></app-icon>
    </button>

    @if (open()) {
      <ul
        #panel
        [id]="panelId"
        class="ui-select-panel"
        role="listbox"
        [style.top.px]="panelTop()"
        [style.left.px]="panelLeft()"
        [style.min-width.px]="panelMinWidth()">
        @for (opt of options(); track opt.value; let i = $index) {
          <li>
            <button
              #optionBtn
              type="button"
              role="option"
              class="ui-select-option"
              [class.is-selected]="opt.value === value()"
              [class.is-highlighted]="i === highlighted()"
              [attr.aria-selected]="opt.value === value()"
              (click)="select(opt)"
              (mouseenter)="highlighted.set(i)"
              (keydown.arrowDown)="onPanelArrowDown($event)"
              (keydown.arrowUp)="onPanelArrowUp($event)"
              (keydown.enter)="onPanelEnter($event, opt)">
              {{ opt.label }}
            </button>
          </li>
        }
      </ul>
    }
  `
})
export class UiSelectComponent<T = unknown> {
  readonly options = input.required<readonly UiSelectOption<T>[]>();
  readonly value = model<T | null>(null);
  readonly placeholder = input('Seleziona…');
  readonly variant = input<'default' | 'compact'>('default');
  readonly disabled = input(false);

  protected readonly panelId = `ui-select-panel-${++instanceCounter}`;
  protected readonly open = signal(false);
  protected readonly highlighted = signal(-1);
  private readonly viewportTick = signal(0);

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly optionButtons = viewChildren<ElementRef<HTMLButtonElement>>('optionBtn');

  protected readonly selectedOption = computed(() => {
    const v = this.value();
    return this.options().find((o) => o.value === v) ?? null;
  });

  protected readonly panelTop = computed(() => {
    this.viewportTick();
    if (!this.open()) return 0;
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    return rect.bottom + 4;
  });

  protected readonly panelLeft = computed(() => {
    this.viewportTick();
    if (!this.open()) return 0;
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    return rect.left;
  });

  protected readonly panelMinWidth = computed(() => {
    this.viewportTick();
    if (!this.open()) return 0;
    return this.trigger().nativeElement.offsetWidth;
  });

  constructor() {
    /* When the panel opens, focus the highlighted option so subsequent
     * Up/Down keystrokes reach the panel-scoped handlers without the
     * user needing to tab. */
    effect(() => {
      if (!this.open()) return;
      const idx = this.highlighted();
      if (idx < 0) return;
      queueMicrotask(() => {
        const btns = this.optionButtons();
        btns[idx]?.nativeElement.focus();
      });
    });
  }

  protected toggle(): void {
    if (this.disabled()) return;
    if (this.open()) this.close();
    else this.openPanel();
  }

  private openPanel(): void {
    const idx = this.options().findIndex((o) => o.value === this.value());
    this.highlighted.set(idx >= 0 ? idx : 0);
    this.open.set(true);
  }

  private close(): void {
    this.open.set(false);
    this.highlighted.set(-1);
  }

  protected select(opt: UiSelectOption<T>): void {
    this.value.set(opt.value);
    this.close();
    queueMicrotask(() => this.trigger().nativeElement.focus());
  }

  protected onTriggerArrowDown(event: Event): void {
    event.preventDefault();
    if (this.open()) return;
    this.openPanel();
  }

  protected onTriggerArrowUp(event: Event): void {
    event.preventDefault();
    if (this.open()) return;
    this.openPanel();
  }

  protected onTriggerEnter(event: Event): void {
    if (this.open()) return;
    event.preventDefault();
    this.openPanel();
  }

  protected onPanelArrowDown(event: Event): void {
    event.preventDefault();
    const n = this.options().length;
    if (n === 0) return;
    this.highlighted.update((i) => (i + 1) % n);
  }

  protected onPanelArrowUp(event: Event): void {
    event.preventDefault();
    const n = this.options().length;
    if (n === 0) return;
    this.highlighted.update((i) => (i <= 0 ? n - 1 : i - 1));
  }

  protected onPanelEnter(event: Event, opt: UiSelectOption<T>): void {
    event.preventDefault();
    this.select(opt);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) {
      this.close();
      queueMicrotask(() => this.trigger().nativeElement.focus());
    }
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    if (!this.open()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (this.trigger().nativeElement.contains(target)) return;
    if (target instanceof Element && target.closest('.ui-select-panel')) return;
    this.close();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (!this.open()) return;
    const active = document.activeElement;
    if (active instanceof Element && active.closest('.ui-select-panel')) return;
    this.close();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.viewportTick.update((v) => v + 1);
  }
}
