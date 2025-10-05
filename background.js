/**
 * PLaMo Translate - Background Service Worker
 * LM Studio APIとの連携、翻訳ロジックを管理
 */

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
chrome.runtime.onInstalled.addListener(() => {
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
    }
  });

  // コンテキストメニューを作成
  chrome.contextMenus.create({
    id: 'translate-with-plamo',
    title: 'PLaMoで翻訳: "%s"',
    contexts: ['selection']
  });
});

// コンテキストメニューのクリックイベント
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translate-with-plamo' && info.selectionText) {
    const tabUrl = tab?.url || '';
    handleTranslation(info.selectionText, tab.id, tabUrl);
  }
});

// キーボードショートカットのハンドリング
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'translate-selection') {
    return;
  }

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id) {
      return;
    }

    chrome.tabs.sendMessage(activeTab.id, { action: 'getSelectionText' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to retrieve selection text:', chrome.runtime.lastError.message);
        return;
      }

      const selectionText = response?.text?.trim();
      if (!selectionText) {
        chrome.tabs.sendMessage(activeTab.id, {
          action: 'showError',
          error: 'テキストが選択されていません。先にテキストを選択してください。'
        });
        return;
      }

      const tabUrl = activeTab.url || '';
      handleTranslation(selectionText, activeTab.id, tabUrl);
    });
  } catch (error) {
    console.error('Command handling error:', error);
  }
});

// メッセージリスナー（content scriptからの翻訳リクエスト）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    translateText(request.text, request.sourceLang, request.targetLang)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({
        success: false,
        error: error.message
      }));
    return true; // 非同期レスポンスを示す
  }

  if (request.action === 'testConnection') {
    testLMStudioConnection(request && request.lmStudioUrl)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({
        success: false,
        error: error.message
      }));
    return true;
  }
});

/**
 * 翻訳処理のメインハンドラー
 * @param {string} text - 翻訳対象テキスト
 * @param {number} tabId - 対象タブのID
 */
async function handleTranslation(text, tabId, tabUrl = '') {
  try {
    // 言語検出
    const sourceLang = detectLanguage(text);
    const targetLang = sourceLang === 'Japanese' ? 'English' : 'Japanese';

    // 翻訳実行
    const result = await translateText(text, sourceLang, targetLang);

    if (!result.success) {
      // エラーをcontent scriptに送信
      chrome.tabs.sendMessage(tabId, {
        action: 'showError',
        error: result.error
      });
      return;
    }

    // 設定取得（autoOpenPopup判定用）
    const settingsResult = await chrome.storage.local.get(['settings']);
    const settings = settingsResult.settings
      ? { ...DEFAULT_SETTINGS, ...settingsResult.settings }
      : { ...DEFAULT_SETTINGS };

    // 履歴保存と最新翻訳の更新
    const entry = {
      originalText: text,
      translatedText: result.translation,
      sourceLang: sourceLang,
      targetLang: targetLang,
      timestamp: Date.now(),
      url: tabUrl
    };

    let storedEntry = null;
    try {
      storedEntry = await saveToHistory(entry);
    } catch (historyError) {
      console.error('Failed to persist translation history:', historyError);
    }

    if (storedEntry) {
      try {
        await chrome.storage.local.set({ latestTranslation: storedEntry });
      } catch (latestError) {
        console.error('Failed to update latestTranslation:', latestError);
      }
    }

    // Chrome 127+ で autoOpenPopup が有効かつサポートされていれば、
    // ポップアップを開き、成功したらオーバーレイ表示は抑止する
    const canAutoPopup = settings.autoOpenPopup && typeof chrome?.action?.openPopup === 'function';
    if (canAutoPopup) {
      try {
        await chrome.action.openPopup();
        // 成功: オーバーレイ抑止
        return;
      } catch (openErr) {
        // 失敗時は通知用のストレージ更新のみ行い、フォールバックとしてオーバーレイ表示
        try {
          await chrome.storage.local.set({
            autoOpenPopupNotice: {
              type: 'OPEN_FAILED',
              message: openErr?.message || '',
              timestamp: Date.now()
            }
          });
        } catch (_) {
          // no-op
        }
      }
    }

    // フォールバック：ページ内オーバーレイ表示
    chrome.tabs.sendMessage(tabId, {
      action: 'showTranslation',
      originalText: text,
      translatedText: result.translation,
      sourceLang: sourceLang,
      targetLang: targetLang,
      processingTime: result.processingTime
    });
  } catch (error) {
    console.error('Translation error:', error);
    chrome.tabs.sendMessage(tabId, {
      action: 'showError',
      error: '翻訳中にエラーが発生しました: ' + error.message
    });
  }
}

