import { describe, beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals';
import type { Page } from 'puppeteer';
import { ExtensionContext, launchWithExtension, openPopupPage, createTestPage, cleanupBrowser } from '../helpers/chrome';
import { sendRuntimeMessage, waitForRuntimeMessage } from '../helpers/runtime';
import { startLmStub } from '../server/lmStub';

describe('PLaMo Translate拡張機能 - 翻訳機能E2Eテスト', () => {
  let context: ExtensionContext;
  let controlPage: Page;
  let lmStub: { stop: () => Promise<void>, port: number, baseUrl: string };
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
    try { if (controlPage) await controlPage.close(); } catch {}
    await cleanupBrowser(context);
    if (lmStub) {
      await lmStub.stop();
    }
  }, 30000);

  // グローバルなUnhandledRejectionハンドラはsetupへ移動

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
    const testPage = await createTestPage(context.browser, lmStub.baseUrl);
    await testPage.bringToFront();

    await testPage.waitForSelector('#japanese-content');
    await testPage.evaluate((text) => {
      const element = document.getElementById('japanese-content');
      if (element) {
        element.textContent = text;
      }
    }, translationText);

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

    await sendRuntimeMessage(controlPage, {
      e2e: 'setSettings',
      settings: {
      lmStudioUrl: lmStub.baseUrl,
      modelName: 'mmnga/plamo-2-translate-gguf',
      maxTokens: 1000,
      temperature: 0,
      autoOpenPopup: true
      }
    });

    const pageUrl = await testPage.url();

    await sendRuntimeMessage(controlPage, {
      e2e: 'triggerTranslateByUrl',
      text: translationText,
      url: pageUrl
    });

    const latestResult = await waitForRuntimeMessage<any>(controlPage, { e2e: 'getLatest' }, (resp: any) => {
      return resp?.ok && resp.latest?.originalText === translationText;
    }, { description: 'latest translation matching test text' });

    expect(latestResult.ok).toBe(true);
    expect(latestResult.latest).toBeTruthy();
    expect(latestResult.latest.originalText).toBe(translationText);
    expect(latestResult.latest.translatedText).toBe('これはテスト翻訳結果です。英語から日本語への翻訳が正常に動作しています。');

    await testPage.waitForTimeout(500);
    const overlayVisible = await testPage.evaluate(() => {
      return !!document.getElementById('plamo-translate-popup');
    });
    expect(overlayVisible).toBe(false);

    await testPage.close();
  }, 30000);

  test('autoOpenPopup失敗の場合、overlayがフォールバック表示される', async () => {
    const translationText = 'これはテスト用の英語テキストです。';
    const testPage = await createTestPage(context.browser, lmStub.baseUrl);
    await testPage.bringToFront();

    await testPage.waitForSelector('#english-content');
    await testPage.evaluate((text) => {
      const element = document.getElementById('english-content');
      if (element) {
        element.textContent = text;
      }
    }, translationText);

    await testPage.evaluate(() => {
      const element = document.getElementById('english-content');
      if (element) {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    });

    await sendRuntimeMessage(controlPage, {
      e2e: 'setSettings',
      settings: {
      lmStudioUrl: lmStub.baseUrl,
      modelName: 'mmnga/plamo-2-translate-gguf',
      maxTokens: 1000,
      temperature: 0,
      autoOpenPopup: true
      }
    });

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

    const noticeResult = await waitForRuntimeMessage<any>(controlPage, { e2e: 'getAutoOpenPopupNotice' }, (resp: any) => {
      return resp?.ok && resp.notice?.type === 'OPEN_FAILED';
    }, { description: 'auto open popup failure notice' });

    expect(noticeResult.ok).toBe(true);
    expect(noticeResult.notice).toBeTruthy();
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
      // 設定をリセット
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

    // 履歴を取得して確認
    const historyResult = await waitForRuntimeMessage<any>(controlPage, { e2e: 'getHistory' }, (resp: any) => {
      return resp?.ok && resp.history?.length === testTexts.length;
    }, { description: 'history length to reach expected count' });

    expect(historyResult.ok).toBe(true);
    expect(historyResult.history).toHaveLength(3);

    // 最新のものが最初にあることを確認
    expect(historyResult.history[0].originalText).toBe('最後の翻訳確認です。');
    expect(historyResult.history[1].originalText).toBe('これは二番目のテキストです。');
    expect(historyResult.history[2].originalText).toBe('最初の翻訳テストです。');
  }, 45000);
});
