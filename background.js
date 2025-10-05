/**
 * PLaMo Translate - Background Service Worker
 * LM Studio APIとの連携、翻訳ロジックを管理
 */

// ログユーティリティ関数
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const levelName = Object.keys(LogLevel)[level];
  const logMessage = `[${timestamp}] [${levelName}] ${message}`;

  if (data) {
    console.log(logMessage, data);
  } else {
    console.log(logMessage);
  }
}

// デフォルト設定
const DEFAULT_SETTINGS = {
  lmStudioUrl: 'http://localhost:1234',
  modelName: 'mmnga/plamo-2-translate-gguf',
  maxTokens: 1000,
  temperature: 0
};

// 拡張機能インストール時の初期化
chrome.runtime.onInstalled.addListener((details) => {
  log(LogLevel.INFO, '拡張機能がインストールされました', {
    reason: details.reason,
    version: chrome.runtime.getManifest().version
  });

  // デフォルト設定を保存
  chrome.storage.local.get(['settings'], (result) => {
    if (!result.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
      log(LogLevel.INFO, 'デフォルト設定を保存しました', DEFAULT_SETTINGS);
    } else {
      log(LogLevel.INFO, '既存の設定を使用します', result.settings);
    }
  });

  // コンテキストメニューを作成
  chrome.contextMenus.create({
    id: 'translate-with-plamo',
    title: 'PLaMoで翻訳: "%s"',
    contexts: ['selection']
  });

  log(LogLevel.INFO, 'コンテキストメニューを作成しました');
});

// コンテキストメニューのクリックイベント
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translate-with-plamo' && info.selectionText) {
    log(LogLevel.INFO, '翻訳リクエストを開始します', {
      textLength: info.selectionText.length,
      tabId: tab.id,
      pageUrl: info.pageUrl
    });
    handleTranslation(info.selectionText, tab.id);
  }
});

