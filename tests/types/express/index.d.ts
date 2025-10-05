import type { IncomingMessage, ServerResponse } from 'http';
import type { Server } from 'http';

declare module 'express' {
  interface Request extends IncomingMessage {
    body?: unknown;
  }

  interface Response extends ServerResponse {
    json(body: unknown): Response;
    status(code: number): Response;
    header(name: string, value: string): void;
  }

  type NextFunction = () => void;

  type RequestHandler = (req: Request, res: Response, next: NextFunction) => void;

  interface Application {
    use(handler: RequestHandler): void;
    use(path: string, handler: RequestHandler): void;
    get(path: string, handler: RequestHandler): void;
    post(path: string, handler: RequestHandler): void;
    listen(port: number, hostname?: string, callback?: () => void): Server;
  }

  interface ExpressModule {
    (): Application;
    json(): RequestHandler;
    static(path: string): RequestHandler;
  }

  const express: ExpressModule;

  namespace express {
    type Request = import('express').Request;
    type Response = import('express').Response;
    type NextFunction = import('express').NextFunction;
    type Application = import('express').Application;
    type RequestHandler = import('express').RequestHandler;
  }

  export = express;
}
