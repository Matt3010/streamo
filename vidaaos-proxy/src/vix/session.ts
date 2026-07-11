// In-memory session store. The app never sees raw upstream URLs — only opaque
// {sessionId, sourceId} handles. The session holds the resolved upstream master
// URLs (token/expires already appended) + the headers to send upstream.
//
// Idle sessions expire after SESSION_TTL_MS and are swept periodically.
import assert from 'node:assert/strict';

export interface SessionSource {
  id: string;
  label: string;
  upstreamMaster: string;
}
export interface Session {
  id: string;
  sources: SessionSource[];
  headers: Record<string, string>;
  viaWarp: boolean;
  lastAccessedAt: number;
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const sessions = new Map<string, Session>();

export function createSession(s: Omit<Session, 'id' | 'lastAccessedAt'>): Session {
  const id = makeId();
  const session: Session = { ...s, id, lastAccessedAt: Date.now() };
  sessions.set(id, session);
  return session;
}
export function getSession(id: string): Session | undefined {
  const s = sessions.get(id);
  if (!s) return undefined;
  // Lazy expiry: return undefined if expired, and delete.
  if (Date.now() - s.lastAccessedAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return undefined;
  }
  s.lastAccessedAt = Date.now();
  return s;
}
export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

// Periodic sweep of expired sessions. Started once on module load.
let sweepStarted = false;
export function startSweep(): void {
  if (sweepStarted) return;
  sweepStarted = true;
  const sweep = () => {
    const now = Date.now();
    sessions.forEach((s, id) => {
      if (now - s.lastAccessedAt > SESSION_TTL_MS) sessions.delete(id);
    });
  };
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
  // Also sweep once on startup in case the process was idle.
  sweep();
}

// 16-byte random id, base16. Crypto.randomUUID would be fine too but
// keeps it dependency-free. Collision space is ample for a single-host proxy.
function makeId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// Auto-start the sweep on first import.
startSweep();

if (process.argv[1]?.endsWith('session.ts')) {
  const session = createSession({ sources: [], headers: {}, viaWarp: false });
  session.lastAccessedAt = Date.now() - SESSION_TTL_MS + 1_000;
  assert(getSession(session.id));
  session.lastAccessedAt = Date.now() - SESSION_TTL_MS - 1;
  assert.equal(getSession(session.id), undefined);
  console.log('session.ts demo: OK');
}
