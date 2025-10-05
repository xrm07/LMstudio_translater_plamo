/**
 * PLaMo Translate - Popup Script
 * 拡張機能のポップアップUIロジック
 */

// DOM要素の取得
const tabs = document.querySelectorAll('.popup-tab');
const tabContents = document.querySelectorAll('.popup-content');

const lmstudioUrlInput = document.getElementById('lmstudio-url');
const modelNameInput = document.getElementById('model-name');
const modelOptionsDatalist = document.getElementById('model-options');
const maxTokensInput = document.getElementById('max-tokens');
const autoOpenCheckbox = document.getElementById('auto-open-popup');
const autoOpenHint = document.getElementById('auto-open-hint');
const autoOpenWarning = document.getElementById('auto-open-warning');

const testConnectionButton = document.getElementById('test-connection');
const saveSettingsButton = document.getElementById('save-settings');
const statusMessage = document.getElementById('status-message');

const clearHistoryButton = document.getElementById('clear-history');
const historyList = document.getElementById('history-list');
const latestContainer = document.getElementById('latest-translation');
const tabTargetButtons = document.querySelectorAll('[data-tab-target]');

// Default settings (matches DEFAULT_SETTINGS in background.js)
const DEFAULT_SETTINGS = {
  lmStudioUrl: 'http://localhost:1234',
  modelName: 'mmnga/plamo-2-translate-gguf',
  maxTokens: 1000,
  temperature: 0,
  autoOpenPopup: true
};

// Validation constants
const MIN_TOKENS = 100;
const MAX_TOKENS = 4096;

let availableModels = [];
let latestTranslation = null;
let historyCache = [];

/**
 * URLリンクを安全に作成するヘルパー関数
 * @param {string} url - 対象URL
 * @returns {Object} - {link: HTMLElement, isValid: boolean}
 */
function createSafeUrlLink(url) {
  const link = document.createElement('a');
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  
  let hostname = '';
  let isValid = false;
  
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      link.href = url;
      hostname = parsedUrl.hostname;
      isValid = true;
    }
  } catch (error) {
    // Invalid URL - link will not have href
  }
  
  link.textContent = isValid ? `ページを開く (${hostname})` : 'ページを開く';
  return { link, isValid };
}

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initLatestTabNavigation();
  initStorageListeners();

  loadSettings();
  loadHistory();
  checkAutoOpenSupport();

  switchTab('latest');
});

/**
 * タブの初期化
 */
function initTabs() {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      if (targetTab) {
        switchTab(targetTab);
      }
    });
  });
}

/**
 * 最新タブからのナビゲーション初期化
 */
function initLatestTabNavigation() {
  tabTargetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.tabTarget;
      if (target) {
        switchTab(target);
      }
    });
  });
}

/**
 * ストレージ変更リスナーを初期化
 */
function initStorageListeners() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (changes.latestTranslation) {
      latestTranslation = changes.latestTranslation.newValue || null;
      renderLatestTranslation(latestTranslation);
      renderHistory(historyCache);
    }

    if (changes.history) {
      const history = Array.isArray(changes.history.newValue) ? changes.history.newValue : [];
      renderHistory(history);
    }

    if (changes.autoOpenPopupNotice) {
      updateAutoOpenWarning(changes.autoOpenPopupNotice.newValue);
    }

    if (changes.settings && changes.settings.newValue) {
      const merged = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
      autoOpenCheckbox.checked = merged.autoOpenPopup !== false;
    }
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

  if (tabName === 'history') {
    loadHistory();
  }

  if (tabName === 'latest') {
    loadLatestTranslation();
  }
}

/**
 * 設定を読み込み
 */
