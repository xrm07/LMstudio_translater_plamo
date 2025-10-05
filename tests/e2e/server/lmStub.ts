import express, { Request, Response, Application } from 'express';
import { Server } from 'http';
import path from 'path';
import { AddressInfo } from 'net';

export interface LmStubOptions {
  port?: number;
  models?: Array<{id: string, object: string}>;
  chatResponse?: string;
  delay?: number; // レスポンス遅延（ミリ秒）
}

/**
 * LM Studio APIスタブサーバー
 */
export class LmStubServer {
  private app: Application;
  private server: Server | null = null;
  private port: number;

  constructor(options: LmStubOptions = {}) {
    this.port = options.port ?? 0;

    this.app = express();
    this.app.use(express.json());

    const fixturesPath = path.resolve(__dirname, '..', 'fixtures', 'site');
    this.app.use('/fixtures', express.static(fixturesPath));

    // CORS許可
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      next();
    });

    // モデル一覧エンドポイント
    this.app.get('/v1/models', (req: Request, res: Response) => {
      const models = options.models || [
        { id: 'mmnga/plamo-2-translate-gguf', object: 'model' },
        { id: 'test-model-1', object: 'model' }
      ];

      if (options.delay) {
        setTimeout(() => {
          res.json({ data: models });
        }, options.delay);
      } else {
        res.json({ data: models });
      }
    });

    // チャット完了エンドポイント
    this.app.post('/v1/chat/completions', (req: Request, res: Response) => {
      const responseText = options.chatResponse || 'これはテスト翻訳結果です。';

      const responseBody = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: req.body.model || 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: responseText
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: req.body.messages?.[0]?.content?.length || 0,
          completion_tokens: responseText.length,
          total_tokens: (req.body.messages?.[0]?.content?.length || 0) + responseText.length
        }
      };

      if (options.delay) {
        setTimeout(() => {
          res.json(responseBody);
        }, options.delay);
      } else {
        res.json(responseBody);
      }
    });

    // ヘルスチェックエンドポイント
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // デフォルトの404ハンドラー
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({ error: 'Not Found' });
    });
  }

  /**
   * サーバーを起動
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, '127.0.0.1');
        this.server.once('listening', () => {
          const address = this.server?.address();
          if (typeof address === 'object' && address !== null) {
            this.port = (address as AddressInfo).port;
          } else if (typeof address === 'number') {
            this.port = address;
          }
          console.log(`LM Studioスタブサーバーがポート${this.port}で起動しました`);
          resolve(this.port);
        });
        this.server.once('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * サーバーを停止
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log(`LM Studioスタブサーバーを停止しました`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * サーバーが起動しているかを確認
   */
  isRunning(): boolean {
    return this.server !== null;
  }

  /**
   * ポート番号を取得
   */
  getPort(): number {
    return this.port;
  }
}

/**
 * 便利関数：スタブサーバーを起動してクリーンアップ関数を返す
 */
export async function startLmStub(options?: LmStubOptions): Promise<{ stop: () => Promise<void>, port: number, baseUrl: string }> {
  const server = new LmStubServer(options);
  const port = await server.start();
  return {
    stop: async () => { await server.stop(); },
    port,
    baseUrl: `http://localhost:${port}`
  };
}
