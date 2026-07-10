import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// One local service: the proxy owns the WARP sidecar and its lifecycle.
if (process.env.WARP_AUTOSTART !== '0') {
  process.env.WARP_SOCKS_URL ||= 'socks5://127.0.0.1:40000';
  const warp = spawn('go', ['run', './cmd/streamo-warp'], {
    cwd: resolve(process.cwd(), '../wireproxykit'),
    stdio: 'inherit',
    windowsHide: true
  });
  const stop = () => warp.kill();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

await import('./server');
