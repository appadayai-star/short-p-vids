// Production-ready structured logging for feed diagnostics
// Logs are stored in memory and can be viewed by admins

export type LogLevel = 'info' | 'warn' | 'error';

export interface FeedLogEntry {
  timestamp: number;
  level: LogLevel;
  event: string;
  data?: Record<string, unknown>;
  deltaMs?: number;
}

// In-memory log buffer (last 100 entries)
const logBuffer: FeedLogEntry[] = [];
const MAX_LOGS = 100;
let bootTime = performance.now();
let requestId = `req_${Date.now().toString(36)}`;

// Generate new request ID (call on each page load/refresh)
export function newRequestId(): string {
  bootTime = performance.now();
  requestId = `req_${Date.now().toString(36)}`;
  return requestId;
}

export function feedLog(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const now = performance.now();
  const entry: FeedLogEntry = {
    timestamp: Date.now(),
    level,
    event,
    data: { ...data, requestId },
    deltaMs: Math.round(now - bootTime),
  };
  
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }
  
  // Also log to console in dev
  if (import.meta.env.DEV) {
    const prefix = `[${entry.deltaMs}ms] ${event}`;
    if (level === 'error') {
      console.error(prefix, data);
    } else if (level === 'warn') {
      console.warn(prefix, data);
    } else {
      console.log(prefix, data);
    }
  }
}

export function getFeedLogs(): FeedLogEntry[] {
  return [...logBuffer];
}

export function getLastError(): FeedLogEntry | undefined {
  return [...logBuffer].reverse().find(e => e.level === 'error');
}

export function clearLogs(): void {
  logBuffer.length = 0;
}

// Convenience functions
export const log = {
  info: (event: string, data?: Record<string, unknown>) => feedLog('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => feedLog('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => feedLog('error', event, data),
};
