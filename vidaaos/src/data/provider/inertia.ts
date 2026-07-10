import { decodeHTMLEntities } from './scoring';

/**
 * Extract and decode the Inertia `data-page="..."` JSON blob from an HTML page.
 * Port of ProviderClient.parseInertiaPage. Returns the parsed object or null.
 */
export function extractInertiaPage(html: string): any | null {
  const marker = 'data-page=';
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const after = html.substring(idx + marker.length);
  if (after.length === 0) return null;

  const quote = after[0];
  if (quote !== '"' && quote !== "'") return null;

  let value = '';
  let i = 1;
  while (i < after.length && after[i] !== quote) {
    value += after[i];
    i++;
  }
  if (value === '') return null;

  const json = decodeHTMLEntities(value);
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Normalize the Inertia `props.titles.titles` container, which can be a bare
 * array or wrapped in { data: [...] } / { titles: [...] }. Port of the Kotlin
 * ProviderTitlesContainerDeserializer.
 */
export function extractTitles(container: any): any[] {
  if (Array.isArray(container)) return container;
  if (container && typeof container === 'object') {
    if (Array.isArray(container.data)) return container.data;
    if (Array.isArray(container.titles)) return container.titles;
  }
  return [];
}