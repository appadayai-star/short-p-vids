// Fail-fast fetch with timeout, retry, and fallback support

import { log } from './feedLogger';

const TIMEOUT_MS = 8000;
const RETRY_DELAYS = [400, 1200]; // Exponential backoff

interface FetchOptions extends RequestInit {
  timeout?: number;
  retries?: number;
}

export class FetchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchTimeoutError';
  }
}

export async function fetchWithTimeout(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { timeout = TIMEOUT_MS, retries = 2, ...fetchOptions } = options;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      log.info('FETCH_ATTEMPT', { url: url.substring(0, 100), attempt });
      
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      log.info('FETCH_OK', { attempt, status: response.status });
      return response;
      
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (error instanceof Error && error.name === 'AbortError') {
        log.warn('FETCH_TIMEOUT', { attempt, timeout });
        lastError = new FetchTimeoutError(`Request timed out after ${timeout}ms`);
      } else {
        log.warn('FETCH_ERROR', { attempt, error: lastError.message });
      }
      
      // Wait before retry (if not last attempt)
      if (attempt < retries) {
        const delay = RETRY_DELAYS[attempt] || 1000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  
  log.error('FETCH_FAILED', { url: url.substring(0, 100), error: lastError?.message });
  throw lastError || new Error('Fetch failed');
}

// Invoke edge function with timeout
export async function invokeWithTimeout<T>(
  supabase: { functions: { invoke: (name: string, options?: { body?: unknown }) => Promise<{ data: T | null; error: Error | null }> } },
  functionName: string,
  body?: unknown,
  timeout = TIMEOUT_MS
): Promise<{ data: T | null; error: Error | null }> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      log.error('EDGE_FUNCTION_TIMEOUT', { functionName, timeout });
      resolve({ data: null, error: new FetchTimeoutError(`Edge function timed out after ${timeout}ms`) });
    }, timeout);
    
    supabase.functions.invoke(functionName, { body })
      .then((result) => {
        clearTimeout(timeoutId);
        if (result.error) {
          log.warn('EDGE_FUNCTION_ERROR', { functionName, error: result.error.message });
        } else {
          log.info('EDGE_FUNCTION_OK', { functionName });
        }
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        log.error('EDGE_FUNCTION_EXCEPTION', { functionName, error: error?.message });
        resolve({ data: null, error });
      });
  });
}
