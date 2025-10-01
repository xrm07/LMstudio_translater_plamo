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
  autoShowPopup: true
};

// 拡張機能インストール時の初期化
chrome.runtime.onInstalled.addListener(() => {
  // デフォルト設定を保存
  chrome.storage.local.get(['settings'], (result) => {
    if (!result.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
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
    handleTranslation(info.selectionText, tab.id);
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
async function handleTranslation(text, tabId) {
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

      // 翻訳履歴に保存
      const translationData = {
        originalText: text,
        translatedText: result.translation,
        sourceLang: sourceLang,
        targetLang: targetLang,
        timestamp: Date.now(),
        processingTime: result.processingTime
      };
      
      saveToHistory(translationData);
      
      // 最新の翻訳データを保存（ポップアップ表示用）
      chrome.storage.local.set({ latestTranslation: translationData });
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

    // 新しいエントリを追加
    history.unshift({
      id: generateUUID(),
      ...entry
    });

    // 最大50件に制限
    if (history.length > 50) {
      history = history.slice(0, 50);
    }

    await chrome.storage.local.set({ history: history });
  } catch (error) {
    console.error('Failed to save history:', error);
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
