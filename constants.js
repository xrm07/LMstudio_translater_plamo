/**
 * PLaMo Translate - 定数定義
 */

// デフォルト設定
export const DEFAULT_SETTINGS = {
  lmStudioUrl: 'http://localhost:1234',
  modelName: 'mmnga/plamo-2-translate-gguf',
  maxTokens: 1000,
  temperature: 0
};

// API設定
export const API_CONFIG = {
  TIMEOUT: 30000, // 30秒
  RETRY_COUNT: 3,
  RETRY_DELAY: 1000 // 1秒
};

// 翻訳設定
export const TRANSLATION_CONFIG = {
  MAX_HISTORY_COUNT: 50,
  POPUP_WIDTH: 400,
  POPUP_HEIGHT: 300,
  ANIMATION_DURATION: 200
};

// エラーメッセージ
export const ERROR_MESSAGES = {
  CONNECTION_FAILED: 'LM Studioに接続できません。サーバーが起動しているか確認してください。',
  TIMEOUT: 'リクエストがタイムアウトしました。',
  MODEL_ERROR: 'モデルエラーが発生しました。LM Studioの設定を確認してください。',
  UNEXPECTED_ERROR: '翻訳中に予期しないエラーが発生しました'
};

// CSSクラス名
export const CSS_CLASSES = {
  POPUP: 'plamo-translate-popup',
  POPUP_SHOW: 'plamo-translate-show',
  POPUP_ERROR: 'plamo-translate-error',
  POPUP_HEADER: 'plamo-translate-header',
  POPUP_BODY: 'plamo-translate-body',
  POPUP_TITLE: 'plamo-translate-title',
  POPUP_CLOSE: 'plamo-translate-close',
  POPUP_TEXT: 'plamo-translate-text',
  POPUP_ORIGINAL: 'plamo-original',
  POPUP_TRANSLATED: 'plamo-translated',
  POPUP_DIVIDER: 'plamo-translate-divider',
  POPUP_FOOTER: 'plamo-translate-footer',
  POPUP_TIME: 'plamo-translate-time',
  POPUP_COPY: 'plamo-translate-copy',
  POPUP_ERROR_MESSAGE: 'plamo-translate-error-message',
  POPUP_ERROR_HINT: 'plamo-translate-error-hint'
};

// グローバルにエクスポート
window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
window.API_CONFIG = API_CONFIG;
window.TRANSLATION_CONFIG = TRANSLATION_CONFIG;
window.ERROR_MESSAGES = ERROR_MESSAGES;
window.CSS_CLASSES = CSS_CLASSES;