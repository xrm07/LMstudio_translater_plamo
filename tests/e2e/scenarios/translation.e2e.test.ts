import { describe, beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals';
import type { Page } from 'puppeteer';
import { ExtensionContext, launchWithExtension, openPopupPage, createTestPage, cleanupBrowser } from '../helpers/chrome';
import { sendRuntimeMessage, waitForRuntimeMessage } from '../helpers/runtime';
import { startLmStub } from '../server/lmStub';

interface TranslationResult {
  ok: boolean;
  latest?: {
    originalText: string;
    translatedText: string;
    url?: string;
  };
}

interface AutoOpenPopupNotice {
  ok: boolean;
  notice?: {
    type: string;
  };
}

interface HistoryItem {
  originalText: string;
  translatedText: string;
}

interface HistoryResult {
  ok: boolean;
  history?: HistoryItem[];
}

async function setupTestPageWithText(
  browser: ExtensionContext['browser'],
  baseUrl: string,
  elementId: string,
  text: string
): Promise<Page> {
  const page = await createTestPage(browser, baseUrl);
  await page.bringToFront();
  await page.waitForSelector(`#${elementId}`);

  await page.evaluate((id, value) => {
    const element = document.getElementById(id as string);
    if (element) {
      element.textContent = value as string;
    }
  }, elementId, text);

  await page.evaluate((id) => {
    const element = document.getElementById(id as string);
    if (element) {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, elementId);

  return page;
}

async function configureTestSettings(
  controlPage: Page,
  baseUrl: string,
  options: { autoOpenPopup: boolean } = { autoOpenPopup: true }
) {
  await sendRuntimeMessage(controlPage, {
    e2e: 'setSettings',
    settings: {
      lmStudioUrl: baseUrl,
      modelName: 'mmnga/plamo-2-translate-gguf',
      maxTokens: 1000,
      temperature: 0,
      autoOpenPopup: options.autoOpenPopup
    }
  });
}

describe('PLaMo Translate拡張機能 - 翻訳機能E2Eテスト', () => {
  let context: ExtensionContext;
  let controlPage: Page;
  let lmStub: { stop: () => Promise<void>; port: number; baseUrl: string };
  const extensionPath = process.cwd(); // 現在のディレクトリを拡張機能のパスとして使用

  beforeAll(async () => {
    // LM Studioスタブサーバーを起動
    lmStub = await startLmStub({
      port: 0,
      models: [
        { id: 'mmnga/plamo-2-translate-gguf', object: 'model' },
        { id: 'test-model-1', object: 'model' }
      ],
      chatResponse: 'これはテスト翻訳結果です。英語から日本語への翻訳が正常に動作しています。'
    });

    // Chrome拡張機能を読み込んでブラウザを起動
    context = await launchWithExtension(extensionPath);
    controlPage = await openPopupPage(context);
  }, 60000);

  afterAll(async () => {
    // クリーンアップ
    try {
      if (controlPage) {
        await controlPage.close();
      }
    } catch (e) {
      console.error('Failed to close control page:', e);
    }
    await cleanupBrowser(context);
    if (lmStub) {
      await lmStub.stop();
    }
  }, 30000);

  const ensureControlPage = async () => {
    if (!controlPage || controlPage.isClosed()) {
      controlPage = await openPopupPage(context);
    }
  };

  beforeEach(async () => {
    // 各テスト前にストレージをクリア
    await ensureControlPage();
    await sendRuntimeMessage(controlPage, { e2e: 'clearStorage' });
  });

  test('翻訳成功→autoOpenPopup成功の場合、ポップアップが表示されoverlayが表示されない', async () => {
    const translationText = 'これはテスト用の日本語テキストです。';
    const testPage = await setupTestPageWithText(
      context.browser,
      lmStub.baseUrl,
      'japanese-content',
      translationText
    );

    await configureTestSettings(controlPage, lmStub.baseUrl, { autoOpenPopup: true });

    const pageUrl = await testPage.url();

    await sendRuntimeMessage(controlPage, {
      e2e: 'triggerTranslateByUrl',
      text: translationText,
      url: pageUrl
    });

    const latestResult = await waitForRuntimeMessage<TranslationResult>(
      controlPage,
      { e2e: 'getLatest' },
      (resp) => resp?.ok === true && resp.latest?.originalText === translationText,
      { description: 'latest translation matching test text' }
    );

    expect(latestResult.ok).toBe(true);
    if (!latestResult.latest) {
      throw new Error('最新の翻訳結果が取得できませんでした');
    }
    expect(latestResult.latest.originalText).toBe(translationText);
    expect(latestResult.latest.translatedText).toBe('これはテスト翻訳結果です。英語から日本語への翻訳が正常に動作しています。');

    // オーバーレイが表示されないことを条件待機で確認
    await testPage
      .waitForFunction(() => !document.getElementById('plamo-translate-popup'), { timeout: 1000 })
      .catch(() => {
        /* 許容 */
      });
    const overlayVisible = await testPage.evaluate(() => !!document.getElementById('plamo-translate-popup'));
    expect(overlayVisible).toBe(false);

    await testPage.close();
  }, 30000);

  test('autoOpenPopup失敗の場合、overlayがフォールバック表示される', async () => {
    const translationText = 'これはテスト用の英語テキストです。';
    const testPage = await setupTestPageWithText(
      context.browser,
      lmStub.baseUrl,
      'english-content',
      translationText
    );

    await configureTestSettings(controlPage, lmStub.baseUrl, { autoOpenPopup: true });

    await sendRuntimeMessage(controlPage, { e2e: 'simulateOpenPopupError' });

    const pageUrl = await testPage.url();

    await sendRuntimeMessage(controlPage, {
      e2e: 'triggerTranslateByUrl',
      text: translationText,
      url: pageUrl
    });

    await testPage.waitForFunction(() => {
      const popup = document.getElementById('plamo-translate-popup');
      return Boolean(popup && popup.classList.contains('plamo-translate-show'));
    }, { timeout: 5000 });

    const noticeResult = await waitForRuntimeMessage<AutoOpenPopupNotice>(
      controlPage,
      { e2e: 'getAutoOpenPopupNotice' },
      (resp) => resp?.ok === true && resp.notice?.type === 'OPEN_FAILED',
      { description: 'auto open popup failure notice' }
    );

    expect(noticeResult.ok).toBe(true);
    if (!noticeResult.notice) {
      throw new Error('autoOpenPopupの通知が取得できませんでした');
    }
    expect(noticeResult.notice.type).toBe('OPEN_FAILED');

    await sendRuntimeMessage(controlPage, { e2e: 'resetOpenPopup' });

    await testPage.close();
  }, 30000);

  test('翻訳履歴が適切に保存・取得できる', async () => {
    // 複数の翻訳を実行して履歴を確認
    const testTexts = [
      '最初の翻訳テストです。',
      'これは二番目のテキストです。',
      '最後の翻訳確認です。'
    ];

    for (const text of testTexts) {
      await configureTestSettings(controlPage, lmStub.baseUrl, { autoOpenPopup: false });

      const testPage = await setupTestPageWithText(
        context.browser,
        lmStub.baseUrl,
        'japanese-content',
        text
      );

      const pageUrl = await testPage.url();

      await sendRuntimeMessage(controlPage, {
        e2e: 'triggerTranslateByUrl',
        text,
        url: pageUrl
      });

      await waitForRuntimeMessage<TranslationResult>(
        controlPage,
        { e2e: 'getLatest' },
        (resp) => resp?.ok === true && resp.latest?.originalText === text,
        { description: `latest translation for "${text}"` }
      );

      await testPage.close();
    }

    // 履歴を取得して確認
    const historyResult = await waitForRuntimeMessage<HistoryResult>(
      controlPage,
      { e2e: 'getHistory' },
      (resp) => resp?.ok === true && (resp.history?.length ?? 0) === testTexts.length,
      { description: 'history length to reach expected count' }
    );

    expect(historyResult.ok).toBe(true);
    const historyItems = historyResult.history;
    if (!historyItems) {
      throw new Error('翻訳履歴が取得できませんでした');
    }
    expect(historyItems).toHaveLength(3);

    // 最新のものが最初にあることを確認
    const [firstHistory, secondHistory, thirdHistory] = historyItems;
    if (!firstHistory || !secondHistory || !thirdHistory) {
      throw new Error('履歴項目の配列が期待した長さではありません');
    }
    expect(firstHistory.originalText).toBe('最後の翻訳確認です。');
    expect(secondHistory.originalText).toBe('これは二番目のテキストです。');
    expect(thirdHistory.originalText).toBe('最初の翻訳テストです。');
  }, 45000);
});
