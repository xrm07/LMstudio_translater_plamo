import type { Page } from 'puppeteer';

export interface WaitForMessageOptions {
  timeout?: number;
  interval?: number;
  description?: string;
}

type RuntimeRequest = Record<string, unknown>;

interface ChromeRuntime {
  sendMessage: <T>(req: RuntimeRequest, callback: (response: T) => void) => void;
  lastError?: { message?: string };
}

type ChromeWindow = typeof window & {
  chrome?: {
    runtime?: ChromeRuntime;
  };
};

export async function sendRuntimeMessage<T = unknown>(page: Page, message: RuntimeRequest): Promise<T> {
  return await page.evaluate((request) => {
    return new Promise<T>((resolve, reject) => {
      const chromeWindow = window as ChromeWindow;
      const runtime = chromeWindow.chrome?.runtime;

      if (!runtime) {
        reject(new Error('chrome.runtime is not available in this context'));
        return;
      }

      const timeoutId = window.setTimeout(() => {
        reject(new Error('Timed out waiting for runtime response'));
      }, 5000);

      runtime.sendMessage(request, (response: T) => {
        const lastErr = chromeWindow.chrome?.runtime?.lastError;
        if (lastErr) {
          window.clearTimeout(timeoutId);
          reject(new Error(String(lastErr.message || lastErr)));
        } else {
          window.clearTimeout(timeoutId);
          resolve(response);
        }
      });
    });
  }, message);
}

export async function waitForRuntimeMessage<T = unknown>(
  page: Page,
  message: RuntimeRequest,
  predicate: (response: T) => boolean,
  options: WaitForMessageOptions = {}
): Promise<T> {
  const { timeout = 10000, interval = 200, description } = options;
  const start = Date.now();
  let lastResponse: T | undefined;

  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  while (Date.now() - start < timeout) {
    lastResponse = await sendRuntimeMessage<T>(page, message);
    if (predicate(lastResponse)) {
      return lastResponse;
    }
    await sleep(interval);
  }

  const detail = description ? ` (${description})` : '';
  throw new Error(`Timed out waiting for runtime message${detail}`);
}
