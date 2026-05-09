import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FloatingSearchComponent } from '../../components/floating-search/floating-search.component';
import { TopBarComponent } from '../../components/top-bar/top-bar.component';

@Component({
  selector: 'app-list-layout',
  standalone: true,
  imports: [TopBarComponent, FloatingSearchComponent, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <app-top-bar />
      <router-outlet />
    </main>
    <app-floating-search />
  `,
  styleUrl: './list-layout.component.css'
})
export class ListLayoutComponent {}
