// E2Eテストのセットアップ
// Jestのグローバルセットアップでテスト前に実行される

beforeAll(async () => {
  // 環境変数の設定（オプション）
  process.env.NODE_ENV = 'test';

  // デバッグモードではブラウザをheadfulで起動
  if (process.env.DEBUG_E2E) {
    process.env.PUPPETEER_HEADLESS = 'false';
  }
});

afterAll(async () => {
  // テスト後のクリーンアップ
});

// Jestのグローバルエラーハンドリング
process.on('unhandledRejection', (reason) => {
  // ここではログのみ。Jestのエラーハンドリングに干渉しない
  // eslint-disable-next-line no-console
  console.error('Unhandled Rejection:', reason);
});
