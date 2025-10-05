// utils.js - Shared helpers for PLaMo Translate

export function detectLanguage(text) {
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  return japaneseRegex.test(text) ? 'Japanese' : 'English';
}

export function buildTranslationPrompt(text, sourceLang, targetLang) {
  return `<|plamo:op|>dataset
translation

<|plamo:op|>input lang=${sourceLang}
${text}
<|plamo:op|>output lang=${targetLang}`;
}

export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
