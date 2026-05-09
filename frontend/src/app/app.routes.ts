import { Routes } from '@angular/router';
import { MainLayoutComponent } from './layouts/main-layout/main-layout.component';
import { ListLayoutComponent } from './layouts/list-layout/list-layout.component';
import { requireAuthGuard } from './services/auth.guard';
import { adminGuard } from './services/admin.guard';

export const routes: Routes = [
  {
    path: '',
    component: MainLayoutComponent,
    children: [
      { path: '', redirectTo: 'browse', pathMatch: 'full' },
      // Legacy /browse/:type URLs (from when the home had a Film/Serie TV
      // switcher) redirect to the unified /browse.
      { path: 'browse/movie', redirectTo: 'browse', pathMatch: 'full' },
      { path: 'browse/tv',    redirectTo: 'browse', pathMatch: 'full' },
      {
        path: 'browse',
        loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent)
      },
      {
        path: 'watch/:type/:id',
        canActivate: [requireAuthGuard],
        loadComponent: () => import('./pages/watch/watch.component').then(m => m.WatchComponent)
      },
      {
        path: 'search',
        loadComponent: () => import('./pages/search-results/search-results.component').then(m => m.SearchResultsComponent)
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/admin/admin.component').then(m => m.AdminComponent)
      }
    ]
  },
  {
    path: 'list',
    component: ListLayoutComponent,
    children: [
      {
        path: ':kind',
        loadComponent: () => import('./pages/user-list-view/user-list-view.component').then(m => m.UserListViewComponent)
      }
    ]
  },
  { path: '**', redirectTo: 'browse' }
];
