import type { VNode } from 'preact';

export const ICON_PATHS = {
  playArrow: 'M8 5v14l11-7z',
  bookmark:
    'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z',
  bookmarkBorder:
    'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z',
  sort: 'M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z',
  filterList:
    'M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z',
  thumbUp:
    'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.47 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1.91z',
  history:
    'M13 3a9 9 0 0 0-9 9H1l3.96 3.96L9 21v-3a9 9 0 0 0 9-9c0-4.97-4.03-9-9-9zm1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H14z',
  playCircle:
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zM9.5 16.5v-9l7 4.5l-7 4.5z',
  arrowForward: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
};

export function InlineIcon({
  path,
  size = 20,
  className = '',
}: {
  path: string;
  size?: number;
  className?: string;
}): VNode {
  return (
    <svg
      class={`inline-icon${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
    >
      <path d={path} />
    </svg>
  );
}

export function SectionTitle({
  title,
  icon,
}: {
  title: string;
  icon?: string;
}): VNode {
  return (
    <div class="rail-title">
      {icon && (
        <span class="icon-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d={icon} />
          </svg>
        </span>
      )}
      {title}
    </div>
  );
}
