// Generate unique debug ID per page load for tracing
const DEBUG_ID = crypto.randomUUID();

export function getDebugId(): string {
  return DEBUG_ID;
}

export function debugLog(component: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${DEBUG_ID.slice(0, 8)}] [${component}]`;
  
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export function debugError(component: string, message: string, error?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${DEBUG_ID.slice(0, 8)}] [${component}]`;
  console.error(`${prefix} ${message}`, error);
}
