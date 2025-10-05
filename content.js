/**
 * PLaMo Translate - Content Script
 * Webページ上での翻訳結果表示を管理
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
  const logMessage = `[${timestamp}] [${levelName}] ContentScript: ${message}`;

  if (data) {
    console.log(logMessage, data);
  } else {
    console.log(logMessage);
  }
}

// メッセージリスナー（background scriptからの通知）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log(LogLevel.DEBUG, 'メッセージを受信しました', {
    action: request.action,
    senderTabId: sender.tab?.id
  });

  if (request.action === 'showTranslation') {
    log(LogLevel.INFO, '翻訳結果を表示します', {
      sourceLang: request.sourceLang,
      targetLang: request.targetLang,
      processingTime: request.processingTime
    });

    showTranslationPopup(request);
    sendResponse({ success: true });
  } else if (request.action === 'showError') {
    log(LogLevel.WARN, 'エラーを表示します', {
      error: request.error
    });

    showErrorPopup(request.error);
    sendResponse({ success: true });
  } else {
    log(LogLevel.WARN, '未知のアクションを受信しました', {
      action: request.action
    });
  }
});

/**
 * 翻訳結果のポップアップを表示
 * @param {Object} data - 翻訳データ
 */
function showTranslationPopup(data) {
  log(LogLevel.DEBUG, '翻訳ポップアップを作成します', {
    sourceLang: data.sourceLang,
    targetLang: data.targetLang,
    textLength: data.originalText?.length
  });

  // 既存のポップアップを削除
  removeExistingPopup();

  // ポップアップ要素を作成
  const popup = document.createElement('div');
  popup.id = 'plamo-translate-popup';
  popup.className = 'plamo-translate-popup';

  // 内容を構築
  popup.innerHTML = `
    <div class="plamo-translate-header">
      <span class="plamo-translate-title">PLaMo Translate</span>
      <button class="plamo-translate-close" title="閉じる">×</button>
    </div>
    <div class="plamo-translate-body">
      <div class="plamo-translate-section">
        <div class="plamo-translate-label">元のテキスト (${data.sourceLang}):</div>
        <div class="plamo-translate-text plamo-original">${escapeHtml(data.originalText)}</div>
      </div>
      <div class="plamo-translate-divider">↓</div>
      <div class="plamo-translate-section">
        <div class="plamo-translate-label">翻訳結果 (${data.targetLang}):</div>
        <div class="plamo-translate-text plamo-translated">${escapeHtml(data.translatedText)}</div>
      </div>
      <div class="plamo-translate-footer">
        <span class="plamo-translate-time">処理時間: ${(data.processingTime / 1000).toFixed(2)}秒</span>
        <button class="plamo-translate-copy" title="翻訳結果をコピー">📋 コピー</button>
      </div>
    </div>
  `;

  // ページに追加
  document.body.appendChild(popup);

  // 位置を調整（マウスカーソル付近）
  positionPopup(popup);

  // イベントリスナーを追加
  attachPopupEventListeners(popup, data.translatedText);

  // アニメーション
  setTimeout(() => {
    popup.classList.add('plamo-translate-show');
  }, 10);
}

/**
 * エラーポップアップを表示
 * @param {string} errorMessage - エラーメッセージ
 */
function showErrorPopup(errorMessage) {
  // 既存のポップアップを削除
  removeExistingPopup();

  // エラーポップアップを作成
  const popup = document.createElement('div');
  popup.id = 'plamo-translate-popup';
  popup.className = 'plamo-translate-popup plamo-translate-error';

  popup.innerHTML = `
    <div class="plamo-translate-header">
      <span class="plamo-translate-title">⚠️ エラー</span>
      <button class="plamo-translate-close" title="閉じる">×</button>
    </div>
    <div class="plamo-translate-body">
      <div class="plamo-translate-error-message">${escapeHtml(errorMessage)}</div>
      <div class="plamo-translate-error-hint">
        <strong>ヒント:</strong><br>
        • LM Studioが起動しているか確認してください<br>
        • モデルがロードされているか確認してください<br>
        • 拡張機能の設定を確認してください
      </div>
    </div>
  `;

  document.body.appendChild(popup);
  positionPopup(popup);

  // イベントリスナーを追加
  const closeButton = popup.querySelector('.plamo-translate-close');
  closeButton.addEventListener('click', () => removeExistingPopup());

  // 外側クリックで閉じる
  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick);
  }, 100);

  // アニメーション
  setTimeout(() => {
    popup.classList.add('plamo-translate-show');
  }, 10);
}

