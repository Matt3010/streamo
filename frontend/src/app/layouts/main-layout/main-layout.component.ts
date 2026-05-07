import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopBarComponent } from '../../components/top-bar/top-bar.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [TopBarComponent, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <app-top-bar />
      <router-outlet />
    </main>
  `
})
export class MainLayoutComponent {}
