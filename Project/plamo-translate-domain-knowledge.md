# ドメイン知識：PLaMo Translate Chrome拡張機能

このドキュメントでは、プロジェクトに関連する技術的背景、設計思想、およびドメイン知識を詳細に解説します。

## 目次

1. [PLaMo Translateモデル](#1-plamo-translateモデル)
2. [LM Studio](#2-lm-studio)
3. [GGUF形式とモデル量子化](#3-gguf形式とモデル量子化)
4. [Chrome拡張機能 (Manifest V3)](#4-chrome拡張機能-manifest-v3)
5. [翻訳パイプライン](#5-翻訳パイプライン)
6. [アーキテクチャ設計](#6-アーキテクチャ設計)

---

## 1. PLaMo Translateモデル

### 1.1 概要

**PLaMo (Preferred Language Model)** は、Preferred Networks (PFN) とその子会社Preferred Elements (PFE) が開発した日本製の大規模言語モデルシリーズです。

**PLaMo Translate** は、2025年5月にリリースされた翻訳特化型モデルで、以下の特徴を持ちます：

- **特化型設計**: テキスト翻訳に最適化
- **高品質な日本語性能**: 日本語と英語を豊富に含むデータセットで学習
- **コンパクトサイズ**: オンプレミス・ローカル環境での動作を想定
- **多言語対応**: 日英を中心に、他言語ペアもサポート

### 1.2 モデルバージョンとパラメータ数

| モデル | パラメータ数 | 主な用途 |
|--------|--------------|----------|
| PLaMo 2 Translate | 9.53B (約95億) | 翻訳タスク全般 |
| PLaMo 2 Translate Base | 9.53B | 翻訳ベースモデル（Fine-tuning前） |
| PLaMo 2 Translate Eval | 9.53B | 翻訳評価用モデル |

### 1.3 アーキテクチャ

PLaMo 2シリーズは、**Samba-inspired Hybrid Architecture** を採用：

```
┌─────────────────────────────────────┐
│  PLaMo 2 Hybrid Architecture        │
├─────────────────────────────────────┤
│  - Mamba2 (State Space Model)       │
│  - Sliding Window Attention         │
│  - Normalization Layers (安定性向上)│
└─────────────────────────────────────┘
```

**特徴**:
- **Mamba2 SSM**: 長距離依存関係の効率的な処理
- **Sliding Window Attention**: 局所的なコンテキスト理解
- **正規化層**: 学習の安定性向上

この構造により、Transformerベースのモデルと比較して：
- 推論速度が向上
- メモリ効率が改善
- 長文の処理能力が強化

### 1.4 プロンプト形式

PLaMo Translateは特殊なプロンプト形式を使用します：

```
<|plamo:op|>dataset
translation

<|plamo:op|>input lang=English
Write the text to be translated here.
<|plamo:op|>output lang=Japanese
```

**重要なポイント**:
- `<|plamo:op|>` はプロンプトの区切り記号
- `lang=` で言語を指定 (English, Japanese, 等)
- `dataset translation` はタスクタイプの指定

### 1.5 ライセンス

**PLaMo Community License** の下でリリース：

- **年間売上10億円未満**: 商用・非商用ともに無料
- **年間売上10億円以上**: 商用利用には要連絡・ライセンス契約

詳細: [PLaMo Community License](https://www.preferred.jp/ja/plamo-community-license/)

---

## 2. LM Studio

### 2.1 概要

**LM Studio** は、ローカルで大規模言語モデルを実行するためのデスクトップアプリケーションです。

**主な特徴**:
- **GUI付き**: 技術的知識がなくても使いやすい
- **GGUF対応**: llama.cpp互換のモデル形式をサポート
- **OpenAI互換API**: 既存のOpenAI SDKとシームレスに統合
- **クロスプラットフォーム**: Windows / macOS / Linux対応

### 2.2 アーキテクチャ

```
┌────────────────────────────────────────┐
│         LM Studio Application          │
├────────────────────────────────────────┤
│  GUI Layer                             │
│  - モデル管理                           │
│  - チャットインターフェース              │
│  - サーバー制御                         │
├────────────────────────────────────────┤
│  llama.cpp Engine                      │
│  - GGUF読み込み                         │
│  - CPU/GPU推論                          │
│  - 量子化サポート                       │
├────────────────────────────────────────┤
│  Local Server (OpenAI Compatible API) │
│  - HTTP Server on localhost:1234       │
│  - /v1/models                          │
│  - /v1/chat/completions                │
│  - /v1/completions                     │
└────────────────────────────────────────┘
```

### 2.3 APIエンドポイント

LM Studioは以下のエンドポイントを提供：

#### GET /v1/models

利用可能なモデル一覧を取得

```bash
curl http://localhost:1234/v1/models
```

レスポンス例：
```json
{
  "data": [
    {
      "id": "mmnga/plamo-2-translate-gguf",
      "object": "model",
      "owned_by": "organization-owner"
    }
  ],
  "object": "list"
}
```

#### POST /v1/chat/completions

チャット形式での補完リクエスト（翻訳に使用）

```bash
curl http://localhost:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mmnga/plamo-2-translate-gguf",
    "messages": [
      {
        "role": "user",
        "content": "<|plamo:op|>dataset\ntranslation\n\n<|plamo:op|>input lang=English\nHello, world!\n<|plamo:op|>output lang=Japanese"
      }
    ],
    "max_tokens": 1000,
    "temperature": 0
  }'
```

#### POST /v1/completions

テキスト補完リクエスト（レガシー）

```bash
curl http://localhost:1234/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mmnga/plamo-2-translate-gguf",
    "prompt": "Your prompt here",
    "max_tokens": 1000
  }'
```

### 2.4 認証

**重要**: LM Studioのローカルサーバーは**認証不要**です：
- API KeyやTokenは不要
- localhostからのアクセスのみ許可

---

## 3. GGUF形式とモデル量子化

### 3.1 GGUF (GPT-Generated Unified Format)

**GGUF** は、llama.cpp用に設計された効率的なモデルフォーマットです。

**特徴**:
- **単一ファイル**: モデルの全データを1ファイルに格納
- **メタデータ**: モデル情報をファイル内に埋め込み
- **高速読み込み**: mmap対応による高速ロード
- **量子化サポート**: 多様な量子化レベルに対応

### 3.2 量子化とは

**量子化 (Quantization)** は、モデルの重みを低精度の数値表現に変換し、メモリ使用量を削減する技術です。

```
元のモデル (BF16/FP16):
  - 各重み: 16ビット
  - 高精度・高メモリ使用

量子化モデル (Q4_K_M):
  - 各重み: 平均4ビット
  - 若干の精度低下・メモリ1/4
```

### 3.3 PLaMo Translate対応の量子化レベル

| 量子化 | サイズ | 精度 | 推奨用途 |
|--------|--------|------|----------|
| **BF16** | 19.1 GB | 最高 | 研究・高精度が必要な場合 |
| **Q8_0** | 10.1 GB | 極めて高い | 高品質翻訳 |
| **Q6_K** | 7.82 GB | 高い | バランス型（高品質） |
| **Q5_K_M** | 6.8 GB | やや高い | バランス型 |
| **Q4_K_M** | 5.79 GB | 良好 | **推奨** (品質とサイズのバランス) |
| **Q4_K_S** | 5.51 GB | 良好 | 省メモリ |
| **Q3_K_M** | 4.64 GB | 許容範囲 | 最小構成 |

**推奨**: **Q4_K_M** または **Q5_K_M** が品質とパフォーマンスのバランスが最適

### 3.4 量子化の影響

```
┌──────────────────────────────────────┐
│  量子化レベル vs 翻訳品質             │
├──────────────────────────────────────┤
│  BF16    ████████████████████ 100%   │
│  Q8_0    ███████████████████▓ 98%    │
│  Q6_K    ██████████████████▓░ 95%    │
│  Q5_K_M  █████████████████▓░░ 92%    │
│  Q4_K_M  ████████████████▓░░░ 88%    │ ← 推奨
│  Q4_K_S  ███████████████▓░░░░ 85%    │
│  Q3_K_M  ██████████████▓░░░░░ 78%    │
└──────────────────────────────────────┘
```

---

## 4. Chrome拡張機能 (Manifest V3)

### 4.1 Manifest V3の概要

**Manifest V3** は、Chromeの最新拡張機能プラットフォームです (2021年導入、2024年にV2が非推奨化)。

**主な変更点**:

| 項目 | Manifest V2 | Manifest V3 |
|------|-------------|-------------|
| バックグラウンド | Background Pages (永続) | Service Workers (イベント駆動) |
| コード実行 | リモートコード可 | パッケージ内のみ |
| webRequest | Blocking可 | declarativeNetRequest推奨 |
| host_permissions | permissions内 | 独立したキー |

### 4.2 Service Workersの特性

**重要な制約**:
- **非永続**: 必要時のみ起動、アイドル時は停止
- **DOM非対応**: `window`, `document` へのアクセス不可
- **グローバル変数不可**: メモリ上の状態は保持されない

**対応策**:
```javascript
// NG: グローバル変数での状態保持
let translationCache = {};  // Service Worker再起動で消失

// OK: chrome.storage APIでの永続化
chrome.storage.local.set({ translationCache: data });
chrome.storage.local.get(['translationCache'], (result) => {
  // データを取得
});
```

### 4.3 manifest.jsonの基本構造

```json
{
  "manifest_version": 3,
  "name": "PLaMo Translate Extension",
  "version": "1.0.0",
  "description": "ローカルPLaMo Translateを使用した翻訳拡張",
  
  "permissions": [
    "contextMenus",
    "storage"
  ],
  
  "host_permissions": [
    "http://localhost:1234/*"
  ],
  
  "background": {
    "service_worker": "background.js"
  },
  
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"]
    }
  ],
  
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  }
}
```

### 4.4 権限の説明

| 権限 | 用途 |
|------|------|
| `contextMenus` | 右クリックメニューに翻訳オプションを追加 |
| `storage` | 翻訳履歴や設定を保存 |
| `activeTab` | 現在のタブ情報へのアクセス |
| `host_permissions` | localhost:1234へのAPI呼び出し許可 |

### 4.5 localhostへのアクセス

**Manifest V3の重要な注意点**:

```json
{
  "host_permissions": [
    "http://localhost:1234/*"
  ]
}
```

このように明示的に指定しないと、localhostへのfetchリクエストが**CORS エラー**で失敗します。

---

## 5. 翻訳パイプライン

### 5.1 翻訳フロー全体像

```
┌────────────────────────────────────────────────────────────┐
│                   翻訳パイプライン                          │
└────────────────────────────────────────────────────────────┘

1. ユーザー操作
   ↓
   [テキスト選択] → [右クリック] → [「翻訳」選択]
   ↓
2. Content Script
   ↓
   選択テキストを取得 → 言語検出 → Service Workerに送信
   ↓
3. Background Service Worker
   ↓
   プロンプト構築 → LM Studio APIコール → レスポンス取得
   ↓
4. LM Studio (localhost:1234)
   ↓
   PLaMo Translateモデルで推論 → 翻訳結果を返却
   ↓
5. Content Script / Popup
   ↓
   結果を表示 (ポップアップ/インライン表示)
```

### 5.2 言語検出

簡易的な言語検出ロジック例：

```javascript
function detectLanguage(text) {
  // 日本語文字（ひらがな、カタカナ、漢字）の検出
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  
  if (japaneseRegex.test(text)) {
    return 'Japanese';
  } else {
    return 'English';
  }
}
```

より高度な実装では、`Intl.Segmenter` や外部ライブラリを使用可能。

### 5.3 プロンプト構築

```javascript
function buildTranslationPrompt(text, sourceLang, targetLang) {
  return `<|plamo:op|>dataset
translation

<|plamo:op|>input lang=${sourceLang}
${text}
<|plamo:op|>output lang=${targetLang}`;
}

// 使用例
const prompt = buildTranslationPrompt(
  "Hello, world!",
  "English",
  "Japanese"
);
// => "<|plamo:op|>dataset\ntranslation\n\n<|plamo:op|>input lang=English\nHello, world!\n<|plamo:op|>output lang=Japanese"
```

### 5.4 API呼び出し

```javascript
async function translateWithPLaMo(text, sourceLang, targetLang) {
  const prompt = buildTranslationPrompt(text, sourceLang, targetLang);
  
  const response = await fetch('http://localhost:1234/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'mmnga/plamo-2-translate-gguf',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0,  // 決定的な翻訳のため温度0
      stop: ['<|plamo:op|>']  // 終了トークン
    })
  });
  
  const data = await response.json();
  return data.choices[0].message.content.trim();
}
```

### 5.5 エラーハンドリング

```javascript
async function translateWithErrorHandling(text, sourceLang, targetLang) {
  try {
    const result = await translateWithPLaMo(text, sourceLang, targetLang);
    return { success: true, translation: result };
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      return {
        success: false,
        error: 'LM Studioに接続できません。サーバーが起動しているか確認してください。'
      };
    } else {
      return {
        success: false,
        error: `翻訳エラー: ${error.message}`
      };
    }
  }
}
```

---

## 6. アーキテクチャ設計

### 6.1 システム全体図

```
┌───────────────────────────────────────────────────────────┐
│                   Chrome Browser                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │         Chrome Extension                            │ │
│  │  ┌──────────────┐  ┌──────────────┐                │ │
│  │  │ Content      │  │ Background   │                │ │
│  │  │ Script       │◄─┤ Service      │                │ │
│  │  │              │  │ Worker       │                │ │
│  │  │ - Text選択   │  │ - API呼び出し │                │ │
│  │  │ - UI表示     │  │ - ロジック   │                │ │
│  │  └──────────────┘  └──────┬───────┘                │ │
│  │                           │                         │ │
│  │  ┌──────────────┐         │                         │ │
│  │  │ Popup UI     │         │                         │ │
│  │  │              │         │                         │ │
│  │  │ - 設定画面   │         │                         │ │
│  │  │ - 履歴表示   │         │                         │ │
│  │  └──────────────┘         │                         │ │
│  └──────────────────────────┼─────────────────────────┘ │
└────────────────────────────┼───────────────────────────┘
                              │ HTTP (localhost:1234)
                              ↓
┌─────────────────────────────────────────────────────────┐
│               LM Studio Application                     │
│  ┌───────────────────────────────────────────────────┐ │
│  │  Local HTTP Server (OpenAI Compatible)           │ │
│  │  - /v1/models                                     │ │
│  │  - /v1/chat/completions                          │ │
│  └─────────────────────┬─────────────────────────────┘ │
│                        │                               │
│  ┌─────────────────────▼─────────────────────────────┐ │
│  │  llama.cpp Inference Engine                      │ │
│  │  - GGUF読み込み                                   │ │
│  │  - CPU/GPU推論                                    │ │
│  └─────────────────────┬─────────────────────────────┘ │
│                        │                               │
│  ┌─────────────────────▼─────────────────────────────┐ │
│  │  PLaMo 2 Translate Model (GGUF)                  │ │
│  │  - 9.53B parameters                              │ │
│  │  - Q4_K_M (~5.8GB)                               │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 6.2 コンポーネント間通信

**Chrome拡張内部**:

```javascript
// Content Script → Background Service Worker
chrome.runtime.sendMessage({
  action: 'translate',
  text: selectedText,
  sourceLang: 'English',
  targetLang: 'Japanese'
}, (response) => {
  if (response.success) {
    displayTranslation(response.translation);
  }
});

// Background Service Worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    translateWithPLaMo(request.text, request.sourceLang, request.targetLang)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;  // 非同期レスポンスを示すため
  }
});
```

### 6.3 パフォーマンス最適化

**キャッシング戦略**:

```javascript
// 翻訳結果のキャッシュ（同じテキストの再翻訳を避ける）
const translationCache = new Map();

async function translateWithCache(text, sourceLang, targetLang) {
  const cacheKey = `${sourceLang}-${targetLang}-${text}`;
  
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }
  
  const result = await translateWithPLaMo(text, sourceLang, targetLang);
  translationCache.set(cacheKey, result);
  
  // キャッシュサイズ制限（100エントリ）
  if (translationCache.size > 100) {
    const firstKey = translationCache.keys().next().value;
    translationCache.delete(firstKey);
  }
  
  return result;
}
```

**並列処理の制限**:

```javascript
// 同時リクエスト数の制限（LM Studioへの負荷軽減）
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 3;

async function translateWithRateLimit(text, sourceLang, targetLang) {
  while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  activeRequests++;
  try {
    return await translateWithPLaMo(text, sourceLang, targetLang);
  } finally {
    activeRequests--;
  }
}
```

### 6.4 セキュリティ考慮事項

**XSS対策**:

```javascript
// NG: innerHTML使用（XSSリスク）
element.innerHTML = translatedText;

// OK: textContentまたはcreateTextNode使用
element.textContent = translatedText;

// または
const textNode = document.createTextNode(translatedText);
element.appendChild(textNode);
```

**CSP (Content Security Policy)**:

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

---

## 参考文献

1. [PLaMo Translate公式発表](https://www.preferred.jp/en/news/pr20250527/)
2. [PLaMo 2 Technical Report (arXiv)](https://arxiv.org/html/2509.04897v1)
3. [LM Studio公式ドキュメント](https://lmstudio.ai/docs)
4. [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
5. [GGUF Format Specification](https://github.com/ggml-org/llama.cpp/blob/master/docs/GGUF.md)
6. [llama.cpp GitHub](https://github.com/ggml-org/llama.cpp)

---

**更新日**: 2025-10-01  
**執筆者**: Sora
