export interface DomainLogger {
  info: (event: string, context?: unknown) => void;
  warn: (event: string, context?: unknown) => void;
  error: (event: string, context?: unknown) => void;
}

export function createDomainLogger(domain: string, write: (message: string) => void): DomainLogger {
  return {
    info(event: string, context?: unknown): void {
      write(formatDomainLog(domain, 'info', event, context));
    },
    warn(event: string, context?: unknown): void {
      write(formatDomainLog(domain, 'warn', event, context));
    },
    error(event: string, context?: unknown): void {
      write(formatDomainLog(domain, 'error', event, context));
    }
  };
}

function formatDomainLog(domain: string, level: 'info' | 'warn' | 'error', event: string, context?: unknown): string {
  const suffix = context === undefined ? '' : ` ${JSON.stringify(context)}`;
  return `[${domain}] level=${level} event=${event}${suffix}`;
}
