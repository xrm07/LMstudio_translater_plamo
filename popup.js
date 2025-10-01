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
const autoShowPopupCheckbox = document.getElementById('auto-show-popup');

const testConnectionButton = document.getElementById('test-connection');
const saveSettingsButton = document.getElementById('save-settings');
const statusMessage = document.getElementById('status-message');

const clearHistoryButton = document.getElementById('clear-history');
const historyList = document.getElementById('history-list');
const latestTranslationDiv = document.getElementById('latest-translation');

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadLatestTranslation();
  loadHistory();
  initTabs();
  initStorageListener();
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
  
  // 最新タブを開いた時は最新翻訳を更新
  if (tabName === 'latest') {
    loadLatestTranslation();
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
      temperature: 0,
      autoShowPopup: true
    };

    lmstudioUrlInput.value = settings.lmStudioUrl;
    modelNameInput.value = settings.modelName;
    maxTokensInput.value = settings.maxTokens;
    autoShowPopupCheckbox.checked = settings.autoShowPopup !== false; // デフォルトはtrue
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
    temperature: 0,
    autoShowPopup: autoShowPopupCheckbox.checked
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

    // 履歴を表示（最新のエントリには特別なクラスを追加）
    historyList.innerHTML = history.map((entry, index) => `
      <div class="history-item${index === 0 ? ' history-item-latest' : ''}">
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

/**
 * 最新翻訳を読み込み
 */
function loadLatestTranslation() {
  chrome.storage.local.get(['latestTranslation'], (result) => {
    const latest = result.latestTranslation;
    
    if (!latest) {
      latestTranslationDiv.innerHTML = `
        <div class="latest-empty">
          <p>まだ翻訳がありません</p>
          <p class="latest-hint">テキストを選択して右クリックから翻訳を実行してください</p>
        </div>
      `;
      return;
    }
    
    // 最新翻訳を表示
    latestTranslationDiv.innerHTML = `
      <div class="latest-card">
        <div class="latest-header">
          <span class="latest-lang">${latest.sourceLang} → ${latest.targetLang}</span>
          <span class="latest-time">${formatTimestamp(latest.timestamp)}</span>
        </div>
        <div class="latest-section">
          <div class="latest-label">元のテキスト:</div>
          <div class="latest-text latest-original">${escapeHtml(latest.originalText)}</div>
        </div>
        <div class="latest-divider">↓</div>
        <div class="latest-section">
          <div class="latest-label">翻訳結果:</div>
          <div class="latest-text latest-translated">${escapeHtml(latest.translatedText)}</div>
        </div>
        <div class="latest-footer">
          <span class="latest-processing">処理時間: ${(latest.processingTime / 1000).toFixed(2)}秒</span>
          <button class="btn btn-secondary btn-copy" id="copy-latest">📋 コピー</button>
        </div>
      </div>
    `;
    
    // コピーボタンのイベントリスナー
    const copyButton = document.getElementById('copy-latest');
    if (copyButton) {
      copyButton.addEventListener('click', () => {
        copyToClipboard(latest.translatedText);
        copyButton.textContent = '✓ コピーしました';
        setTimeout(() => {
          copyButton.textContent = '📋 コピー';
        }, 2000);
      });
    }
  });
}

/**
 * クリップボードにコピー
 * @param {string} text - コピーするテキスト
 */
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(err => {
      console.error('Failed to copy text:', err);
    });
  }
}

/**
 * ストレージ変更のリスナーを初期化
 */
function initStorageListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.latestTranslation) {
      // 最新翻訳が更新されたら表示を更新
      loadLatestTranslation();
      
      // 現在履歴タブを開いている場合は履歴も更新
      const activeTab = document.querySelector('.popup-tab.active');
      if (activeTab && activeTab.dataset.tab === 'history') {
        loadHistory();
      }
      
      // 最新タブに自動切り替え（設定で有効な場合）
      chrome.storage.local.get(['settings'], (result) => {
        const settings = result.settings || {};
        if (settings.autoShowPopup !== false) {
          switchTab('latest');
        }
      });
    }
  });
}

// イベントリスナー
saveSettingsButton.addEventListener('click', saveSettings);
testConnectionButton.addEventListener('click', testConnection);
clearHistoryButton.addEventListener('click', clearHistory);
