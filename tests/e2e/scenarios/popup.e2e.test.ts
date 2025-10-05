import { describe, beforeAll, afterAll, test, expect } from '@jest/globals';
import type { Page } from 'puppeteer';
import { ExtensionContext, launchWithExtension, openPopupPage, cleanupBrowser, createTestPage } from '../helpers/chrome';
import { startLmStub } from '../server/lmStub';
import { sendRuntimeMessage, waitForRuntimeMessage } from '../helpers/runtime';

interface WaitForSelectorCountOptions {
  timeout?: number;
  interval?: number;
  predicate?: (count: number) => boolean;
}

async function waitForSelectorCount(page: Page, selector: string, expected: number, options: WaitForSelectorCountOptions = {}): Promise<number> {
  const { timeout = 10000, interval = 200, predicate } = options;
  const start = Date.now();
  let lastCount = 0;
  const check = predicate ?? ((count: number) => count >= expected);

  while (Date.now() - start < timeout) {
    lastCount = await page.evaluate((sel) => {
      return Array.from(document.querySelectorAll(sel)).length;
    }, selector);

    if (check(lastCount)) {
      return lastCount;
    }

    await page.waitForTimeout(interval);
  }

  throw new Error(`Timed out waiting for selector "${selector}" (last count: ${lastCount})`);
}

