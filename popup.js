/**
 * PLaMo Translate - Popup Script
 * 拡張機能のポップアップUIロジック
 */

import { log, LogLevel } from './logger.js';

// DOM要素の取得
const tabs = document.querySelectorAll('.popup-tab');
const tabContents = document.querySelectorAll('.popup-content');

const lmstudioUrlInput = /** @type {HTMLInputElement|null} */ (document.getElementById('lmstudio-url'));
const modelNameInput = /** @type {HTMLInputElement|null} */ (document.getElementById('model-name'));
const maxTokensInput = /** @type {HTMLInputElement|null} */ (document.getElementById('max-tokens'));
const autoOpenCheckbox = /** @type {HTMLInputElement|null} */ (document.getElementById('auto-open-popup'));
const modelOptionsList = /** @type {HTMLDataListElement|null} */ (document.getElementById('model-options'));

const testConnectionButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('test-connection'));
const saveSettingsButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('save-settings'));
const statusMessage = /** @type {HTMLDivElement|null} */ (document.getElementById('status-message'));

const clearHistoryButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('clear-history'));
const historyList = document.getElementById('history-list');

const latestCard = /** @type {HTMLElement|null} */ (document.querySelector('.latest-card'));
const latestOriginal = /** @type {HTMLElement|null} */ (document.querySelector('.latest-original'));
const latestTranslated = /** @type {HTMLElement|null} */ (document.querySelector('.latest-translated'));
const latestLang = /** @type {HTMLElement|null} */ (document.querySelector('.latest-lang'));
const latestTime = /** @type {HTMLTimeElement|null} */ (document.querySelector('.latest-time'));
const latestEmpty = /** @type {HTMLElement|null} */ (document.querySelector('.latest-empty'));
const latestMeta = /** @type {HTMLElement|null} */ (document.getElementById('latest-meta'));
const latestUrlLink = /** @type {HTMLAnchorElement|null} */ (document.querySelector('.latest-url a'));

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  log(LogLevel.INFO, 'ポップアップ初期化開始', null, 'PopupScript');

  loadSettings();
  loadHistory();
  loadLatest();
  initTabs();

  chrome.storage.onChanged.addListener(handleStorageChange);

  log(LogLevel.INFO, 'ポップアップ初期化完了', null, 'PopupScript');
});

window.addEventListener('unload', () => {
  try {
    chrome.storage.onChanged.removeListener(handleStorageChange);
  } catch (error) {
    log(LogLevel.DEBUG, 'storage listener removal skipped', { error: error?.message }, 'PopupScript');
  }
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
  log(LogLevel.DEBUG, '設定を読み込みます', null, 'PopupScript');

  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || {
      lmStudioUrl: 'http://localhost:1234',
      modelName: 'mmnga/plamo-2-translate-gguf',
      maxTokens: 1000,
      temperature: 0,
      autoOpenPopup: false
    };

    log(LogLevel.DEBUG, '設定を読み込みました', {
      lmStudioUrl: settings.lmStudioUrl,
      modelName: settings.modelName,
      maxTokens: settings.maxTokens,
      autoOpenPopup: settings.autoOpenPopup
    }, 'PopupScript');

    if (lmstudioUrlInput) lmstudioUrlInput.value = settings.lmStudioUrl;
    if (modelNameInput) modelNameInput.value = settings.modelName;
    if (maxTokensInput) maxTokensInput.value = String(settings.maxTokens);
    if (autoOpenCheckbox) autoOpenCheckbox.checked = Boolean(settings.autoOpenPopup);
  });
}

/**
 * 設定を保存
 */
