import { useEffect, useRef } from 'preact/hooks';

interface InfiniteScrollOpts {
  hasMore: () => boolean; // getter live (legge .value del signal)
  loading: () => boolean; // getter live
  loadMore: () => void;
  margin?: number; // px dal fondo per pre-caricare (default 400)
}

// Paginazione scroll-math sul container scrollabile referenziato da `ref`. Legge
// lo stato live a ogni evento, così il listener si attacca una sola volta ed è
// immune alla sostituzione del nodo (un sentinel IntersectionObserver si stacca
// durante lo swap Spinner<->griglia e diventa inerte — vedi la storia in
// SectionListScreen). Espone `nearBottom` per il pass fill-viewport dei chiamanti.
export function useInfiniteScroll<T extends HTMLElement>(opts: InfiniteScrollOpts) {
  const ref = useRef<T>(null);
  const margin = opts.margin ?? 400;

  const nearBottom = (): boolean => {
    const s = ref.current;
    return !!s && s.scrollHeight - s.scrollTop - s.clientHeight < margin;
  };

  useEffect(() => {
    const s = ref.current;
    if (!s) return;
    const onScroll = () => {
      if (opts.hasMore() && !opts.loading() && nearBottom()) opts.loadMore();
    };
    s.addEventListener('scroll', onScroll, { passive: true });
    return () => s.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, nearBottom };
}