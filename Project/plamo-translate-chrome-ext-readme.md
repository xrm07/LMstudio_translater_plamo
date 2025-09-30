# PLaMo Translate Chrome Extension

ローカルで動作するPLaMo Translateモデルを使用した、プライバシー重視のChrome翻訳拡張機能。

## 概要

この拡張機能は、LM Studio経由でローカルに動作するPLaMo Translateモデルを使用して、Webページ上のテキストを日英間で翻訳します。全ての処理がローカルで完結するため、翻訳データが外部サーバーに送信されることはありません。

### 主な特徴

- **完全ローカル処理**: インターネット接続不要で翻訳可能
- **プライバシー保護**: 翻訳データは一切外部送信されない
- **高品質な日英翻訳**: Preferred Networks製PLaMo Translateモデルを使用
- **軽量**: ブラウザへの負荷が少ない
- **シンプルなUI**: 右クリックメニューから即座に翻訳

## システム要件

### 必須要件

- **OS**: Windows / macOS / Linux (Pop!_OS含む)
- **RAM**: 最低8GB (16GB推奨)
- **ストレージ**: 約10GB (モデルファイル用)
- **ブラウザ**: Google Chrome 88以降 (Manifest V3対応)

### 推奨スペック

- **RAM**: 16GB以上
- **GPU**: CUDA対応GPU (オプション、推論高速化用)
- **CPU**: 4コア以上

## インストール

### 1. LM Studioのセットアップ

#### 1.1 LM Studioのインストール

```bash
# Linux (Pop!_OS)の場合
wget https://lmstudio.ai/download/linux -O lmstudio.AppImage
chmod +x lmstudio.AppImage
./lmstudio.AppImage
```

他のOSの場合は [LM Studio公式サイト](https://lmstudio.ai/) からダウンロードしてください。

#### 1.2 PLaMo Translateモデルのダウンロード

LM Studioを起動後、以下の手順でモデルをダウンロード：

1. 検索バーで `plamo-2-translate` を検索
2. 以下のいずれかのGGUF版を選択：
   - `mmnga/plamo-2-translate-gguf` (推奨)
   - `grapevine-AI/plamo-2-translate-gguf`
3. 量子化レベルを選択：
   - **Q4_K_M** (5.79GB) - バランス型・推奨
   - **Q5_K_M** (6.8GB) - 高品質
   - **Q6_K** (7.82GB) - 最高品質
4. ダウンロード完了まで待機

#### 1.3 ローカルサーバーの起動

1. LM Studioで「Local Server」タブを開く
2. ダウンロードしたPLaMo Translateモデルを選択
3. **ポート設定**: デフォルト `1234` を確認
4. 「Start Server」をクリック
5. サーバーが起動し、`http://localhost:1234` で待機開始

**動作確認**:

```bash
curl http://localhost:1234/v1/models
```

正常に動作していれば、利用可能なモデル一覧が返されます。

### 2. Chrome拡張機能のインストール

#### 2.1 リポジトリのクローン

```bash
git clone https://github.com/YOUR_USERNAME/plamo-translate-chrome-extension.git
cd plamo-translate-chrome-extension
```

#### 2.2 Chromeへの読み込み

1. Chromeで `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」を有効化
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. クローンしたディレクトリを選択
5. 拡張機能が読み込まれ、ツールバーにアイコンが表示される

## 使い方

### 基本的な翻訳方法

1. **テキスト選択**: Webページ上で翻訳したいテキストを選択
2. **右クリック**: 選択したテキストを右クリック
3. **翻訳実行**: コンテキストメニューから「PLaMoで翻訳」を選択
4. **結果表示**: ポップアップまたはサイドパネルに翻訳結果が表示

### 翻訳方向

拡張機能は自動的に言語を検出し、適切な方向に翻訳します：

- **日本語 → 英語**: 日本語テキストが検出された場合
- **英語 → 日本語**: 英語テキストが検出された場合

### 設定

拡張機能のアイコンをクリックして設定画面を開き、以下を調整可能：

- **LM StudioのURL**: デフォルト `http://localhost:1234`
- **モデル名**: 使用するモデルの指定
- **最大トークン数**: 翻訳結果の最大長 (デフォルト: 1000)

## トラブルシューティング

### 問題: 「サーバーに接続できません」エラー

**原因**: LM Studioサーバーが起動していない、または別のポートで動作している

**解決方法**:
1. LM Studioでサーバーが起動しているか確認
2. ポート番号が `1234` であることを確認
3. ファイアウォールがlocalhostへの接続をブロックしていないか確認

```bash
# サーバーの動作確認
curl http://localhost:1234/v1/models
```

### 問題: 翻訳が遅い

**原因**: モデルサイズが大きい、またはCPUのみで動作している

**解決方法**:
1. より小さい量子化レベル (Q4_K_M) を使用
2. LM StudioでGPUオフロードを有効化
3. RAMを16GB以上に増設

### 問題: 翻訳品質が低い

**原因**: 量子化レベルが低すぎる

**解決方法**:
1. より高い量子化レベル (Q6_K, Q8_0) を使用
2. システムメモリに余裕があれば、BF16 (19.1GB) を試す

### 問題: Chrome拡張がローカルAPIを呼び出せない

**原因**: Manifest V3のhost_permissions設定が不足

**解決方法**:
`manifest.json`で以下を確認：
```json
{
  "host_permissions": [
    "http://localhost:1234/*"
  ]
}
```

## プロジェクト構成

```
plamo-translate-chrome-extension/
├── manifest.json          # Chrome拡張のマニフェストファイル
├── background.js          # バックグラウンドサービスワーカー
├── content.js             # コンテンツスクリプト
├── popup.html             # ポップアップUI
├── popup.js               # ポップアップのロジック
├── styles.css             # スタイルシート
├── icons/                 # 拡張機能のアイコン
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── README.md              # このファイル
├── DOMAIN_KNOWLEDGE.md    # 技術背景とドメイン知識
└── REQUIREMENTS.md        # 機能要件定義書
```

## ライセンス

### 拡張機能本体

MIT License

### PLaMo Translateモデル

PLaMo Community License - Preferred Networks, Inc.

**重要**: 年間売上10億円以上の企業が商用利用する場合は、Preferred Networksへの[お問い合わせ](https://www.preferred.jp/ja/plamo-community-license/)が必要です。

## 開発

### 開発環境のセットアップ

```bash
# リポジトリのクローン
git clone https://github.com/YOUR_USERNAME/plamo-translate-chrome-extension.git
cd plamo-translate-chrome-extension

# 依存関係のインストール (もしあれば)
npm install

# 開発サーバーの起動 (ホットリロード用)
npm run dev
```

### コントリビューション

プルリクエストを歓迎します！以下の手順でコントリビュートしてください：

1. このリポジトリをフォーク
2. 新しいブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add some amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## リンク

- [LM Studio公式サイト](https://lmstudio.ai/)
- [PLaMo Translateモデル (HuggingFace)](https://huggingface.co/pfnet/plamo-2-translate)
- [PLaMo Translate GGUF版](https://huggingface.co/mmnga/plamo-2-translate-gguf)
- [Preferred Networks](https://www.preferred.jp/)
- [Chrome Extension開発ガイド](https://developer.chrome.com/docs/extensions/)

## サポート

問題が発生した場合は、GitHubのIssuesで報告してください：
https://github.com/YOUR_USERNAME/plamo-translate-chrome-extension/issues

---

**作成者**: Sora  
**最終更新**: 2025-10-01
