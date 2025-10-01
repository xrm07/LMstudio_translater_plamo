# TODO: Issue #4 – Auto-open popup with latest translation

## Goal
Implement an opt-out feature that opens the browser action popup automatically after a translation completes, showing the most recent translation data in a dedicated view while staying in sync with the existing history UI.

**Status**: ✅ Completed on 2025-10-01

## Key Requirements
- Invoke `chrome.action.openPopup()` once the background translation finishes so the popup becomes visible without an explicit toolbar click. Chrome 127+ exposes this method to all extensions (previously policy-only) and returns a resolved promise when the popup is shown.【Ref: Chrome Developers – chrome.action.openPopup, 2025-09-24】
- Preserve compatibility: if the browser does not support `chrome.action.openPopup` (Chromium <127 or alternative browsers), fall back gracefully to the current in-page overlay without errors.
- Provide a user-facing toggle in the popup settings to enable/disable auto-opening. Default should be enabled for first-run installs, and existing users should receive the default when the setting is absent.
- Ensure the popup highlights the newest translation (original text, translated text, metadata) and keeps history (`popup.js:195+`) synced.
- Avoid triggering the popup on error responses; existing error toasts in `content.js` remain unchanged.

## Background Observations
- The translation response pipeline is: context menu / keyboard shortcut → `background.js:32` / `background.js:39` → `handleTranslation` → message to `content.js` for overlay + `saveToHistory` (adds URL metadata).
- Settings are stored in `chrome.storage.local` under the `settings` key, with defaults defined at `background.js:6` and read back into the popup (`popup.js:59`).
- Popup UI currently has tabs for "設定" and "履歴"; there is no surface for "最新翻訳" or auto-open controls.
- `chrome.action` methods are already available (extension uses default popup). Need to import `chrome.action.openPopup()` from background service worker context.

## Implementation Plan

### 1. Storage schema and defaults
- Extend `DEFAULT_SETTINGS` with `autoOpenPopup: true` and migrate existing installs by adding a guard inside the onInstalled handler and/or first-run settings load.
- Update `popup.js::loadSettings` and `saveSettings` to read/write the new flag (checkbox UI). Persist the value together with existing settings object.
- Add optional `latestTranslation` entry in `chrome.storage.local` to persist the last successful translation payload `{ id, originalText, translatedText, sourceLang, targetLang, timestamp, url }`.

### 2. Background service worker (`background.js`)
- After `saveToHistory`, conditionally store the same payload to `latestTranslation`.
- If `settings.autoOpenPopup` is true and `chrome.action.openPopup` exists, call it using `await chrome.action.openPopup()`; wrap in try/catch to log failures without interrupting response flow. Handle promise rejections (e.g., icon hidden) and avoid repeated retries.
- When auto-open is disabled or unsupported, skip the call entirely. Continue sending overlay message as today.
- Ensure we early-return on error states (no popup open). Errors keep using `showError`.

### 3. Popup UI (`popup.html`, `popup.css`, `popup.js`)
- Add a new tab or prominent card labeled "最新翻訳" that renders the `latestTranslation` object: original text, translated text, language pair, timestamp, source URL (clickable). Highlight the entry that matches the top of history (reuse formatting).
- Insert a checkbox in Settings tab: `自動でポップアップを表示する` tied to the new flag. Default checked.
- On `DOMContentLoaded`, fetch `latestTranslation`. If unavailable, show an empty state message guiding the user to perform a translation.
- Subscribe to `chrome.storage.onChanged` for `latestTranslation` to update the UI when the popup is already open (including when auto-open triggers while popup is showing). Scroll or focus the new card as needed.
- When history is cleared (`clearHistory`), also clear `latestTranslation` (or update UI to "未翻訳" message) so stale data is not displayed.
- Optionally add CSS highlight (e.g., `.latest-highlight`) reused in history list for the first item.

### 4. Content script (`content.js`)
- No functional changes required for overlay. Verify `removeExistingPopup` logic to ensure popup re-opens cleanly when focus shifts to extension popup.
- If needed, consider minor UX touch (e.g., do not auto-dismiss overlay when popup is brought up) but defer unless testing reveals issues.

### 5. Compatibility & Fallback Handling
- Implement feature detection: `if (typeof chrome?.action?.openPopup === 'function')`.
- Detect support at runtime once per translation. For unsupported browsers, optionally log once (debounced) to console for developers.
- Consider retrieving `chrome.action.getUserSettings()` (Chrome 91+) to ensure icon is on toolbar. If `isOnToolbar` is false, auto-open may fail; provide tooltip message in popup settings to instruct users to pin the icon.

### 6. Testing Plan
- Manual tests on Chrome ≥127:
  - Translate via context menu and keyboard shortcut; verify popup opens post-translation and `最新翻訳` displays correct data.
  - Toggle auto-open OFF; confirm popup no longer opens automatically.
  - Re-enable and ensure behavior returns.
  - Trigger translation error (simulate LM Studio offline) to confirm popup does not open.
  - Clear history; confirm latest card resets.
- Compatibility test on Chromium <127 (or by temporarily stubbing `chrome.action.openPopup = undefined`) to ensure no runtime errors and overlay-only UX remains.
- Dark/Light theme visual check for new UI elements.

### 7. Documentation Updates
- Update README or `Project/` docs with note about Chrome 127+ requirement for auto-open and guidance on pinning extension icon if popup fails to appear.

## Risks & Mitigations
- **Popup fails to open because icon is hidden**: detect via `chrome.action.getUserSettings()` and surface contextual hint in settings.
- **Service worker terminated before `openPopup` resolves**: store `latestTranslation` before invoking and rely on popup `DOMContentLoaded` to render from storage so data is available even if SW sleeps.
- **Race with multiple translations**: guard by storing newest translation atomically; consider debouncing repeated `openPopup` calls (e.g., ignore if previous call still pending).
- **Future browser behavior changes**: guard behind feature detection and maintain overlay path as fallback.

## References
- Chrome Developers. "chrome.action" API reference — `openPopup()` available to all extensions starting Chrome 127 (published 2024-07-23, retrieved 2025-10-01). https://developer.chrome.com/docs/extensions/reference/api/action/【turn5view0】
- Chrome Extensions Message Passing overview — best practices for communicating between service worker, popup, and content script (retrieved 2025-10-01). https://developer.chrome.com/docs/extensions/develop/concepts/messaging【turn6search2】
- W3C WebExtensions CG Issue #160. "Ensure consistency of `action.openPopup` API across browsers" — notes lack of user-gesture requirement (2022-05-15). https://github.com/w3c/webextensions/issues/160【turn2search1】
