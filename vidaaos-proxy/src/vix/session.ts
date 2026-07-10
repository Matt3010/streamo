// In-memory session store. The app never sees raw upstream URLs — only opaque
// {sessionId, sourceId} handles. The session holds the resolved upstream master
// URLs (token/expires already appended) + the headers to send upstream.
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
  createdAt: number;
}

const sessions = new Map<string, Session>();

export function createSession(s: Omit<Session, 'id' | 'createdAt'>): Session {
  const id = makeId();
  const session: Session = { ...s, id, createdAt: Date.now() };
  sessions.set(id, session);
  return session;
}
export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}
export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

// ponytail: 16-byte random id, base16. Crypto.randomUUID would be fine too but
// keeps it dependency-free. Collision space is ample for a single-host dev proxy.
function makeId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}