function saveSettings() {
  log(LogLevel.DEBUG, '設定を保存します', null, 'PopupScript');

  if (!lmstudioUrlInput || !modelNameInput || !maxTokensInput) {
    log(LogLevel.ERROR, '設定フォーム要素が見つかりません', null, 'PopupScript');
    return;
  }

  const settings = {
    lmStudioUrl: lmstudioUrlInput.value.trim(),
    modelName: modelNameInput.value.trim(),
    maxTokens: parseInt(maxTokensInput.value, 10),
    temperature: 0,
    autoOpenPopup: Boolean(autoOpenCheckbox?.checked)
  };

  log(LogLevel.DEBUG, '設定値', {
    lmStudioUrl: settings.lmStudioUrl,
    modelName: settings.modelName,
    maxTokens: settings.maxTokens
  }, 'PopupScript');

  // バリデーション
  if (!settings.lmStudioUrl) {
    log(LogLevel.WARN, 'バリデーションエラー: LM Studio URLが空', null, 'PopupScript');
    showStatus('LM Studio URLを入力してください', 'error');
    return;
  }

  if (!settings.modelName) {
    log(LogLevel.WARN, 'バリデーションエラー: モデル名が空', null, 'PopupScript');
    showStatus('モデル名を入力してください', 'error');
    return;
  }

  if (settings.maxTokens < 100 || settings.maxTokens > 4096) {
    log(LogLevel.WARN, 'バリデーションエラー: 最大トークン数の範囲外', {
      maxTokens: settings.maxTokens
    }, 'PopupScript');
    showStatus('最大トークン数は100〜4096の範囲で指定してください', 'error');
    return;
  }

  // 保存
  chrome.storage.local.set({ settings }, () => {
    log(LogLevel.INFO, '設定を保存しました', settings, 'PopupScript');
    showStatus('✅ 設定を保存しました', 'success');
  });
}

/**
 * 接続テスト
 */
async function testConnection() {
  log(LogLevel.INFO, '接続テストを開始します', null, 'PopupScript');

  showStatus('🔄 接続テスト中...', 'info');
  if (testConnectionButton) {
    testConnectionButton.disabled = true;
  }

  try {
    log(LogLevel.DEBUG, '接続テストメッセージを送信します', null, 'PopupScript');

    const override = {
      lmStudioUrl: lmstudioUrlInput?.value.trim() || 'http://localhost:1234',
      modelName: modelNameInput?.value.trim() || 'mmnga/plamo-2-translate-gguf'
    };

    const response = await chrome.runtime.sendMessage({
      action: 'testConnection',
      settingsOverride: override
    });

    if (response.success) {
      const modelCount = response.models.length;
      log(LogLevel.INFO, '接続テスト成功', {
        modelCount: modelCount,
        models: response.models.map(m => m.id)
      }, 'PopupScript');

      populateModelOptions(response.models);
      if (modelNameInput && !modelNameInput.value && response.models[0]?.id) {
        modelNameInput.value = response.models[0].id;
      }
      showStatus(`✅ 接続成功！（${modelCount}個のモデルが利用可能）`, 'success');
    } else {
      log(LogLevel.ERROR, '接続テスト失敗', {
        error: response.error
      }, 'PopupScript');

      showStatus(`❌ 接続失敗: ${response.error}`, 'error');
    }
  } catch (error) {
    log(LogLevel.ERROR, '接続テスト中にエラーが発生しました', {
      error: error.message
    }, 'PopupScript');

    showStatus(`❌ エラー: ${error.message}`, 'error');
  } finally {
    if (testConnectionButton) {
      testConnectionButton.disabled = false;
    }
    log(LogLevel.DEBUG, '接続テスト完了', null, 'PopupScript');
  }
}

/**
 * ステータスメッセージを表示
 * @param {string} message - メッセージ
 * @param {string} type - タイプ (success, error, info)
 */
