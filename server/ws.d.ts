declare module "ws" {
  import type { Server } from "node:http";

  export interface WebSocket {
    readonly readyState: number;
    send(data: string): void;
  }

  export interface WebSocketServerOptions {
    readonly path?: string;
    readonly server: Server;
  }

  export class WebSocketServer {
    readonly clients: Set<WebSocket>;
    constructor(options: WebSocketServerOptions);
    close(): void;
    on(event: "connection", listener: (ws: WebSocket) => void): this;
  }
}