describe('PLaMo Translate拡張機能 - ポップアップUI E2Eテスト', () => {
  let context: ExtensionContext;
  let lmStub: { stop: () => Promise<void>, port: number, baseUrl: string };
  const extensionPath = process.cwd();

  beforeAll(async () => {
    // LM Studioスタブサーバーを起動
    lmStub = await startLmStub({
      port: 0,
      models: [
        { id: 'mmnga/plamo-2-translate-gguf', object: 'model' },
        { id: 'test-model-1', object: 'model' },
        { id: 'test-model-2', object: 'model' }
      ]
    });

    // Chrome拡張機能を読み込んでブラウザを起動
    context = await launchWithExtension(extensionPath);
  }, 60000);

  afterAll(async () => {
    // クリーンアップ
    await cleanupBrowser(context);
    if (lmStub) {
      await lmStub.stop();
    }
  }, 30000);

  test('設定タブでLM Studio接続テストが正常に動作する', async () => {
    // ポップアップページを開く
    const popupPage = await openPopupPage(context);

    // 設定タブに切り替え
    await popupPage.evaluate(() => {
      const settingsTab = document.querySelector('[data-tab="settings"]') as HTMLButtonElement;
      settingsTab?.click();
    });

    // 少し待機してタブが切り替わるのを待つ
    await popupPage.waitForTimeout(500);

    await popupPage.evaluate((baseUrl) => {
      const urlInput = document.getElementById('lmstudio-url') as HTMLInputElement;
      if (urlInput) {
        urlInput.value = baseUrl;
      }
    }, lmStub.baseUrl);

    // 接続テストボタンをクリック
    await popupPage.evaluate(() => {
      const testButton = document.getElementById('test-connection') as HTMLButtonElement;
      testButton?.click();
    });

    // 接続テストの結果を待つ
    await popupPage.waitForFunction(() => {
      const statusMessage = document.getElementById('status-message');
      return statusMessage && statusMessage.textContent && statusMessage.textContent.includes('接続成功');
    }, { timeout: 10000 });

    // ステータスメッセージを確認
    const statusText = await popupPage.evaluate(() => {
      const statusMessage = document.getElementById('status-message');
      return statusMessage?.textContent || '';
    });

    expect(statusText).toContain('接続成功');
    expect(statusText).toContain('3個のモデルが利用可能');

    // モデルオプションが更新されていることを確認
    const modelOptions = await popupPage.evaluate(() => {
      const datalist = document.getElementById('model-options');
      return Array.from(datalist?.options || []).map(option => option.value);
    });

    expect(modelOptions).toContain('mmnga/plamo-2-translate-gguf');
    expect(modelOptions).toContain('test-model-1');
    expect(modelOptions).toContain('test-model-2');

    // モデル選択フィールドが更新されていることを確認
    const selectedModel = await popupPage.evaluate(() => {
      const modelInput = document.getElementById('model-name') as HTMLInputElement;
      return modelInput?.value || '';
    });

    expect(selectedModel).toBe('mmnga/plamo-2-translate-gguf');

    await popupPage.close();
  }, 30000);

  test('設定タブで設定の保存が正常に動作する', async () => {
    // ポップアップページを開く
    const popupPage = await openPopupPage(context);

    // 設定タブに切り替え
    await popupPage.evaluate(() => {
      const settingsTab = document.querySelector('[data-tab="settings"]') as HTMLButtonElement;
      settingsTab?.click();
    });

    await popupPage.waitForTimeout(500);

    // 設定値を変更
    await popupPage.evaluate((baseUrl) => {
      const urlInput = document.getElementById('lmstudio-url') as HTMLInputElement;
      const modelInput = document.getElementById('model-name') as HTMLInputElement;
      const maxTokensInput = document.getElementById('max-tokens') as HTMLInputElement;
      const autoOpenCheckbox = document.getElementById('auto-open-popup') as HTMLInputElement;

      if (urlInput) urlInput.value = baseUrl;
      if (modelInput) modelInput.value = 'test-model-1';
      if (maxTokensInput) maxTokensInput.value = '1500';
      if (autoOpenCheckbox) autoOpenCheckbox.checked = false;
    }, lmStub.baseUrl);

    // 保存ボタンをクリック
    await popupPage.evaluate(() => {
      const saveButton = document.getElementById('save-settings') as HTMLButtonElement;
      saveButton?.click();
    });

    // 保存完了メッセージを待つ
    await popupPage.waitForFunction(() => {
      const statusMessage = document.getElementById('status-message');
      return statusMessage && statusMessage.textContent && statusMessage.textContent.includes('設定を保存しました');
    }, { timeout: 5000 });

    // ステータスメッセージを確認
    const statusText = await popupPage.evaluate(() => {
      const statusMessage = document.getElementById('status-message');
      return statusMessage?.textContent || '';
    });

    expect(statusText).toContain('設定を保存しました');

    // 設定がストレージに保存されていることを確認
    const settingsResult = await sendRuntimeMessage<any>(popupPage, { e2e: 'getSettings' });

    expect(settingsResult.ok).toBe(true);
    expect(settingsResult.settings.lmStudioUrl).toBe(lmStub.baseUrl);
    expect(settingsResult.settings.modelName).toBe('test-model-1');
    expect(settingsResult.settings.maxTokens).toBe(1500);
    expect(settingsResult.settings.autoOpenPopup).toBe(false);

    await popupPage.close();
  }, 30000);

  test('履歴タブで翻訳履歴が適切に表示・消去される', async () => {
    // まず、いくつかの翻訳履歴を作成
    const testTexts = [
      '履歴テスト1',
      '履歴テスト2',
      '履歴テスト3'
    ];

    // 履歴生成のために一時的に拡張ページを開いてメッセージ送信
    const controlPage = await openPopupPage(context);

    await sendRuntimeMessage(controlPage, { e2e: 'clearStorage' });

    await sendRuntimeMessage(controlPage, {
      e2e: 'setSettings',
      settings: {
        lmStudioUrl: lmStub.baseUrl,
        modelName: 'mmnga/plamo-2-translate-gguf',
        maxTokens: 1000,
        temperature: 0,
        autoOpenPopup: false
      }
    });

    for (const text of testTexts) {
      const testPage = await createTestPage(context.browser, lmStub.baseUrl);
      await testPage.bringToFront();
      await testPage.waitForSelector('#japanese-content');

      await testPage.evaluate((value) => {
        const element = document.getElementById('japanese-content');
        if (element) {
          element.textContent = value;
        }
      }, text);

      await testPage.evaluate(() => {
        const element = document.getElementById('japanese-content');
        if (element) {
          const range = document.createRange();
          range.selectNodeContents(element);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });

      const pageUrl = await testPage.url();

      await sendRuntimeMessage(controlPage, {
        e2e: 'triggerTranslateByUrl',
        text,
        url: pageUrl
      });

      await waitForRuntimeMessage<any>(controlPage, { e2e: 'getLatest' }, (resp: any) => {
        return resp?.ok && resp.latest?.originalText === text;
      }, { description: `latest translation for "${text}"` });

      await testPage.close();
    }

    await waitForRuntimeMessage<any>(controlPage, { e2e: 'getHistory' }, (resp: any) => {
      return resp?.ok && resp.history?.length === testTexts.length;
    }, { description: 'history length to reach expected count' });
    await controlPage.close();

    // ポップアップページを開く
    const popupPage = await openPopupPage(context);

    // 履歴タブに切り替え
    await popupPage.evaluate(() => {
      const historyTab = document.querySelector('[data-tab="history"]') as HTMLButtonElement;
      historyTab?.click();
    });

    await waitForSelectorCount(popupPage, '.history-item', testTexts.length);

    // 履歴項目が表示されていることを確認
    const historyItems = await popupPage.evaluate(() => {
      return Array.from(document.querySelectorAll('.history-item')).length;
    });

    expect(historyItems).toBe(3);

    // 各履歴項目の内容を確認
    const firstItemText = await popupPage.evaluate(() => {
      const firstItem = document.querySelector('.history-item');
      return firstItem?.textContent || '';
    });

    expect(firstItemText).toContain('履歴テスト3'); // 最新のものが最初

    // 履歴を消去
    await popupPage.evaluate(() => {
      window.confirm = () => true;
    });

    await popupPage.click('#clear-history');

    // 少し待機して履歴が消去されるのを待つ
    await waitForSelectorCount(popupPage, '.history-item', 0, { predicate: (count) => count === 0 });

    await waitForRuntimeMessage(popupPage, { e2e: 'getHistory' }, (resp: any) => {
      return resp?.ok && resp.history?.length === 0;
    }, { description: 'history storage cleared' });

    // 履歴が空になっていることを確認
    const historyItemsAfterClear = await popupPage.evaluate(() => {
      return Array.from(document.querySelectorAll('.history-item')).length;
    });

    expect(historyItemsAfterClear).toBe(0);

    // 空メッセージが表示されていることを確認
    const emptyMessage = await popupPage.evaluate(() => {
      const emptyElement = document.querySelector('.history-empty');
      return emptyElement?.textContent || '';
    });

    expect(emptyMessage).toContain('翻訳履歴はありません');

    // ストレージからも履歴が消去されていることを確認
    const historyResult = await sendRuntimeMessage<any>(popupPage, { e2e: 'getHistory' });

    expect(historyResult.ok).toBe(true);
    expect(historyResult.history).toHaveLength(0);

    await popupPage.close();
  }, 45000);

  test('最新翻訳タブで最新の翻訳が適切に表示される', async () => {
    // まず翻訳を実行して最新翻訳を作成（制御用の拡張ページから）
    const controlPage = await openPopupPage(context);
    const latestSourceText = '最新翻訳テスト';
    await sendRuntimeMessage(controlPage, { e2e: 'clearStorage' });

    await sendRuntimeMessage(controlPage, {
      e2e: 'setSettings',
      settings: {
        lmStudioUrl: lmStub.baseUrl,
        modelName: 'mmnga/plamo-2-translate-gguf',
        maxTokens: 1000,
        temperature: 0,
        autoOpenPopup: false
      }
    });
    const latestPage = await createTestPage(context.browser, lmStub.baseUrl);
    await latestPage.bringToFront();
    await latestPage.waitForSelector('#japanese-content');
    await latestPage.evaluate((value) => {
      const element = document.getElementById('japanese-content');
      if (element) {
        element.textContent = value;
      }
    }, latestSourceText);

    await latestPage.evaluate(() => {
      const element = document.getElementById('japanese-content');
      if (element) {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    });

    const latestPageUrl = await latestPage.url();

    await sendRuntimeMessage(controlPage, {
      e2e: 'triggerTranslateByUrl',
      text: latestSourceText,
      url: latestPageUrl
    });

    await waitForRuntimeMessage(controlPage, { e2e: 'getLatest' }, (resp: any) => {
      return resp?.ok && resp.latest?.originalText === latestSourceText;
    }, { description: 'latest translation stored' });

    await latestPage.close();
    await controlPage.close();

    // ポップアップページを開く
    const popupPage = await openPopupPage(context);

    // デフォルトで最新翻訳タブが表示されていることを確認
    await waitForSelectorCount(popupPage, '.latest-card', 1);

    const latestCard = await popupPage.evaluate(() => {
      const card = document.querySelector('.latest-card');
      return card ? {
        original: (card.querySelector('.latest-original') as HTMLElement)?.textContent || '',
        translated: (card.querySelector('.latest-translated') as HTMLElement)?.textContent || '',
        lang: (card.querySelector('.latest-lang') as HTMLElement)?.textContent || ''
      } : null;
    });

    expect(latestCard).toBeTruthy();
    expect(latestCard?.original).toContain(latestSourceText);
    expect(latestCard?.translated).toContain('これはテスト翻訳結果です');
    expect(latestCard?.lang).toBe('Japanese → English');

    // URLリンクが表示されていることを確認
    const urlLink = await popupPage.evaluate(() => {
      const link = document.querySelector('.latest-url a');
      return link ? {
        href: (link as HTMLAnchorElement).href,
        text: (link as HTMLAnchorElement).textContent || ''
      } : null;
    });

    expect(urlLink).toBeTruthy();
    expect(urlLink?.href).toBe(latestPageUrl);
    expect(urlLink?.text).toContain('ページを開く');

    await popupPage.close();
  }, 30000);
});