function showStatus(message, type) {
  if (!statusMessage) return;

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
 * 最新翻訳を読み込み
 */
function loadLatest() {
  chrome.storage.local.get(['latest'], (result) => {
    renderLatest(result.latest || null);
  });
}

/**
 * 最新翻訳カードを描画
 * @param {any} latest
 */
function renderLatest(latest) {
  if (!latestCard || !latestOriginal || !latestTranslated || !latestLang) {
    return;
  }

  if (!latest) {
    latestCard.classList.add('hidden');
    if (latestEmpty) latestEmpty.classList.remove('hidden');
    if (latestMeta) latestMeta.textContent = '';
    if (latestTime) {
      latestTime.textContent = '';
      latestTime.dateTime = '';
    }
    if (latestUrlLink) {
      latestUrlLink.href = '#';
      latestUrlLink.setAttribute('tabindex', '-1');
    }
    return;
  }

  latestOriginal.textContent = latest.originalText || '';
  latestTranslated.textContent = latest.translatedText || '';
  latestLang.textContent = `${latest.sourceLang || ''} → ${latest.targetLang || ''}`;

  if (latestTime) {
    const date = new Date(latest.timestamp || Date.now());
    latestTime.textContent = formatTimestamp(latest.timestamp || Date.now());
    latestTime.dateTime = date.toISOString();
  }

  if (latestMeta) {
    try {
      const url = new URL(latest.url || '');
      latestMeta.textContent = url.hostname;
    } catch {
      latestMeta.textContent = '';
    }
  }

  if (latestUrlLink) {
    if (latest.url) {
      latestUrlLink.href = latest.url;
      latestUrlLink.removeAttribute('tabindex');
    } else {
      latestUrlLink.href = '#';
      latestUrlLink.setAttribute('tabindex', '-1');
    }
  }

  latestCard.classList.remove('hidden');
  if (latestEmpty) latestEmpty.classList.add('hidden');
}

/**
 * モデル候補をUIに反映
 * @param {Array<{id?: string}>} models
 */
function populateModelOptions(models) {
  if (!modelOptionsList) return;
  modelOptionsList.textContent = '';

  const seen = new Set();
  for (const model of models || []) {
    const id = typeof model === 'string' ? model : model?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const option = document.createElement('option');
    option.value = id;
    modelOptionsList.appendChild(option);
  }
}

/**
 * storage変更リスナー
 * @param {chrome.storage.StorageChangeRecord} changes
 * @param {string} area
 */
function handleStorageChange(changes, area) {
  if (area !== 'local') return;

  if (Object.prototype.hasOwnProperty.call(changes, 'settings')) {
    loadSettings();
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'history')) {
    loadHistory();
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'latest')) {
    renderLatest(changes.latest.newValue || null);
  }
}

/**
 * 履歴を読み込み
 */
function loadHistory() {
  log(LogLevel.DEBUG, '翻訳履歴を読み込みます', null, 'PopupScript');

  chrome.storage.local.get(['history'], (result) => {
    const history = result.history || [];

    log(LogLevel.DEBUG, '翻訳履歴を読み込みました', {
      historyCount: history.length
    }, 'PopupScript');

    if (history.length === 0) {
      historyList.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = '翻訳履歴はありません';
      historyList.appendChild(empty);
      return;
    }

    // 履歴を表示（安全なDOM生成）
    historyList.textContent = '';
    for (const entry of history) {
      const item = document.createElement('div');
      item.className = 'history-item';

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

      item.appendChild(header);
      item.appendChild(original);
      item.appendChild(arrow);
      item.appendChild(translated);

      historyList.appendChild(item);
    }

    log(LogLevel.DEBUG, '翻訳履歴を表示しました', null, 'PopupScript');
  });
}

/**
 * 履歴を消去
 */
function clearHistory() {
  log(LogLevel.DEBUG, '履歴消去を試行します', null, 'PopupScript');

  if (!confirm('翻訳履歴を全て消去しますか？')) {
    log(LogLevel.DEBUG, '履歴消去がキャンセルされました', null, 'PopupScript');
    return;
  }

  log(LogLevel.INFO, '翻訳履歴を消去します', null, 'PopupScript');

  chrome.storage.local.set({ history: [] }, () => {
    loadHistory();
    log(LogLevel.INFO, '翻訳履歴を消去しました', null, 'PopupScript');
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
if (saveSettingsButton) saveSettingsButton.addEventListener('click', saveSettings);
if (testConnectionButton) testConnectionButton.addEventListener('click', testConnection);
if (clearHistoryButton) clearHistoryButton.addEventListener('click', clearHistory);
