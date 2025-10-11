/**
 * PLaMo Translate - Content Script
 * Webページ上での翻訳結果表示を管理
 */

const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

function log(level, message, data = null, scriptName = '') {
  const timestamp = new Date().toISOString();
  const levelNames = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR'
  };
  const levelName = levelNames[level] || 'UNKNOWN';
  const prefix = scriptName ? `${scriptName}: ` : '';
  const logMessage = `[${timestamp}] [${levelName}] ${prefix}${message}`;
  console.log(logMessage, ...(data ? [data] : []));
}

// メッセージリスナー（background scriptからの通知）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  log(LogLevel.DEBUG, 'メッセージを受信しました', {
    action: request.action,
    senderTabId: sender.tab?.id
  }, 'ContentScript');

  if (request.action === 'showTranslation') {
    log(LogLevel.INFO, '翻訳結果を表示します', {
      sourceLang: request.sourceLang,
      targetLang: request.targetLang,
      processingTime: request.processingTime
    }, 'ContentScript');

    showTranslationPopup(request);
    sendResponse({ success: true });
  } else if (request.action === 'showError') {
    log(LogLevel.WARN, 'エラーを表示します', {
      error: request.error
    }, 'ContentScript');

    showErrorPopup(request.error);
    sendResponse({ success: true });
  } else {
    log(LogLevel.WARN, '未知のアクションを受信しました', {
      action: request.action
    }, 'ContentScript');
    try {
      sendResponse({ success: false, error: 'unknown_action', action: request.action });
    } catch {}
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
  }, 'ContentScript');

  // 既存のポップアップを削除
  removeExistingPopup();

  // ポップアップ要素を作成
  const popup = document.createElement('div');
  popup.id = 'plamo-translate-popup';
  popup.className = 'plamo-translate-popup';

  // ヘッダー
  const header = document.createElement('div');
  header.className = 'plamo-translate-header';

  const title = document.createElement('span');
  title.className = 'plamo-translate-title';
  title.textContent = 'PLaMo Translate';

  const closeButton = document.createElement('button');
  closeButton.className = 'plamo-translate-close';
  closeButton.title = '閉じる';
  closeButton.textContent = '×';

  header.appendChild(title);
  header.appendChild(closeButton);

  // ボディ
  const body = document.createElement('div');
  body.className = 'plamo-translate-body';

  const sectionOriginal = document.createElement('div');
  sectionOriginal.className = 'plamo-translate-section';
  const labelOriginal = document.createElement('div');
  labelOriginal.className = 'plamo-translate-label';
  labelOriginal.textContent = `元のテキスト (${data.sourceLang}):`;
  const textOriginal = document.createElement('div');
  textOriginal.className = 'plamo-translate-text plamo-original';
  textOriginal.textContent = data.originalText;
  sectionOriginal.appendChild(labelOriginal);
  sectionOriginal.appendChild(textOriginal);

  const divider = document.createElement('div');
  divider.className = 'plamo-translate-divider';
  divider.textContent = '↓';

  const sectionTranslated = document.createElement('div');
  sectionTranslated.className = 'plamo-translate-section';
  const labelTranslated = document.createElement('div');
  labelTranslated.className = 'plamo-translate-label';
  labelTranslated.textContent = `翻訳結果 (${data.targetLang}):`;
  const textTranslated = document.createElement('div');
  textTranslated.className = 'plamo-translate-text plamo-translated';
  textTranslated.textContent = data.translatedText;
  sectionTranslated.appendChild(labelTranslated);
  sectionTranslated.appendChild(textTranslated);

  const footer = document.createElement('div');
  footer.className = 'plamo-translate-footer';
  const time = document.createElement('span');
  time.className = 'plamo-translate-time';
  time.textContent = `処理時間: ${(data.processingTime / 1000).toFixed(2)}秒`;
  const copyButton = document.createElement('button');
  copyButton.className = 'plamo-translate-copy';
  copyButton.title = '翻訳結果をコピー';
  copyButton.textContent = '📋 コピー';
  footer.appendChild(time);
  footer.appendChild(copyButton);

  body.appendChild(sectionOriginal);
  body.appendChild(divider);
  body.appendChild(sectionTranslated);
  body.appendChild(footer);

  popup.appendChild(header);
  popup.appendChild(body);

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

  // ヘッダー
  const header = document.createElement('div');
  header.className = 'plamo-translate-header';
  const title = document.createElement('span');
  title.className = 'plamo-translate-title';
  title.textContent = '⚠️ エラー';
  const closeButton = document.createElement('button');
  closeButton.className = 'plamo-translate-close';
  closeButton.title = '閉じる';
  closeButton.textContent = '×';
  header.appendChild(title);
  header.appendChild(closeButton);

  // ボディ
  const body = document.createElement('div');
  body.className = 'plamo-translate-body';
  const errorDiv = document.createElement('div');
  errorDiv.className = 'plamo-translate-error-message';
  errorDiv.textContent = errorMessage;
  const hint = document.createElement('div');
  hint.className = 'plamo-translate-error-hint';
  const strong = document.createElement('strong');
  strong.textContent = 'ヒント:';
  const list = document.createElement('ul');
  const li1 = document.createElement('li');
  li1.textContent = 'LM Studioが起動しているか確認してください';
  const li2 = document.createElement('li');
  li2.textContent = 'モデルがロードされているか確認してください';
  const li3 = document.createElement('li');
  li3.textContent = '拡張機能の設定を確認してください';
  list.appendChild(li1);
  list.appendChild(li2);
  list.appendChild(li3);
  hint.appendChild(strong);
  hint.appendChild(list);
  body.appendChild(errorDiv);
  body.appendChild(hint);

  popup.appendChild(header);
  popup.appendChild(body);

  document.body.appendChild(popup);
  positionPopup(popup);

  // イベントリスナーを追加
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
    }, 'ContentScript');

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
      }, 'ContentScript');
      fallbackCopyToClipboard(text);
    });
  } else {
    log(LogLevel.DEBUG, 'フォールバックコピー方法を使用します', null, 'ContentScript');
    fallbackCopyToClipboard(text);
  }
}

/**
 * フォールバック版のクリップボードコピー
 * @param {string} text - コピーするテキスト
 */
function fallbackCopyToClipboard(text) {
  log(LogLevel.DEBUG, 'フォールバッククリップボードコピー実行', null, 'ContentScript');

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
    }, 'ContentScript');
  } catch (err) {
    log(LogLevel.ERROR, 'フォールバッククリップボードコピー失敗', {
      error: err.message
    }, 'ContentScript');
  }

  document.body.removeChild(textarea);
}

/**
 * HTMLエスケープ（XSS対策）
 * @param {string} text - エスケープ対象テキスト
 * @returns {string} - エスケープ済みテキスト
 */
function escapeHtml(text) {
  // 安全なHTMLエスケープ: textContentを設定してinnerHTMLを取得
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
