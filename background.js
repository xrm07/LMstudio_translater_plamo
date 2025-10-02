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

// 拡張機能インストール時の初期化
chrome.runtime.onInstalled.addListener(() => {
  // デフォルト設定を保存（既存ユーザーも不足しているキーを補完）
  chrome.storage.local.get(['settings'], (result) => {
    const existingSettings = result.settings || {};
    const mergedSettings = {
      ...DEFAULT_SETTINGS,
      ...existingSettings
    };

    const needsUpdate = !result.settings || Object.keys(DEFAULT_SETTINGS).some((key) => existingSettings[key] === undefined);

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
    testLMStudioConnection()
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

    if (result.success) {
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
        console.error('Failed to persist translation history:', historyError);
      }

      // 最新翻訳を保存
      if (storedEntry) {
        try {
          await chrome.storage.local.set({ latestTranslation: storedEntry });
        } catch (latestError) {
          console.error('Failed to update latestTranslation:', latestError);
        }
      } else {
        console.warn('Latest translation not updated because history entry was unavailable.');
      }

      // オプションに応じてポップアップを自動表示
      maybeAutoOpenPopup().catch((popupError) => {
        if (popupError instanceof Error) {
          console.warn(
            `maybeAutoOpenPopup rejection: [${popupError.name}] ${popupError.message}\n${popupError.stack}`
          );
        } else {
          console.warn('maybeAutoOpenPopup rejection:', popupError);
        }
      });
    } else {
      // エラーをcontent scriptに送信
      chrome.tabs.sendMessage(tabId, {
        action: 'showError',
        error: result.error
      });
    }
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

  try {
    // 設定を取得
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || DEFAULT_SETTINGS;

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
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const translation = data.choices[0].message.content.trim();
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

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMessage = 'LM Studioに接続できません。サーバーが起動しているか確認してください。';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'リクエストがタイムアウトしました。';
    } else if (error.message.includes('500')) {
      errorMessage = 'モデルエラーが発生しました。LM Studioの設定を確認してください。';
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * LM Studio接続テスト
 * @returns {Promise<Object>} - 接続テスト結果
 */
async function testLMStudioConnection() {
  try {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || DEFAULT_SETTINGS;

    const response = await fetch(`${settings.lmStudioUrl}/v1/models`, {
      method: 'GET'
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
    return {
      success: false,
      error: 'LM Studioに接続できません: ' + error.message
    };
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

    // 最大50件に制限
    if (history.length > 50) {
      history = history.slice(0, 50);
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
