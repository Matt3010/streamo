import type { VNode } from 'preact';

// Flat ambient backdrop behind every screen (Android ui/tv is flat — no blur).
// Phase 5 will derive a gradient from the current screen's poster; for now a
// solid dark surface.
export function AmbientBackground({ poster }: { poster?: string }) {
  return (
    <div
      className="ambient"
      style={
        poster
          ? {
              backgroundImage: `radial-gradient(circle at 50% 30%, rgba(40,40,45,0.6), var(--surface-0) 70%), url(${poster})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'saturate(0.8)'
            }
          : undefined
      }
    >
      {poster ? <div className="ambient" /> : null}
    </div>
  );
}