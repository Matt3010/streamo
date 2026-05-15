import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { LineChartComponent, type LineChartSeries } from '../../components/charts/line-chart.component';
import { HistoryService } from '../../services/history.service';

export type ChartMediaFilter = 'all' | 'tv' | 'movie';

const DAYS = 90;
const MONTHS_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];

const COLOR_LINE = '#e50914';

interface ChartState {
  labels: string[];
  episodes: number[];
  movies: number[];
}

/* Self-fetches the user's full history so the dataset stays stable
 * across filter changes — the visible total is then narrowed down
 * via the mediaFilter input. Exposes totalLabel for the parent's
 * "Statistiche" section header so the chart stays responsible for
 * its own dataset while the parent owns the section presentation. */
@Component({
  selector: 'app-history-activity-chart',
  standalone: true,
  imports: [LineChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './history-activity-chart.component.css',
  template: `
    @if (state(); as s) {
      <app-line-chart class="activity-chart" [series]="series()" [xLabels]="s.labels" [height]="160" />
    }
  `
})
export class HistoryActivityChartComponent {
  private readonly history = inject(HistoryService);
  readonly mediaFilter = input<ChartMediaFilter>('all');
  protected readonly state = signal<ChartState | null>(null);

  protected readonly series = computed<LineChartSeries[]>(() => {
    const s = this.state();
    if (!s) return [];
    const values = s.labels.map((_, i) => this.dailyTotal(s, i));
    return [{ name: seriesName(this.mediaFilter()), color: COLOR_LINE, values }];
  });

  readonly totalLabel = computed(() => {
    const s = this.state();
    if (!s) return '0 visualizzazioni totali';
    let total = 0;
    for (let i = 0; i < s.labels.length; i++) total += this.dailyTotal(s, i);
    return `${total} visualizzazioni totali`;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const items = await this.history.list();
    this.state.set(aggregate(items));
  }

  private dailyTotal(s: ChartState, i: number): number {
    const filter = this.mediaFilter();
    const ep = filter === 'movie' ? 0 : s.episodes[i];
    const mv = filter === 'tv' ? 0 : s.movies[i];
    return ep + mv;
  }
}

function seriesName(filter: ChartMediaFilter): string {
  if (filter === 'tv') return 'Episodi';
  if (filter === 'movie') return 'Film';
  return 'Visualizzazioni';
}

function aggregate(items: { watched_at: number; media_type: string }[]): ChartState {
  const today = startOfLocalDay(new Date());
  const labels: string[] = [];
  const episodes = new Array<number>(DAYS).fill(0);
  const movies = new Array<number>(DAYS).fill(0);
  const indexByDay = new Map<number, number>();

  for (let i = 0; i < DAYS; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - (DAYS - 1 - i));
    labels.push(formatDayLabel(d));
    indexByDay.set(d.getTime(), i);
  }

  for (const item of items) {
    if (!item.watched_at) continue;
    const day = startOfLocalDay(new Date(item.watched_at * 1000)).getTime();
    const idx = indexByDay.get(day);
    if (idx === undefined) continue;
    if (item.media_type === 'tv') {
      episodes[idx]++;
    } else if (item.media_type === 'movie') {
      movies[idx]++;
    }
  }

  return { labels, episodes, movies };
}

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function formatDayLabel(d: Date): string {
  return `${d.getDate()} ${MONTHS_IT[d.getMonth()]} ${d.getFullYear()}`;
}
