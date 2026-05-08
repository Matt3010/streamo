import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopBarComponent } from '../../components/top-bar/top-bar.component';
import { BackgroundService } from '../../services/background.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [TopBarComponent, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (backdropUrl()) {
      <div class="app-backdrop" [style.background-image]="bgImage()"></div>
    }
    <main>
      <app-top-bar />
      <router-outlet />
    </main>
  `,
  styleUrl: './main-layout.component.css'
})
export class MainLayoutComponent {
  private readonly bg = inject(BackgroundService);

  protected readonly backdropUrl = this.bg.url;

  protected readonly bgImage = computed<string>(() => {
    const url = this.backdropUrl();
    return url ? `url("${url}")` : '';
  });
}
