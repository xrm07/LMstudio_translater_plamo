// E2Eテストのセットアップ
// JestのsetupFilesAfterEnvで各テスト前に実行されます
import { beforeAll } from '@jest/globals';

beforeAll(async () => {
  // 環境変数の設定（オプション）
  process.env.NODE_ENV = 'test';

  // デバッグモードではブラウザをheadfulで起動
  if (process.env.DEBUG_E2E) {
    process.env.PUPPETEER_HEADLESS = 'false';
  }
});
