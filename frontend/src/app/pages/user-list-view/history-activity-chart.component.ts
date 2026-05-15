import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { LineChartComponent, type LineChartSeries } from '../../components/charts/line-chart.component';
import { HistoryService } from '../../services/history.service';

export type ChartMediaFilter = 'all' | 'tv' | 'movie';

const DAYS = 90;
const MONTHS_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];

const COLOR_EPISODES = '#9be7ae';
const COLOR_MOVIES = '#e50914';

interface ChartState {
  labels: string[];
  episodes: number[];
  movies: number[];
}

/* Self-fetches the user's full history so the dataset stays stable
 * across filter changes — the visible series is then narrowed down
 * via the mediaFilter input so the chart matches what the page
 * currently shows. */
@Component({
  selector: 'app-history-activity-chart',
  standalone: true,
  imports: [LineChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './history-activity-chart.component.css',
  template: `
    @if (state(); as s) {
      <app-line-chart class="activity-chart" [series]="series()" [xLabels]="s.labels" [height]="110" [smoothing]="2.6" />
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
    const filter = this.mediaFilter();
    const out: LineChartSeries[] = [];
    if (filter !== 'movie') {
      out.push({ name: 'Episodi', color: COLOR_EPISODES, values: s.episodes });
    }
    if (filter !== 'tv') {
      out.push({ name: 'Film', color: COLOR_MOVIES, values: s.movies });
    }
    return out;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const items = await this.history.list();
    this.state.set(aggregate(items));
  }
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
