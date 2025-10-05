# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome Extension (Manifest V3) that provides privacy-focused Japanese-English translation using the PLaMo Translate model running locally via LM Studio. All translation processing happens locally without sending data to external servers.

## Key Architecture

### Technology Stack
- **Frontend**: Chrome Extension (Manifest V3, Service Workers)
- **Translation Model**: PLaMo 2 Translate (9.53B parameters, GGUF format)
- **Runtime**: LM Studio local server (localhost / 127.0.0.1)
- **API**: OpenAI-compatible API via LM Studio

### Core Components
- **Service Worker** (`background.js`): Handles API calls to LM Studio, manages translation logic
- **Content Script** (`content.js`): Text selection, UI display on web pages
- **Popup UI** (`popup.html/js`): Settings interface, translation history
- **Manifest V3**: Uses event-driven Service Workers (non-persistent)

### Translation Pipeline
1. User selects text on webpage and right-clicks
2. Content script detects language (Japanese ↔ English)
3. Service worker constructs PLaMo-specific prompt
4. LM Studio API call to `POST /v1/chat/completions`
5. Result displayed via popup or inline element

## Development Commands

Since this is a Chrome extension project without a build system yet:

```bash
# Load extension in Chrome
# 1. Navigate to chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select this directory

# Test LM Studio connectivity
curl http://localhost:1234/v1/models

# Test translation API
curl http://localhost:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mmnga/plamo-2-translate-gguf",
    "messages": [{"role": "user", "content": "<|plamo:op|>dataset\ntranslation\n\n<|plamo:op|>input lang=English\nHello\n<|plamo:op|>output lang=Japanese"}],
    "max_tokens": 1000,
    "temperature": 0,
    "stop": ["<|plamo:op|>"]
  }'
```

## Critical Implementation Details

### PLaMo Translate Prompt Format
Must use exact format with special tokens:
```
<|plamo:op|>dataset
translation

<|plamo:op|>input lang=English
[input text]
<|plamo:op|>output lang=Japanese
```

### Manifest V3 Constraints
- Service Workers are **non-persistent** (no global variables)
- Use `chrome.storage` API for state persistence
- Must declare `host_permissions` for localhost/127.0.0.1 (any port)
- Prefer not to use `innerHTML` (XSS risk). Build DOM via `createElement`/`textContent`.

### Language Detection
```javascript
function detectLanguage(text) {
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  return japaneseRegex.test(text) ? 'Japanese' : 'English';
}
```

## Requirements Priority

### MVP (P0) - Must Have
- F-001: Context menu integration (right-click translation)
- F-002: Auto language detection (JP ↔ EN)
- F-003: LM Studio API integration
- F-004: Translation result display (popup/tooltip)
- F-005: Settings UI (server URL, model config)

### P1 - Should Have
- F-006: Translation history (max 50 entries)
- F-007: Keyboard shortcut (Ctrl+Shift+T)
- F-008: Dark mode support

### P2 - Nice to Have
- F-009: Multiple selection translation
- F-010: Custom prompt templates

## Performance Considerations

- **Translation Response Time**: Target <3s, max 10s
- **Memory Limit**: Chrome extension <50MB
- **Caching**: Implement translation cache (same text reuse)
- **Rate Limiting**: Max 3 concurrent requests to LM Studio

## Security Requirements

- XSS Protection: Never use `innerHTML`, always use `textContent`
- CSP: `script-src 'self'; object-src 'self'`
- Data Privacy: All translation data stays local (localhost only)
- No remote code execution in Manifest V3

## Model Quantization Levels

Recommended: **Q4_K_M** (5.79GB) for balance of quality and performance
- Q8_0 (10.1GB): Highest quality
- Q6_K (7.82GB): High quality
- Q5_K_M (6.8GB): Good balance
- Q4_K_M (5.79GB): **Recommended** - good quality, reasonable size
- Q3_K_M (4.64GB): Minimum configuration

## Important Constraints

- **Offline Requirement**: LM Studio server must be running
- **Language Pair**: MVP supports Japanese ↔ English only
- **Browser Support**: Chrome 88+, Edge 88+ (Chromium-based)
- **System Requirements**: 8GB RAM minimum, 16GB recommended

## Error Handling Standards

- Connection refused → "LM Studioが起動していません"
- Timeout (30s) → "リクエストがタイムアウトしました"
- HTTP 500 → "モデルエラーが発生しました"
- All error messages should be in Japanese

## Cursor Rules Summary

This project uses an adaptive process based on task complexity:
- 🟢 **Lightweight tasks**: Simple read/fix → immediate execution
- 🟡 **Standard tasks**: Feature/refactor → checklist → execution → verification
- 🔴 **Critical tasks**: Architecture/security → detailed analysis → approval → staged execution

**Mandatory approval required for**:
- Database schema changes
- Security configuration changes
- Production environment impact
- Breaking changes
- Technology stack version changes

## License Considerations

- Extension: MIT License
- PLaMo Translate Model: PLaMo Community License (Preferred Networks)
  - Free for companies with annual revenue <1 billion JPY
  - Requires contact for commercial use above threshold
