/**
 * PLaMo Translate - Background Service Worker
 * LM Studio APIとの連携、翻訳ロジックを管理
 */

import { log, LogLevel } from './logger.js';
import { detectLanguage, buildTranslationPrompt, generateUUID } from './utils.js';

// デフォルト設定
const DEFAULT_SETTINGS = {
  lmStudioUrl: 'http://localhost:1234',
  modelName: 'mmnga/plamo-2-translate-gguf',
  maxTokens: 1000,
  temperature: 0,
  autoOpenPopup: true
};

// 定数
const MAX_HISTORY_ENTRIES = 50;

// 拡張機能インストール時の初期化
chrome.runtime.onInstalled.addListener((details) => {
  log(LogLevel.INFO, '拡張機能がインストールされました', {
    reason: details.reason,
    version: chrome.runtime.getManifest().version
  }, 'BackgroundScript');

  // デフォルト設定を保存（既存ユーザーも不足しているキーを補完）
  chrome.storage.local.get(['settings'], (result) => {
    const existingSettings = result.settings || {};
    const mergedSettings = {
      ...DEFAULT_SETTINGS,
      ...existingSettings
    };

    const needsUpdate = !result.settings || Object.keys(DEFAULT_SETTINGS).some((key) => !(key in existingSettings));

    if (needsUpdate) {
      chrome.storage.local.set({ settings: mergedSettings });
      log(LogLevel.INFO, 'デフォルト設定を保存しました', mergedSettings, 'BackgroundScript');
    } else {
      log(LogLevel.INFO, '既存の設定を使用します', result.settings, 'BackgroundScript');
    }
  });

  // コンテキストメニューを作成
  chrome.contextMenus.create({
    id: 'translate-with-plamo',
    title: 'PLaMoで翻訳: "%s"',
    contexts: ['selection']
  });

  log(LogLevel.INFO, 'コンテキストメニューを作成しました', null, 'BackgroundScript');
});

// コンテキストメニューのクリックイベント
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translate-with-plamo' && info.selectionText) {
    log(LogLevel.INFO, '翻訳リクエストを開始します', {
      textLength: info.selectionText.length,
      tabId: tab.id,
      pageUrl: info.pageUrl
    }, 'BackgroundScript');
    const tabUrl = tab?.url || '';
    handleTranslation(info.selectionText, tab.id, tabUrl);
  }
});

// キーボードショートカットのハンドリング
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'translate-selection') {
    return;
  }

  log(LogLevel.INFO, 'キーボードショートカットを処理します', { command }, 'BackgroundScript');

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id) {
      log(LogLevel.WARN, 'アクティブタブが見つかりません', null, 'BackgroundScript');
      return;
    }

    chrome.tabs.sendMessage(activeTab.id, { action: 'getSelectionText' }, (response) => {
      if (chrome.runtime.lastError) {
        log(LogLevel.WARN, 'テキスト選択取得に失敗しました', {
          error: chrome.runtime.lastError.message
        }, 'BackgroundScript');
        return;
      }

      const selectionText = response?.text?.trim();
      if (!selectionText) {
        chrome.tabs.sendMessage(activeTab.id, {
          action: 'showError',
          error: 'テキストが選択されていません。先にテキストを選択してください。'
        });
        log(LogLevel.WARN, 'テキストが選択されていません', null, 'BackgroundScript');
        return;
      }

      const tabUrl = activeTab.url || '';
      handleTranslation(selectionText, activeTab.id, tabUrl);
    });
  } catch (error) {
    log(LogLevel.ERROR, 'キーボードショートカット処理中にエラーが発生しました', {
      error: error.message
    }, 'BackgroundScript');
  }
});

// メッセージリスナー（content scriptからの翻訳リクエスト）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log(LogLevel.DEBUG, 'メッセージを受信しました', {
    action: request.action,
    senderTabId: sender.tab?.id
  }, 'BackgroundScript');

  if (request.action === 'translate') {
    log(LogLevel.INFO, '翻訳メッセージリクエストを処理します', {
      textLength: request.text?.length,
      sourceLang: request.sourceLang,
      targetLang: request.targetLang
    }, 'BackgroundScript');

    translateText(request.text, request.sourceLang, request.targetLang)
      .then(result => {
        log(LogLevel.DEBUG, '翻訳メッセージレスポンスを送信します', {
          success: result.success
        }, 'BackgroundScript');
        sendResponse(result);
      })
      .catch(error => {
        log(LogLevel.ERROR, '翻訳メッセージ処理中にエラーが発生しました', {
          error: error.message
        }, 'BackgroundScript');
        sendResponse({
          success: false,
          error: error.message
        });
      });
    return true; // 非同期レスポンスを示す
  }

  if (request.action === 'testConnection') {
    log(LogLevel.INFO, '接続テストメッセージリクエストを処理します', null, 'BackgroundScript');

    testLMStudioConnection(request && request.lmStudioUrl)
      .then(result => {
        log(LogLevel.DEBUG, '接続テストメッセージレスポンスを送信します', {
          success: result.success
        }, 'BackgroundScript');
        sendResponse(result);
      })
      .catch(error => {
        log(LogLevel.ERROR, '接続テストメッセージ処理中にエラーが発生しました', {
          error: error.message
        }, 'BackgroundScript');
        sendResponse({
          success: false,
          error: error.message
        });
      });
    return true;
  }
});