/**
 * ポップアップの位置を調整
 * @param {HTMLElement} popup - ポップアップ要素
 */
function positionPopup(popup) {
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // ビューポート内に収める
    let top = rect.bottom + window.scrollY + 10;
    let left = rect.left + window.scrollX;

    // 画面右端を超える場合は左に調整
    const popupWidth = 400; // CSSで指定した幅
    if (left + popupWidth > window.innerWidth) {
      left = window.innerWidth - popupWidth - 20;
    }

    // 画面下端を超える場合は上に表示
    const popupHeight = popup.offsetHeight || 300;
    if (top + popupHeight > window.innerHeight + window.scrollY) {
      top = rect.top + window.scrollY - popupHeight - 10;
    }

    popup.style.top = `${Math.max(top, window.scrollY + 10)}px`;
    popup.style.left = `${Math.max(left, 10)}px`;
  } else {
    // フォールバック：画面中央
    popup.style.top = `${window.scrollY + 100}px`;
    popup.style.left = '50%';
    popup.style.transform = 'translateX(-50%)';
  }
}

/**
 * ポップアップのイベントリスナーを追加
 * @param {HTMLElement} popup - ポップアップ要素
 * @param {string} translatedText - 翻訳結果テキスト
 */
function attachPopupEventListeners(popup, translatedText) {
  // 閉じるボタン
  const closeButton = popup.querySelector('.plamo-translate-close');
  closeButton.addEventListener('click', () => removeExistingPopup());

  // コピーボタン
  const copyButton = popup.querySelector('.plamo-translate-copy');
  copyButton.addEventListener('click', () => {
    log(LogLevel.DEBUG, '翻訳結果をコピーします', {
      textLength: translatedText.length
    });

    copyToClipboard(translatedText);
    copyButton.textContent = '✓ コピーしました';
    setTimeout(() => {
      copyButton.textContent = '📋 コピー';
    }, 2000);
  });

  // 外側クリックで閉じる
  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick);
  }, 100);

  // ESCキーで閉じる
  document.addEventListener('keydown', handleEscapeKey);
}

/**
 * 外側クリックのハンドラー
 * @param {Event} event - クリックイベント
 */
function handleOutsideClick(event) {
  const popup = document.getElementById('plamo-translate-popup');
  if (popup && !popup.contains(event.target)) {
    removeExistingPopup();
  }
}

/**
 * ESCキーのハンドラー
 * @param {Event} event - キーボードイベント
 */
function handleEscapeKey(event) {
  if (event.key === 'Escape') {
    removeExistingPopup();
  }
}

/**
 * 既存のポップアップを削除
 */
function removeExistingPopup() {
  const existingPopup = document.getElementById('plamo-translate-popup');
  if (existingPopup) {
    existingPopup.classList.remove('plamo-translate-show');
    setTimeout(() => {
      existingPopup.remove();
    }, 200); // アニメーション時間
  }

  // イベントリスナーをクリーンアップ
  document.removeEventListener('click', handleOutsideClick);
  document.removeEventListener('keydown', handleEscapeKey);
}

/**
 * クリップボードにコピー
 * @param {string} text - コピーするテキスト
 */
function copyToClipboard(text) {
  log(LogLevel.DEBUG, 'クリップボードにコピーします', {
    textLength: text.length
  });

  // navigator.clipboard APIを使用
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(err => {
      log(LogLevel.ERROR, 'クリップボードコピー失敗（navigator.clipboard）', {
        error: err.message
      });
      fallbackCopyToClipboard(text);
    });
  } else {
    log(LogLevel.DEBUG, 'フォールバックコピー方法を使用します');
    fallbackCopyToClipboard(text);
  }
}

/**
 * フォールバック版のクリップボードコピー
 * @param {string} text - コピーするテキスト
 */
function fallbackCopyToClipboard(text) {
  log(LogLevel.DEBUG, 'フォールバッククリップボードコピー実行');

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const success = document.execCommand('copy');
    log(LogLevel.INFO, 'フォールバッククリップボードコピー成功', {
      success: success
    });
  } catch (err) {
    log(LogLevel.ERROR, 'フォールバッククリップボードコピー失敗', {
      error: err.message
    });
  }

  document.body.removeChild(textarea);
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
