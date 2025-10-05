import type { Page } from 'puppeteer';

export interface WaitForMessageOptions {
  timeout?: number;
  interval?: number;
  description?: string;
}

type RuntimeRequest = Record<string, unknown>;

export async function sendRuntimeMessage<T = unknown>(page: Page, message: RuntimeRequest): Promise<T> {
  return await page.evaluate((request) => {
    return new Promise<T>((resolve, reject) => {
      const runtime = (window as typeof window & {
        chrome?: { runtime?: { sendMessage: (req: RuntimeRequest, callback: (response: T) => void) => void } }
      }).chrome?.runtime;

      if (!runtime) {
        reject(new Error('chrome.runtime is not available in this context'));
        return;
      }

      runtime.sendMessage(request, (response: T) => {
        resolve(response);
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

  while (Date.now() - start < timeout) {
    lastResponse = await sendRuntimeMessage<T>(page, message);
    if (predicate(lastResponse)) {
      return lastResponse;
    }
    await page.waitForTimeout(interval);
  }

  const detail = description ? ` (${description})` : '';
  throw new Error(`Timed out waiting for runtime message${detail}`);
}
