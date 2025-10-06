import type { IncomingMessage, ServerResponse } from 'http';
import type { Server } from 'http';

declare module 'express' {
  interface Request extends IncomingMessage {
    body?: unknown;
  }

  interface Response extends ServerResponse {
    json(body: unknown): Response;
    status(code: number): Response;
    header(name: string, value: string): Response;
  }

  type NextFunction = (err?: any) => void;

  type RequestHandler = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

  interface Application {
    use(handler: RequestHandler): Application;
    use(path: string, handler: RequestHandler): Application;
    get(path: string, handler: RequestHandler): Application;
    post(path: string, handler: RequestHandler): Application;
    listen(port: number, hostname?: string, callback?: () => void): Server;
  }

  interface ExpressModule {
    (): Application;
    json(): RequestHandler;
    static(path: string): RequestHandler;
  }

  const express: ExpressModule;

  // Note: Avoid redundant self re-exports that can cause circularities in editors

  export = express;
}