function loadSettings() {
  chrome.storage.local.get(['settings', 'availableModels'], (result) => {
    const settings = result.settings
      ? { ...DEFAULT_SETTINGS, ...result.settings }
      : { ...DEFAULT_SETTINGS };

    availableModels = Array.isArray(result.availableModels) ? result.availableModels : [];
    renderModelOptions(availableModels);

    lmstudioUrlInput.value = settings.lmStudioUrl;
    modelNameInput.value = settings.modelName;
    maxTokensInput.value = settings.maxTokens;
    autoOpenCheckbox.checked = settings.autoOpenPopup !== false;
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
    autoOpenPopup: autoOpenCheckbox.checked
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

  if (Number.isNaN(settings.maxTokens) || settings.maxTokens < MIN_TOKENS || settings.maxTokens > MAX_TOKENS) {
    showStatus(`最大トークン数は${MIN_TOKENS}〜${MAX_TOKENS}の範囲で指定してください`, 'error');
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
      const models = Array.isArray(response.models) ? response.models : [];
      const modelCount = models.length;
      const modelIds = models
        .map(model => model?.id)
        .filter(id => typeof id === 'string' && id.length > 0);

      availableModels = modelIds;
      renderModelOptions(availableModels);

      if (availableModels.length > 0 && !availableModels.includes(modelNameInput.value.trim())) {
        modelNameInput.value = availableModels[0];
      }

      chrome.storage.local.set({ availableModels });

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
 * 最新翻訳を読み込み
 */
function loadLatestTranslation() {
  chrome.storage.local.get(['latestTranslation'], (result) => {
    latestTranslation = result.latestTranslation || null;
    renderLatestTranslation(latestTranslation);
  });
}

/**
 * 最新翻訳を描画
 * @param {Object|null} entry - 最新翻訳エントリ
 */
function renderLatestTranslation(entry) {
  if (!latestContainer) {
    return;
  }

  latestContainer.textContent = '';

  if (!entry) {
    const empty = document.createElement('div');
    empty.className = 'latest-empty';
    empty.textContent = 'まだ翻訳が実行されていません。';
    latestContainer.appendChild(empty);
    return;
  }

  const card = document.createElement('div');
  card.className = 'latest-card latest-highlight';

  const header = document.createElement('div');
  header.className = 'latest-header';

  const lang = document.createElement('span');
  lang.className = 'latest-lang';
  lang.textContent = `${entry.sourceLang} → ${entry.targetLang}`;

  const time = document.createElement('span');
  time.className = 'latest-time';
  time.textContent = formatTimestamp(entry.timestamp);

  header.appendChild(lang);
  header.appendChild(time);

  const original = document.createElement('div');
  original.className = 'latest-original';
  original.textContent = entry.originalText;

  const arrow = document.createElement('div');
  arrow.className = 'latest-arrow';
  arrow.textContent = '↓';

  const translated = document.createElement('div');
  translated.className = 'latest-translated';
  translated.textContent = entry.translatedText;

  card.appendChild(header);
  card.appendChild(original);
  card.appendChild(arrow);
  card.appendChild(translated);

  if (entry.url) {
    const urlWrapper = document.createElement('div');
    urlWrapper.className = 'latest-url';

    const { link } = createSafeUrlLink(entry.url);
    urlWrapper.appendChild(link);
    card.appendChild(urlWrapper);
  }

  latestContainer.appendChild(card);
}

/**
 * 履歴を読み込み
 */
function loadHistory() {
  chrome.storage.local.get(['history'], (result) => {
    const history = Array.isArray(result.history) ? result.history : [];
    renderHistory(history);
  });
}

/**
 * 履歴を描画
 * @param {Object[]} history - 履歴エントリ一覧
 */
function renderHistory(history) {
  historyCache = history;

  if (historyList) {
    if (history.length === 0) {
      historyList.textContent = '';
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'history-empty';
      emptyDiv.textContent = '翻訳履歴はありません';
      historyList.appendChild(emptyDiv);
      return;
    }

    historyList.textContent = '';

    history.forEach((entry) => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';

      if (latestTranslation && entry.id === latestTranslation.id) {
        historyItem.classList.add('latest-highlight');
      }

      const header = document.createElement('div');
      header.className = 'history-header';

      const lang = document.createElement('span');
      lang.className = 'history-lang';
      lang.textContent = `${entry.sourceLang} → ${entry.targetLang}`;

      const time = document.createElement('span');
      time.className = 'history-time';
      time.textContent = formatTimestamp(entry.timestamp);

      header.appendChild(lang);
      header.appendChild(time);

      const original = document.createElement('div');
      original.className = 'history-original';
      original.textContent = entry.originalText;

      const arrow = document.createElement('div');
      arrow.className = 'history-arrow';
      arrow.textContent = '↓';

      const translated = document.createElement('div');
      translated.className = 'history-translated';
      translated.textContent = entry.translatedText;

      historyItem.appendChild(header);
      historyItem.appendChild(original);
      historyItem.appendChild(arrow);
      historyItem.appendChild(translated);

      if (entry.url) {
        const urlWrapper = document.createElement('div');
        urlWrapper.className = 'history-url';

        const { link } = createSafeUrlLink(entry.url);
        urlWrapper.appendChild(link);
        historyItem.appendChild(urlWrapper);
      }

      historyList.appendChild(historyItem);
    });
  }
}

/**
 * 履歴を消去
 */
function clearHistory() {
  if (!confirm('翻訳履歴を全て消去しますか？')) {
    return;
  }

  chrome.storage.local.set({ history: [], latestTranslation: null }, () => {
    historyCache = [];
    latestTranslation = null;
    renderHistory([]);
    renderLatestTranslation(null);
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
 * モデル候補を描画
 * @param {string[]} models - モデルID一覧
 */
function renderModelOptions(models) {
  if (!modelOptionsDatalist) {
    return;
  }

  modelOptionsDatalist.textContent = '';

  models.forEach((modelId) => {
    const option = document.createElement('option');
    option.value = modelId;
    modelOptionsDatalist.appendChild(option);
  });
}

/**
 * 自動ポップアップのサポート状態を確認
 */
function checkAutoOpenSupport() {
  const supportsOpenPopup = typeof chrome?.action?.openPopup === 'function';

  if (!supportsOpenPopup) {
    autoOpenCheckbox.checked = false;
    autoOpenCheckbox.disabled = true;
    autoOpenHint.textContent = 'お使いのブラウザではポップアップの自動表示がサポートされていません。';
    updateAutoOpenWarning({ type: 'UNSUPPORTED' });
    return;
  }

  autoOpenCheckbox.disabled = false;
  autoOpenHint.textContent = 'ポップアップが表示されない場合は、拡張機能アイコンをツールバーへピン留めしてください。';

  if (typeof chrome?.action?.getUserSettings === 'function') {
    chrome.action.getUserSettings().then((userSettings) => {
      if (userSettings && userSettings.isOnToolbar === false && autoOpenCheckbox.checked) {
        updateAutoOpenWarning({ type: 'ACTION_HIDDEN' });
      }
    }).catch(() => {
      // 取得失敗時は何もしない
    });
  }

  chrome.storage.local.get(['autoOpenPopupNotice'], (result) => {
    if (result.autoOpenPopupNotice) {
      updateAutoOpenWarning(result.autoOpenPopupNotice);
    } else {
      updateAutoOpenWarning(null);
    }
  });
}

/**
 * 自動ポップアップ警告を更新
 * @param {Object|null} notice - 警告メッセージ情報
 */
function updateAutoOpenWarning(notice) {
  if (!autoOpenWarning) {
    return;
  }

  if (!autoOpenCheckbox.checked) {
    autoOpenWarning.classList.add('hidden');
    autoOpenWarning.textContent = '';
    return;
  }

  if (!notice) {
    autoOpenWarning.classList.add('hidden');
    autoOpenWarning.textContent = '';
    return;
  }

  let message = '';

  switch (notice.type) {
    case 'UNSUPPORTED':
      message = 'ポップアップの自動表示は現在のブラウザでは利用できません。';
      break;
    case 'ACTION_HIDDEN':
      message = '拡張機能アイコンがツールバーに表示されていないため自動表示できません。Chromeの拡張機能メニューからピン留めしてください。';
      break;
    case 'OPEN_FAILED': {
      const detail = notice.message ? `（${notice.message}）` : '';
      message = `ポップアップを自動表示できませんでした${detail}`;
      break;
    }
    default:
      message = '';
  }

  if (!message) {
    autoOpenWarning.classList.add('hidden');
    autoOpenWarning.textContent = '';
    return;
  }

  autoOpenWarning.textContent = message;
  autoOpenWarning.classList.remove('hidden');
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

// イベントリスナー
saveSettingsButton.addEventListener('click', saveSettings);
testConnectionButton.addEventListener('click', testConnection);
clearHistoryButton.addEventListener('click', clearHistory);

autoOpenCheckbox.addEventListener('change', () => {
  if (!autoOpenCheckbox.checked) {
    updateAutoOpenWarning(null);
  } else {
    checkAutoOpenSupport();
  }
});
*** End of File
