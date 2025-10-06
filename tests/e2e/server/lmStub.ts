import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { Server } from 'http';
import path from 'path';
import type { AddressInfo } from 'net';
function isAddressInfo(address: unknown): address is AddressInfo {
  return typeof address === 'object' && address !== null && 'port' in address;
}

export interface LmStubOptions {
  port?: number;
  models?: Array<{ id: string; object: string }>;
  chatResponse?: string;
  delay?: number; // レスポンス遅延（ミリ秒）
}

interface ChatMessage {
  content?: unknown;
}

interface ChatCompletionRequestBody {
  model?: string;
  messages?: ChatMessage[];
}

function calculatePromptLength(body: ChatCompletionRequestBody): number {
  const messages = body.messages || [];
  let total = 0;
  for (const msg of messages) {
    const content = msg?.content as unknown;
    if (typeof content === 'string') {
      total += content.length;
    } else if (Array.isArray(content)) {
      total += content.map(item => String(item)).join('').length;
    } else if (content !== undefined && content !== null) {
      total += String(content).length;
    }
  }
  return total;
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
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });

    // モデル一覧エンドポイント
    this.app.get('/v1/models', (_req: Request, res: Response) => {
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
      const body = req.body as ChatCompletionRequestBody;
      const promptLength = calculatePromptLength(body);

      const responseBody = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: body.model || 'test-model',
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
          prompt_tokens: promptLength,
          completion_tokens: responseText.length,
          total_tokens: promptLength + responseText.length
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
    this.app.get('/health', (_req: Request, res: Response) => {
      if (options.delay) {
        setTimeout(() => {
          res.json({ status: 'ok', timestamp: Date.now() });
        }, options.delay);
      } else {
        res.json({ status: 'ok', timestamp: Date.now() });
      }
    });

    // デフォルトの404ハンドラー
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({ error: 'Not Found' });
    });
  }

  private getServerAddressInfo(server: Server): { port: number } | null {
    const address = server.address();
    if (isAddressInfo(address)) {
      return { port: address.port };
    }
    if (typeof address === 'number') {
      return { port: address };
    }
    return null;
  }

  /**
   * サーバーを起動
   */
  async start(): Promise<number> {
    if (this.server !== null) {
      throw new Error('Server is already running');
    }
    return new Promise((resolve, reject) => {
      try {
        const server = this.app.listen(this.port, '127.0.0.1');
        this.server = server;
        const onError = (err: unknown) => reject(err);
        server.once('error', onError);
        server.once('listening', () => {
          const addressInfo = this.getServerAddressInfo(server);
          if (addressInfo) {
            this.port = addressInfo.port;
          }
          console.log(`LM Studioスタブサーバーがポート${this.port}で起動しました`);
          server.off('error', onError);
          resolve(this.port);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * サーバーを停止
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        this.server = null;
        resolve();
        return;
      }
      const server = this.server;
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Server close timed out'));
        }
      }, 5000);
      server.close((err?: Error) => {
        if (settled) return;
        clearTimeout(timeout);
        settled = true;
        if (err) {
          reject(err);
          return;
        }
        console.log(`LM Studioスタブサーバーを停止しました`);
        this.server = null;
        resolve();
      });
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
export async function startLmStub(options?: LmStubOptions): Promise<{ stop: () => Promise<void>; port: number; baseUrl: string }> {
  const server = new LmStubServer(options);
  const port = await server.start();
  return {
    stop: async () => {
      await server.stop();
    },
    port,
    baseUrl: `http://localhost:${port}`
  };
}