/**
 * 翻訳処理のメインハンドラー
 * @param {string} text - 翻訳対象テキスト
 * @param {number} tabId - 対象タブのID
 * @param {string} tabUrl - 対象タブのURL
 */
async function handleTranslation(text, tabId, tabUrl = '') {
  try {
    log(LogLevel.INFO, '翻訳処理を開始します', {
      textLength: text.length,
      tabId: tabId
    }, 'BackgroundScript');

    // 言語検出
    const sourceLang = detectLanguage(text);
    const targetLang = sourceLang === 'Japanese' ? 'English' : 'Japanese';

    log(LogLevel.DEBUG, '言語検出結果', {
      sourceLang: sourceLang,
      targetLang: targetLang,
      textPreview: text.substring(0, 50) + (text.length > 50 ? '...' : '')
    }, 'BackgroundScript');

    // 翻訳実行
    const result = await translateText(text, sourceLang, targetLang);

    if (!result.success) {
      log(LogLevel.WARN, '翻訳失敗', {
        error: result.error
      }, 'BackgroundScript');

      // エラーをcontent scriptに送信
      chrome.tabs.sendMessage(tabId, {
        action: 'showError',
        error: result.error
      });
      return;
    }

    log(LogLevel.INFO, '翻訳成功', {
      processingTime: result.processingTime,
      translationLength: result.translation.length
    }, 'BackgroundScript');

    // content scriptに結果を送信
    chrome.tabs.sendMessage(tabId, {
      action: 'showTranslation',
      originalText: text,
      translatedText: result.translation,
      sourceLang: sourceLang,
      targetLang: targetLang,
      processingTime: result.processingTime
    });

    const baseEntry = {
      originalText: text,
      translatedText: result.translation,
      sourceLang: sourceLang,
      targetLang: targetLang,
      timestamp: Date.now(),
      url: tabUrl
    };

    // 翻訳履歴に保存
    let storedEntry = null;
    try {
      storedEntry = await saveToHistory(baseEntry);
    } catch (historyError) {
      log(LogLevel.ERROR, '翻訳履歴の保存に失敗しました', {
        error: historyError.message
      }, 'BackgroundScript');
    }

    // 最新翻訳を保存してからポップアップを表示
    if (storedEntry) {
      try {
        await chrome.storage.local.set({ latestTranslation: storedEntry });
        // ストレージ書き込み完了後にポップアップを表示
        await maybeAutoOpenPopup();
      } catch (latestError) {
        log(LogLevel.ERROR, '最新翻訳の更新に失敗しました', {
          error: latestError.message
        }, 'BackgroundScript');
      }
    } else {
      log(LogLevel.WARN, '履歴エントリが利用できないため最新翻訳を更新できませんでした', null, 'BackgroundScript');
      // エントリがない場合でもポップアップ表示を試行
      try {
        await maybeAutoOpenPopup();
      } catch (popupError) {
        log(LogLevel.WARN, 'ポップアップの自動表示に失敗しました', {
          error: popupError.message
        }, 'BackgroundScript');
      }
    }

    log(LogLevel.DEBUG, '翻訳結果を送信しました', {
      tabId: tabId,
      processingTime: result.processingTime
    }, 'BackgroundScript');
  } catch (error) {
    log(LogLevel.ERROR, '翻訳処理中に予期しないエラーが発生しました', {
      error: error.message,
      stack: error.stack,
      tabId: tabId
    }, 'BackgroundScript');

    chrome.tabs.sendMessage(tabId, {
      action: 'showError',
      error: '翻訳中に予期しないエラーが発生しました: ' + error.message
    });
  }
}

/**
 * 翻訳実行
 * @param {string} text - 翻訳対象テキスト
 * @param {string} sourceLang - 元言語
 * @param {string} targetLang - 翻訳先言語
 * @returns {Promise<Object>} - 翻訳結果
 */
