# TODO

- [x] README.md: Chrome 127以降の自動ポップアップ説明を簡潔な文章に更新する。
- [x] background.js: saveToHistory()の結果を検証し、latestTranslation保存時にnullを避けるエラーハンドリングを追加する。
- [x] background.js: maybeAutoOpenPopup()呼び出しを非同期で実行しつつ、エラーを握り潰さないようcatchを添える。
- [x] background.js: autoOpenPopupNotice関連のchrome.storage.local.set呼び出しを個別のtry/catchで保護する。
- [x] manifest.json: suggested_keyのショートカットをブラウザ標準と競合しない組み合わせに変更する。
- [x] popup.js: DOMContentLoadedでのloadLatestTranslation()直接呼び出しを削除し、switchTab('latest')の初期化に委ねる。
- [ ] 自動ポップアップ挙動と通知メッセージの保存失敗時ログをChrome 127環境で実機確認する。
