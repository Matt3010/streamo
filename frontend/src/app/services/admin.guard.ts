import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

// Gates routes that require super admin access (currently /admin).
// Awaits AuthService.checkAuth() to ensure user state is loaded before
// checking admin status. Non-admins are bounced to /browse.
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.checkAuth();
  if (auth.isAdmin()) return true;

  return router.createUrlTree(['/browse']);
};