async function translateText(text, sourceLang, targetLang) {
  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    log(LogLevel.DEBUG, '翻訳API呼び出しを開始します', {
      sourceLang: sourceLang,
      targetLang: targetLang,
      textLength: text.length
    }, 'BackgroundScript');

    // 設定を取得
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings 
      ? { ...DEFAULT_SETTINGS, ...result.settings }
      : { ...DEFAULT_SETTINGS };

    log(LogLevel.DEBUG, '設定を取得しました', {
      lmStudioUrl: settings.lmStudioUrl,
      modelName: settings.modelName
    }, 'BackgroundScript');

    // プロンプト構築
    const prompt = buildTranslationPrompt(text, sourceLang, targetLang);

    // LM Studio APIに送信
    log(LogLevel.DEBUG, 'LM Studio APIを呼び出します', {
      url: `${settings.lmStudioUrl}/v1/chat/completions`,
      model: settings.modelName
    }, 'BackgroundScript');

    const response = await fetch(`${settings.lmStudioUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: settings.modelName,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        stop: ['<|plamo:op|>']
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      log(LogLevel.ERROR, 'API呼び出しに失敗しました', {
        status: response.status,
        statusText: response.statusText,
        url: settings.lmStudioUrl
      }, 'BackgroundScript');
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const translation = data?.choices?.[0]?.message?.content?.trim();
    
    if (!translation) {
      throw new Error('Invalid response from translation API');
    }
    
    const processingTime = Date.now() - startTime;

    log(LogLevel.INFO, '翻訳API呼び出し成功', {
      processingTime: processingTime,
      responseLength: translation.length,
      tokensUsed: data.usage?.total_tokens
    }, 'BackgroundScript');

    return {
      success: true,
      translation: translation,
      processingTime: processingTime
    };

  } catch (error) {
    log(LogLevel.ERROR, '翻訳APIエラーが発生しました', {
      error: error.message,
      stack: error.stack
    }, 'BackgroundScript');

    // エラーメッセージの日本語化
    let errorMessage = '翻訳エラーが発生しました';

    if (error.name === 'AbortError' || (typeof error.message === 'string' && error.message.includes('aborted'))) {
      errorMessage = 'リクエストがタイムアウトしました。';
      log(LogLevel.WARN, '翻訳タイムアウト', {
        timeout: true
      }, 'BackgroundScript');
    } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMessage = 'LM Studioに接続できません。サーバーが起動しているか確認してください。';
      log(LogLevel.ERROR, 'LM Studio接続エラー', {
        error: error.message
      }, 'BackgroundScript');
    } else if (error.message.includes('500')) {
      errorMessage = 'モデルエラーが発生しました。LM Studioの設定を確認してください。';
      log(LogLevel.ERROR, 'モデルサーバーエラー', {
        status: 500
      }, 'BackgroundScript');
    }

    return {
      success: false,
      error: errorMessage
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * LM Studio接続テスト
 * @param {string} overrideUrl - オーバーライドURL
 * @returns {Promise<Object>} - 接続テスト結果
 */
async function testLMStudioConnection(overrideUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    log(LogLevel.INFO, 'LM Studio接続テストを開始します', null, 'BackgroundScript');

    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || DEFAULT_SETTINGS;

    const url = (typeof overrideUrl === 'string' && overrideUrl) ? overrideUrl : settings.lmStudioUrl;

    log(LogLevel.DEBUG, '接続テスト設定', {
      url: url
    }, 'BackgroundScript');

    const response = await fetch(`${url}/v1/models`, {
      method: 'GET',
      signal: controller.signal
    });

    if (!response.ok) {
      log(LogLevel.ERROR, '接続テスト失敗', {
        status: response.status,
        statusText: response.statusText
      }, 'BackgroundScript');
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const modelCount = data.data?.length || 0;

    log(LogLevel.INFO, 'LM Studio接続テスト成功', {
      modelCount: modelCount,
      models: data.data?.map(m => m.id) || []
    }, 'BackgroundScript');

    return {
      success: true,
      models: data.data || []
    };

  } catch (error) {
    const message = error.name === 'AbortError' ? 'タイムアウトしました' : error.message;
    
    log(LogLevel.ERROR, 'LM Studio接続テストエラー', {
      error: message
    }, 'BackgroundScript');

    return {
      success: false,
      error: 'LM Studioに接続できません: ' + message
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 翻訳履歴に保存
 * @param {Object} entry - 翻訳履歴エントリ
 */
async function saveToHistory(entry) {
  try {
    log(LogLevel.DEBUG, '翻訳履歴を保存します', {
      sourceLang: entry.sourceLang,
      targetLang: entry.targetLang,
      textLength: entry.originalText.length
    }, 'BackgroundScript');

    const result = await chrome.storage.local.get(['history']);
    let history = result.history || [];

    // 新しいエントリを生成
    const storedEntry = entry.id ? { ...entry } : { id: generateUUID(), ...entry };

    history.unshift(storedEntry);

    // 最大件数に制限
    if (history.length > MAX_HISTORY_ENTRIES) {
      history = history.slice(0, MAX_HISTORY_ENTRIES);
      log(LogLevel.DEBUG, '履歴が上限に達したため古いエントリを削除しました', null, 'BackgroundScript');
    }

    await chrome.storage.local.set({ history: history });

    log(LogLevel.INFO, '翻訳履歴を保存しました', {
      historyCount: history.length,
      entryId: storedEntry.id
    }, 'BackgroundScript');

    return storedEntry;
  } catch (error) {
    log(LogLevel.ERROR, '翻訳履歴の保存に失敗しました', {
      error: error.message,
      stack: error.stack
    }, 'BackgroundScript');
    return null;
  }
}

/**
 * 設定に応じてアクションポップアップを自動表示
 */
async function maybeAutoOpenPopup() {
  try {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings
      ? { ...DEFAULT_SETTINGS, ...result.settings }
      : { ...DEFAULT_SETTINGS };

    if (!settings.autoOpenPopup) {
      log(LogLevel.DEBUG, 'ポップアップ自動表示が無効になっています', null, 'BackgroundScript');
      return;
    }

    if (typeof chrome?.action?.openPopup !== 'function') {
      log(LogLevel.WARN, 'ポップアップ自動表示がサポートされていません', null, 'BackgroundScript');
      try {
        await chrome.storage.local.set({
          autoOpenPopupNotice: {
            type: 'UNSUPPORTED',
            timestamp: Date.now()
          }
        });
      } catch (storageError) {
        log(LogLevel.WARN, 'サポート外通知の保存に失敗しました', {
          error: storageError.message
        }, 'BackgroundScript');
      }
      return;
    }

    if (typeof chrome?.action?.getUserSettings === 'function') {
      try {
        const userSettings = await chrome.action.getUserSettings();
        if (userSettings && userSettings.isOnToolbar === false) {
          log(LogLevel.WARN, '拡張機能アイコンがツールバーに表示されていません', null, 'BackgroundScript');
          try {
            await chrome.storage.local.set({
              autoOpenPopupNotice: {
                type: 'ACTION_HIDDEN',
                timestamp: Date.now()
              }
            });
          } catch (storageError) {
            log(LogLevel.WARN, '非表示通知の保存に失敗しました', {
              error: storageError.message
            }, 'BackgroundScript');
          }
          return;
        }
      } catch (settingsError) {
        log(LogLevel.WARN, 'ユーザー設定の読み取りに失敗しました', {
          error: settingsError.message
        }, 'BackgroundScript');
      }
    }

    await chrome.action.openPopup();
    log(LogLevel.INFO, 'ポップアップを自動表示しました', null, 'BackgroundScript');
    try {
      await chrome.storage.local.set({ autoOpenPopupNotice: null });
    } catch (storageError) {
      log(LogLevel.WARN, '通知のクリアに失敗しました', {
        error: storageError.message
      }, 'BackgroundScript');
    }
  } catch (error) {
    log(LogLevel.WARN, 'ポップアップの自動表示に失敗しました', {
      error: error.message
    }, 'BackgroundScript');
    try {
      await chrome.storage.local.set({
        autoOpenPopupNotice: {
          type: 'OPEN_FAILED',
          message: error?.message || '',
          timestamp: Date.now()
        }
      });
    } catch (storageError) {
      log(LogLevel.WARN, 'エラー通知の保存に失敗しました', {
        error: storageError.message
      }, 'BackgroundScript');
    }
  }
}

// ============================================================================
// E2Eテスト専用メッセージフック（本番環境では無効化）
// ============================================================================

/**
 * E2Eテスト専用機能の有効化フラグ
 * 本番環境ではfalseに設定またはビルド時に除外
 */
const ENABLE_E2E = true;

/**
 * E2Eテスト用のメッセージハンドラー
 * 本番環境では機能しないようガード付き
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!ENABLE_E2E || !request || !request.e2e) {
    return false;
  }

  (async () => {
    try {
      if (request.e2e === 'setSettings') {
        // テスト用の設定をストレージに保存
        await chrome.storage.local.set({ settings: request.settings });
        return sendResponse({ ok: true });
      }

      if (request.e2e === 'getSettings') {
        // 現在の設定を取得
        const result = await chrome.storage.local.get(['settings']);
        return sendResponse({ ok: true, settings: result.settings });
      }

      if (request.e2e === 'clearStorage') {
        // テスト用にストレージをクリア
        await chrome.storage.local.clear();
        return sendResponse({ ok: true });
      }

      if (request.e2e === 'getLatest') {
        // 最新翻訳を取得
        const result = await chrome.storage.local.get(['latestTranslation']);
        return sendResponse({ ok: true, latest: result.latestTranslation || null });
      }

      if (request.e2e === 'getHistory') {
        // 翻訳履歴を取得
        const result = await chrome.storage.local.get(['history']);
        return sendResponse({ ok: true, history: result.history || [] });
      }

      if (request.e2e === 'triggerTranslate') {
        // 翻訳処理をトリガー
        await handleTranslation(request.text, request.tabId, request.url || '');
        return sendResponse({ ok: true });
      }

      if (request.e2e === 'triggerTranslateByUrl') {
        try {
          if (!request.url || typeof request.url !== 'string') {
            return sendResponse({ ok: false, error: 'Missing url for triggerTranslateByUrl' });
          }

          const candidatePatterns = new Set();
          candidatePatterns.add(request.url);
          if (!request.url.includes('*')) {
            const wildcardPattern = request.url.endsWith('*') ? request.url : `${request.url}*`;
            candidatePatterns.add(wildcardPattern);
          }

          let targetTab = null;
          for (const pattern of candidatePatterns) {
            const matchedTabs = await chrome.tabs.query({ url: pattern });
            targetTab = matchedTabs.find((tab) => typeof tab?.id === 'number');
            if (targetTab) {
              break;
            }
          }

          if (!targetTab) {
            const allTabs = await chrome.tabs.query({});
            targetTab = allTabs.find((tab) => {
              if (!tab?.url) return false;
              const normalizedTabUrl = tab.url.replace(/\/$/, '');
              const normalizedRequestUrl = request.url.replace(/\/$/, '');
              return typeof tab.id === 'number' && (tab.url === request.url || normalizedTabUrl === normalizedRequestUrl || tab.url.startsWith(request.url));
            }) || null;
          }

          if (!targetTab || typeof targetTab.id !== 'number') {
            return sendResponse({ ok: false, error: `No tab found for URL: ${request.url}` });
          }

          await handleTranslation(request.text, targetTab.id, request.url || targetTab.url || '');
          return sendResponse({ ok: true, tabId: targetTab.id });
        } catch (error) {
          console.error('triggerTranslateByUrl failed:', error);
          return sendResponse({ ok: false, error: error?.message || 'triggerTranslateByUrl failed' });
        }
      }

      if (request.e2e === 'triggerTranslateActive') {
        // アクティブタブを解決して翻訳をトリガー
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab || !activeTab.id) {
            return sendResponse({ ok: false, error: 'No active tab' });
          }
          await handleTranslation(request.text, activeTab.id, request.url || activeTab.url || '');
          return sendResponse({ ok: true });
        } catch (e) {
          return sendResponse({ ok: false, error: e?.message || 'failed to resolve active tab' });
        }
      }

      if (request.e2e === 'simulateOpenPopupError') {
        // chrome.action.openPopup のエラーをシミュレート
        chrome.action.openPopup = async () => {
          throw new Error('Simulated popup open error');
        };
        return sendResponse({ ok: true });
      }

      if (request.e2e === 'resetOpenPopup') {
        // chrome.action.openPopup を元に戻す
        delete chrome.action.openPopup;
        return sendResponse({ ok: true });
      }

      if (request.e2e === 'getAutoOpenPopupNotice') {
        // autoOpenPopupの通知状態を取得
        const result = await chrome.storage.local.get(['autoOpenPopupNotice']);
        return sendResponse({ ok: true, notice: result.autoOpenPopupNotice });
      }

      if (request.e2e === 'setAutoOpenPopupNotice') {
        // autoOpenPopupの通知状態を設定
        await chrome.storage.local.set({ autoOpenPopupNotice: request.notice });
        return sendResponse({ ok: true });
      }

      // 未定義のe2eコマンド
      return sendResponse({ ok: false, error: 'Unknown e2e command' });

    } catch (error) {
      return sendResponse({ ok: false, error: error.message });
    }
  })();

  return true; // 非同期レスポンスを示す
});