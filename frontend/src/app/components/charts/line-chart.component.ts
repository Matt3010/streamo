import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  signal,
  viewChild
} from '@angular/core';

export interface LineChartSeries {
  name: string;
  color: string;
  values: number[];
}

interface RenderedSeries {
  name: string;
  color: string;
  values: number[];
  points: { x: number; y: number }[];
  linePath: string;
  areaPath: string;
  gradientId: string;
}

const VIEW_W = 1000;
const PAD_TOP = 10;
const PAD_BOTTOM = 10;

let instanceCounter = 0;

/* Generic multi-series line chart rendered as inline SVG. Smooth curves
 * are produced by converting a Catmull-Rom spline through the data
 * points into cubic Bezier segments. Tooltip hit-testing uses pixel
 * geometry (getBoundingClientRect) so it survives the SVG viewBox
 * scaling. The y-axis is auto-ranged but anchored to a minimum of 1 so
 * an all-zero dataset still renders as a flat baseline rather than a
 * collapsed strip. */
@Component({
  selector: 'app-line-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './line-chart.component.css',
  template: `
    <div class="line-chart" [style.height.px]="height()">
      <svg
        #svg
        class="line-chart-svg"
        [attr.viewBox]="viewBox()"
        preserveAspectRatio="none"
        (mousemove)="onMove($event)"
        (mouseleave)="hover.set(null)">
        <defs>
          @for (s of rendered(); track s.name) {
            <linearGradient [attr.id]="s.gradientId" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" [attr.stop-color]="s.color" stop-opacity="0.32" />
              <stop offset="1" [attr.stop-color]="s.color" stop-opacity="0" />
            </linearGradient>
          }
        </defs>
        @for (s of rendered(); track s.name) {
          <path class="line-chart-area" [attr.d]="s.areaPath" [attr.fill]="'url(#' + s.gradientId + ')'"></path>
          <path class="line-chart-line" [attr.d]="s.linePath" [attr.stroke]="s.color"></path>
        }
        @if (hover() !== null) {
          <line
            class="line-chart-cursor"
            [attr.x1]="cursorX()"
            [attr.x2]="cursorX()"
            y1="0"
            [attr.y2]="viewH()" />
          @for (s of rendered(); track s.name) {
            <circle
              class="line-chart-dot"
              [attr.cx]="cursorX()"
              [attr.cy]="s.points[hover()!].y"
              r="5"
              [attr.fill]="s.color" />
          }
        }
      </svg>
      @if (hover() !== null) {
        <div
          class="line-chart-tooltip"
          [style.left.%]="tooltipPercent()"
          [class.line-chart-tooltip-right]="tooltipFlip()">
          <div class="line-chart-tooltip-date">{{ xLabels()[hover()!] }}</div>
          @for (s of rendered(); track s.name) {
            <div class="line-chart-tooltip-row">
              <span class="line-chart-tooltip-dot" [style.background]="s.color"></span>
              <span class="line-chart-tooltip-name">{{ s.name }}</span>
              <span class="line-chart-tooltip-value">{{ s.values[hover()!] }}</span>
            </div>
          }
        </div>
      }
    </div>
  `
})
export class LineChartComponent {
  readonly series = input.required<LineChartSeries[]>();
  readonly xLabels = input.required<string[]>();
  readonly height = input(140);
  /* Gaussian smoothing sigma applied to the values before path
   * generation. 0 = no smoothing (sharp peaks). 2-3 = rolling-hills
   * look. Tooltip always shows raw values regardless. */
  readonly smoothing = input(0);

  private readonly instanceId = ++instanceCounter;
  protected readonly hover = signal<number | null>(null);
  protected readonly svgRef = viewChild.required<ElementRef<SVGSVGElement>>('svg');

  protected readonly viewH = computed(() => this.height());
  protected readonly viewBox = computed(() => `0 0 ${VIEW_W} ${this.viewH()}`);

  /* Compute the rendered geometry for each series. maxY is shared across
   * series (after smoothing) so the two lines stay on the same scale. */
  protected readonly rendered = computed<RenderedSeries[]>(() => {
    const series = this.series();
    const labelCount = this.xLabels().length;
    if (series.length === 0 || labelCount === 0) return [];

    const sigma = this.smoothing();
    const smoothed = series.map((s) => sigma > 0 ? gaussianSmooth(s.values, sigma) : s.values);
    const maxY = Math.max(1, ...smoothed.flat());
    const usableH = this.viewH() - PAD_TOP - PAD_BOTTOM;

    return series.map((s, idx) => {
      const plotValues = smoothed[idx];
      const points = plotValues.map((v, i) => ({
        x: labelCount === 1 ? VIEW_W / 2 : (i / (labelCount - 1)) * VIEW_W,
        y: PAD_TOP + (1 - v / maxY) * usableH
      }));
      const linePath = catmullRomPath(points);
      const lastX = points[points.length - 1].x;
      const firstX = points[0].x;
      const bottomY = this.viewH() - PAD_BOTTOM + 0.5;
      const areaPath = `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
      const gradientId = `line-chart-grad-${this.instanceId}-${idx}`;
      return { name: s.name, color: s.color, values: s.values, points, linePath, areaPath, gradientId };
    });
  });

  protected cursorX(): number {
    const i = this.hover();
    if (i === null) return 0;
    const r = this.rendered();
    if (r.length === 0) return 0;
    return r[0].points[i].x;
  }

  protected tooltipPercent(): number {
    const i = this.hover();
    const len = this.xLabels().length;
    if (i === null || len < 2) return 50;
    return (i / (len - 1)) * 100;
  }

  protected tooltipFlip(): boolean {
    return this.tooltipPercent() > 70;
  }

  protected onMove(event: MouseEvent): void {
    const rect = this.svgRef().nativeElement.getBoundingClientRect();
    if (rect.width === 0) return;
    const labels = this.xLabels();
    if (labels.length === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (labels.length - 1));
    this.hover.set(Math.max(0, Math.min(labels.length - 1, idx)));
  }
}

/* Symmetric Gaussian smoothing with edge clamping. Pre-builds the kernel
 * once and reuses it for every input index. Output[i] is a weighted
 * average of the values within ±2σ of i. */
function gaussianSmooth(values: number[], sigma: number): number[] {
  if (sigma <= 0 || values.length === 0) return values.slice();
  const radius = Math.max(1, Math.ceil(sigma * 2));
  const kernel: number[] = [];
  let kernelSum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    kernelSum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kernelSum;

  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    let v = 0;
    for (let j = -radius; j <= radius; j++) {
      const idx = Math.max(0, Math.min(values.length - 1, i + j));
      v += values[idx] * kernel[j + radius];
    }
    out[i] = v;
  }
  return out;
}

/* Catmull-Rom spline through the points, converted to cubic Bezier
 * segments. Control points are picked with the classic 1/6 factor so
 * the curve passes through each point with C1 continuity. */
function catmullRomPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}
