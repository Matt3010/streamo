import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LineChartComponent, type LineChartSeries } from '../../components/charts/line-chart.component';
import { HistoryService } from '../../services/history.service';

const DAYS = 90;
const MONTHS_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];

interface ChartState {
  labels: string[];
  episodes: number[];
  movies: number[];
}

/* Self-fetches unfiltered history so the chart reflects the user's full
 * activity regardless of the page's media filter. Aggregates into a
 * 90-day window keyed by local-day buckets — values stay at 0 for days
 * with no activity, which the line chart renders as a flat baseline. */
@Component({
  selector: 'app-history-activity-chart',
  standalone: true,
  imports: [LineChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './history-activity-chart.component.css',
  template: `
    @if (state(); as s) {
      <section class="activity-chart">
        <div class="activity-chart-header">
          <h3 class="activity-chart-title">Attivita ultimi 90 giorni</h3>
          <div class="activity-chart-legend">
            <span class="activity-chart-legend-item">
              <span class="activity-chart-legend-dot activity-chart-legend-episodes"></span>
              Episodi
            </span>
            <span class="activity-chart-legend-item">
              <span class="activity-chart-legend-dot activity-chart-legend-movies"></span>
              Film
            </span>
          </div>
        </div>
        <app-line-chart [series]="series()" [xLabels]="s.labels" />
      </section>
    }
  `
})
export class HistoryActivityChartComponent {
  private readonly history = inject(HistoryService);
  protected readonly state = signal<ChartState | null>(null);

  protected readonly series = computed<LineChartSeries[]>(() => {
    const s = this.state();
    if (!s) return [];
    return [
      { name: 'Episodi', color: '#9be7ae', values: s.episodes },
      { name: 'Film', color: '#e50914', values: s.movies }
    ];
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
