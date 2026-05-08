import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';
import { AuthModalService } from './auth-modal.service';
import { ToastService } from './toast.service';

// Gates routes that require a logged-in user (currently /watch/:type/:id).
// Awaits the cached AuthService.checkAuth() so a hard refresh on a
// protected URL doesn't redirect prematurely while /api/auth/me is still
// in flight. Unauthenticated users are bounced back to /browse with the
// login modal opened and a toast explaining why.
export const requireAuthGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const modal = inject(AuthModalService);
  const toast = inject(ToastService);

  await auth.checkAuth();
  if (auth.isLoggedIn()) return true;

  toast.show('Accedi per guardare film e serie TV');
  modal.open();
  return router.createUrlTree(['/browse']);
};
