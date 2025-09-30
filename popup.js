/**
 * PLaMo Translate - Popup Script
 * 拡張機能のポップアップUIロジック
 */

// DOM要素の取得
const tabs = document.querySelectorAll('.popup-tab');
const tabContents = document.querySelectorAll('.popup-content');

const lmstudioUrlInput = document.getElementById('lmstudio-url');
const modelNameInput = document.getElementById('model-name');
const maxTokensInput = document.getElementById('max-tokens');

const testConnectionButton = document.getElementById('test-connection');
const saveSettingsButton = document.getElementById('save-settings');
const statusMessage = document.getElementById('status-message');

const clearHistoryButton = document.getElementById('clear-history');
const historyList = document.getElementById('history-list');

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadHistory();
  initTabs();
});

/**
 * タブの初期化
 */
function initTabs() {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      switchTab(targetTab);
    });
  });
}

/**
 * タブ切り替え
 * @param {string} tabName - タブ名
 */
function switchTab(tabName) {
  // タブボタンのアクティブ状態を更新
  tabs.forEach(tab => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // コンテンツの表示/非表示を切り替え
  tabContents.forEach(content => {
    if (content.id === `${tabName}-tab`) {
      content.classList.remove('hidden');
    } else {
      content.classList.add('hidden');
    }
  });

  // 履歴タブを開いた時は履歴を更新
  if (tabName === 'history') {
    loadHistory();
  }
}

/**
 * 設定を読み込み
 */
function loadSettings() {
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || {
      lmStudioUrl: 'http://localhost:1234',
      modelName: 'mmnga/plamo-2-translate-gguf',
      maxTokens: 1000,
      temperature: 0
    };

    lmstudioUrlInput.value = settings.lmStudioUrl;
    modelNameInput.value = settings.modelName;
    maxTokensInput.value = settings.maxTokens;
  });
}

/**
 * 設定を保存
 */
function saveSettings() {
  const settings = {
    lmStudioUrl: lmstudioUrlInput.value.trim(),
    modelName: modelNameInput.value.trim(),
    maxTokens: parseInt(maxTokensInput.value, 10),
    temperature: 0
  };

  // バリデーション
  if (!settings.lmStudioUrl) {
    showStatus('LM Studio URLを入力してください', 'error');
    return;
  }

  if (!settings.modelName) {
    showStatus('モデル名を入力してください', 'error');
    return;
  }

  if (settings.maxTokens < 100 || settings.maxTokens > 4096) {
    showStatus('最大トークン数は100〜4096の範囲で指定してください', 'error');
    return;
  }

  // 保存
  chrome.storage.local.set({ settings }, () => {
    showStatus('✅ 設定を保存しました', 'success');
  });
}

/**
 * 接続テスト
 */
async function testConnection() {
  showStatus('🔄 接続テスト中...', 'info');
  testConnectionButton.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'testConnection'
    });

    if (response.success) {
      const modelCount = response.models.length;
      showStatus(`✅ 接続成功！（${modelCount}個のモデルが利用可能）`, 'success');
    } else {
      showStatus(`❌ 接続失敗: ${response.error}`, 'error');
    }
  } catch (error) {
    showStatus(`❌ エラー: ${error.message}`, 'error');
  } finally {
    testConnectionButton.disabled = false;
  }
}

/**
 * ステータスメッセージを表示
 * @param {string} message - メッセージ
 * @param {string} type - タイプ (success, error, info)
 */
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message status-${type}`;
  statusMessage.style.display = 'block';

  // 3秒後に自動で消す（エラー以外）
  if (type !== 'error') {
    setTimeout(() => {
      statusMessage.style.display = 'none';
    }, 3000);
  }
}

/**
 * 履歴を読み込み
 */
function loadHistory() {
  chrome.storage.local.get(['history'], (result) => {
    const history = result.history || [];

    if (history.length === 0) {
      historyList.innerHTML = '<div class="history-empty">翻訳履歴はありません</div>';
      return;
    }

    // 履歴を表示
    historyList.innerHTML = history.map(entry => `
      <div class="history-item">
        <div class="history-header">
          <span class="history-lang">${entry.sourceLang} → ${entry.targetLang}</span>
          <span class="history-time">${formatTimestamp(entry.timestamp)}</span>
        </div>
        <div class="history-original">${escapeHtml(entry.originalText)}</div>
        <div class="history-arrow">↓</div>
        <div class="history-translated">${escapeHtml(entry.translatedText)}</div>
      </div>
    `).join('');
  });
}

/**
 * 履歴を消去
 */
function clearHistory() {
  if (!confirm('翻訳履歴を全て消去しますか？')) {
    return;
  }

  chrome.storage.local.set({ history: [] }, () => {
    loadHistory();
    showStatus('✅ 履歴を消去しました', 'success');
  });
}

/**
 * タイムスタンプを整形
 * @param {number} timestamp - Unixタイムスタンプ
 * @returns {string} - 整形された日時文字列
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 1分以内
  if (diff < 60000) {
    return 'たった今';
  }

  // 1時間以内
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}分前`;
  }

  // 24時間以内
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}時間前`;
  }

  // それ以降
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();

  return `${month}月${day}日 ${hours}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * HTMLエスケープ（XSS対策）
 * @param {string} text - エスケープ対象テキスト
 * @returns {string} - エスケープ済みテキスト
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// イベントリスナー
saveSettingsButton.addEventListener('click', saveSettings);
testConnectionButton.addEventListener('click', testConnection);
clearHistoryButton.addEventListener('click', clearHistory);