// メッセージリスナー（content scriptからの翻訳リクエスト）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log(LogLevel.DEBUG, 'メッセージを受信しました', {
    action: request.action,
    senderTabId: sender.tab?.id
  });

  if (request.action === 'translate') {
    log(LogLevel.INFO, '翻訳メッセージリクエストを処理します', {
      textLength: request.text?.length,
      sourceLang: request.sourceLang,
      targetLang: request.targetLang
    });

    translateText(request.text, request.sourceLang, request.targetLang)
      .then(result => {
        log(LogLevel.DEBUG, '翻訳メッセージレスポンスを送信します', {
          success: result.success
        });
        sendResponse(result);
      })
      .catch(error => {
        log(LogLevel.ERROR, '翻訳メッセージ処理中にエラーが発生しました', {
          error: error.message
        });
        sendResponse({
          success: false,
          error: error.message
        });
      });
    return true; // 非同期レスポンスを示す
  }

  if (request.action === 'testConnection') {
    log(LogLevel.INFO, '接続テストメッセージリクエストを処理します');

    testLMStudioConnection()
      .then(result => {
        log(LogLevel.DEBUG, '接続テストメッセージレスポンスを送信します', {
          success: result.success
        });
        sendResponse(result);
      })
      .catch(error => {
        log(LogLevel.ERROR, '接続テストメッセージ処理中にエラーが発生しました', {
          error: error.message
        });
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
 */
async function handleTranslation(text, tabId) {
  try {
    log(LogLevel.INFO, '翻訳処理を開始します', {
      textLength: text.length,
      tabId: tabId
    });

    // 言語検出
    const sourceLang = detectLanguage(text);
    const targetLang = sourceLang === 'Japanese' ? 'English' : 'Japanese';

    log(LogLevel.DEBUG, '言語検出結果', {
      sourceLang: sourceLang,
      targetLang: targetLang,
      textPreview: text.substring(0, 50) + (text.length > 50 ? '...' : '')
    });

    // 翻訳実行
    const result = await translateText(text, sourceLang, targetLang);

    if (result.success) {
      log(LogLevel.INFO, '翻訳成功', {
        processingTime: result.processingTime,
        translationLength: result.translation.length
      });

      // content scriptに結果を送信
      chrome.tabs.sendMessage(tabId, {
        action: 'showTranslation',
        originalText: text,
        translatedText: result.translation,
        sourceLang: sourceLang,
        targetLang: targetLang,
        processingTime: result.processingTime
      });

      // 翻訳履歴に保存
      saveToHistory({
        originalText: text,
        translatedText: result.translation,
        sourceLang: sourceLang,
        targetLang: targetLang,
        timestamp: Date.now()
      });

      log(LogLevel.DEBUG, '翻訳結果を送信しました', {
        tabId: tabId,
        processingTime: result.processingTime
      });
    } else {
      log(LogLevel.WARN, '翻訳失敗', {
        error: result.error
      });

      // エラーをcontent scriptに送信
      chrome.tabs.sendMessage(tabId, {
        action: 'showError',
        error: result.error
      });
    }
  } catch (error) {
    log(LogLevel.ERROR, '翻訳処理中に予期しないエラーが発生しました', {
      error: error.message,
      stack: error.stack,
      tabId: tabId
    });

    chrome.tabs.sendMessage(tabId, {
      action: 'showError',
      error: '翻訳中に予期しないエラーが発生しました: ' + error.message
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
    log(LogLevel.DEBUG, '翻訳API呼び出しを開始します', {
      sourceLang: sourceLang,
      targetLang: targetLang,
      textLength: text.length
    });

    // 設定を取得
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || DEFAULT_SETTINGS;

    log(LogLevel.DEBUG, '設定を取得しました', {
      lmStudioUrl: settings.lmStudioUrl,
      modelName: settings.modelName
    });

    // プロンプト構築
    const prompt = buildTranslationPrompt(text, sourceLang, targetLang);

    // LM Studio APIに送信
    log(LogLevel.DEBUG, 'LM Studio APIを呼び出します', {
      url: `${settings.lmStudioUrl}/v1/chat/completions`,
      model: settings.modelName
    });

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
      log(LogLevel.ERROR, 'API呼び出しに失敗しました', {
        status: response.status,
        statusText: response.statusText,
        url: settings.lmStudioUrl
      });
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const translation = data.choices[0].message.content.trim();
    const processingTime = Date.now() - startTime;

    log(LogLevel.INFO, '翻訳API呼び出し成功', {
      processingTime: processingTime,
      responseLength: translation.length,
      tokensUsed: data.usage?.total_tokens
    });

    return {
      success: true,
      translation: translation,
      processingTime: processingTime
    };

  } catch (error) {
    log(LogLevel.ERROR, '翻訳APIエラーが発生しました', {
      error: error.message,
      stack: error.stack,
      url: settings?.lmStudioUrl
    });

    // エラーメッセージの日本語化
    let errorMessage = '翻訳エラーが発生しました';

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMessage = 'LM Studioに接続できません。サーバーが起動しているか確認してください。';
      log(LogLevel.ERROR, 'LM Studio接続エラー', {
        error: error.message
      });
    } else if (error.message.includes('timeout')) {
      errorMessage = 'リクエストがタイムアウトしました。';
      log(LogLevel.WARN, '翻訳タイムアウト', {
        timeout: true
      });
    } else if (error.message.includes('500')) {
      errorMessage = 'モデルエラーが発生しました。LM Studioの設定を確認してください。';
      log(LogLevel.ERROR, 'モデルサーバーエラー', {
        status: 500
      });
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
    log(LogLevel.INFO, 'LM Studio接続テストを開始します');

    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || DEFAULT_SETTINGS;

    log(LogLevel.DEBUG, '接続テスト設定', {
      url: settings.lmStudioUrl
    });

    const response = await fetch(`${settings.lmStudioUrl}/v1/models`, {
      method: 'GET'
    });

    if (!response.ok) {
      log(LogLevel.ERROR, '接続テスト失敗', {
        status: response.status,
        statusText: response.statusText
      });
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const modelCount = data.data?.length || 0;

    log(LogLevel.INFO, 'LM Studio接続テスト成功', {
      modelCount: modelCount,
      models: data.data?.map(m => m.id) || []
    });

    return {
      success: true,
      models: data.data || []
    };

  } catch (error) {
    log(LogLevel.ERROR, 'LM Studio接続テストエラー', {
      error: error.message
    });

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
    log(LogLevel.DEBUG, '翻訳履歴を保存します', {
      sourceLang: entry.sourceLang,
      targetLang: entry.targetLang,
      textLength: entry.originalText.length
    });

    const result = await chrome.storage.local.get(['history']);
    let history = result.history || [];

    // 新しいエントリを追加
    const newEntry = {
      id: generateUUID(),
      ...entry
    };

    history.unshift(newEntry);

    // 最大50件に制限
    if (history.length > 50) {
      history = history.slice(0, 50);
      log(LogLevel.DEBUG, '履歴が上限に達したため古いエントリを削除しました');
    }

    await chrome.storage.local.set({ history: history });

    log(LogLevel.INFO, '翻訳履歴を保存しました', {
      historyCount: history.length,
      entryId: newEntry.id
    });
  } catch (error) {
    log(LogLevel.ERROR, '翻訳履歴の保存に失敗しました', {
      error: error.message,
      stack: error.stack
    });
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