/**
 * 言語検出
 * @param {string} text - 検出対象テキスト
 * @returns {string} - 'Japanese' または 'English'
 */
function detectLanguage(text) {
  // 日本語文字（ひらがな、カタカナ、漢字）の検出
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  return japaneseRegex.test(text) ? 'Japanese' : 'English';
}

/**
 * PLaMo Translate用のプロンプトを構築
 * @param {string} text - 翻訳対象テキスト
 * @param {string} sourceLang - 元言語
 * @param {string} targetLang - 翻訳先言語
 * @returns {string} - PLaMo形式のプロンプト
 */
function buildTranslationPrompt(text, sourceLang, targetLang) {
  return `<|plamo:op|>dataset
translation

<|plamo:op|>input lang=${sourceLang}
${text}
<|plamo:op|>output lang=${targetLang}`;
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
    // 設定を取得
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings 
      ? { ...DEFAULT_SETTINGS, ...result.settings }
      : { ...DEFAULT_SETTINGS };

    // プロンプト構築
    const prompt = buildTranslationPrompt(text, sourceLang, targetLang);

    // LM Studio APIに送信
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
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const translation = data?.choices?.[0]?.message?.content?.trim();
    
    if (!translation) {
      throw new Error('Invalid response from translation API');
    }
    
    const processingTime = Date.now() - startTime;

    return {
      success: true,
      translation: translation,
      processingTime: processingTime
    };

  } catch (error) {
    console.error('Translation API error:', error);

    // エラーメッセージの日本語化
    let errorMessage = '翻訳エラーが発生しました';

    if (error.name === 'AbortError' || (typeof error.message === 'string' && error.message.includes('aborted'))) {
      errorMessage = 'リクエストがタイムアウトしました。';
    } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMessage = 'LM Studioに接続できません。サーバーが起動しているか確認してください。';
    } else if (error.message.includes('500')) {
      errorMessage = 'モデルエラーが発生しました。LM Studioの設定を確認してください。';
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
 * @returns {Promise<Object>} - 接続テスト結果
 */
async function testLMStudioConnection(overrideUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || DEFAULT_SETTINGS;

    const url = (typeof overrideUrl === 'string' && overrideUrl) ? overrideUrl : settings.lmStudioUrl;
    const response = await fetch(`${url}/v1/models`, {
      method: 'GET',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    return {
      success: true,
      models: data.data || []
    };

  } catch (error) {
    const message = error.name === 'AbortError' ? 'タイムアウトしました' : error.message;
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
    const result = await chrome.storage.local.get(['history']);
    let history = result.history || [];

    // 新しいエントリを生成
    const storedEntry = entry.id ? { ...entry } : { id: generateUUID(), ...entry };

    history.unshift(storedEntry);

    // 最大件数に制限
    if (history.length > MAX_HISTORY_ENTRIES) {
      history = history.slice(0, MAX_HISTORY_ENTRIES);
    }

    await chrome.storage.local.set({ history: history });
    return storedEntry;
  } catch (error) {
    console.error('Failed to save history:', error);
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
      return;
    }

    if (typeof chrome?.action?.openPopup !== 'function') {
      try {
        await chrome.storage.local.set({
          autoOpenPopupNotice: {
            type: 'UNSUPPORTED',
            timestamp: Date.now()
          }
        });
      } catch (storageError) {
        console.warn('Failed to persist unsupported auto-open notice:', storageError);
      }
      return;
    }

    if (typeof chrome?.action?.getUserSettings === 'function') {
      try {
        const userSettings = await chrome.action.getUserSettings();
        if (userSettings && userSettings.isOnToolbar === false) {
          try {
            await chrome.storage.local.set({
              autoOpenPopupNotice: {
                type: 'ACTION_HIDDEN',
                timestamp: Date.now()
              }
            });
          } catch (storageError) {
            console.warn('Failed to persist hidden action notice:', storageError);
          }
          return;
        }
      } catch (settingsError) {
        console.warn('Failed to read action user settings:', settingsError);
      }
    }

    await chrome.action.openPopup();
    try {
      await chrome.storage.local.set({ autoOpenPopupNotice: null });
    } catch (storageError) {
      console.warn('Failed to clear auto-open notice:', storageError);
    }
  } catch (error) {
    console.warn('Auto-open popup failed:', error);
    try {
      await chrome.storage.local.set({
        autoOpenPopupNotice: {
          type: 'OPEN_FAILED',
          message: error?.message || '',
          timestamp: Date.now()
        }
      });
    } catch (storageError) {
      console.warn('Failed to persist auto-open notice:', storageError);
    }
  }
}

/**
 * UUID生成
 * @returns {string} - UUID
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
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
