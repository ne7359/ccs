/**
 * Model Tier Transformer Proxy
 *
 * Local HTTP proxy that sits between CLIProxy and the real Antigravity upstream
 * for Pro-tier accounts. Two responsibilities:
 * 1. Model list injection: injects tier-gated models into fetchAvailableModels responses
 * 2. Request rewriting: rewrites tier-gated model names to their fallback in API requests
 *
 * This allows Pro accounts to register tier-gated models (like opus-4-6) so CLIProxy
 * includes them in round-robin, while actual requests use the fallback model (opus-4-5).
 */

import * as http from 'http';
import { URL } from 'url';
import {
  buildForwardHeaders,
  forwardAndBuffer,
  forwardAndPipe,
  readRequestBody,
} from './transformer-proxy-forwarding';

export interface ModelTierTransformerConfig {
  /** Model fallback mappings: key = ultra-only model, value = fallback */
  fallbackMap: Record<string, string>;
  /** Upstream base URL (real Antigravity API) */
  upstreamBaseUrl: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Request timeout in ms (default: 120000) */
  timeoutMs?: number;
}

export class ModelTierTransformerProxy {
  private server: http.Server | null = null;
  private port: number | null = null;
  private readonly fallbackMap: Record<string, string>;
  private readonly upstreamBaseUrl: string;
  private readonly verbose: boolean;
  private readonly timeoutMs: number;
  private stats = { modelListInjections: 0, modelRewrites: 0, passThrough: 0 };

  constructor(config: ModelTierTransformerConfig) {
    this.fallbackMap = config.fallbackMap;
    this.upstreamBaseUrl = config.upstreamBaseUrl;
    this.verbose = config.verbose ?? false;
    this.timeoutMs = config.timeoutMs ?? 120000;
  }

  async start(): Promise<number> {
    if (this.server) return this.port ?? 0;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
        void this.handleRequest(req, res).catch((err) => {
          this.log(`Request error: ${(err as Error).message}`);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Transformer proxy error');
          }
        });
      });
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server?.address();
        this.port = typeof address === 'object' && address ? address.port : 0;
        this.log(`Started on port ${this.port}`);
        resolve(this.port ?? 0);
      });
      this.server.on('error', reject);
    });
  }

  stop(): void {
    if (!this.server) return;
    this.log('Stopping transformer proxy');
    this.server.close();
    this.server = null;
    this.port = null;
  }

  getPort(): number | null {
    return this.port;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const requestPath = req.url ?? '/';

    // Status endpoint (no upstream call)
    if (req.method === 'GET' && requestPath === '/__ccs/transformer') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ fallbackMap: this.fallbackMap, stats: this.stats }));
      return;
    }

    if (requestPath.endsWith('/fetchAvailableModels')) {
      await this.handleModelListRequest(req, res);
    } else {
      await this.handleApiRequest(req, res);
    }
  }

  /** Buffer model list response, inject missing tier-gated models, forward */
  private async handleModelListRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const rawBody = await readRequestBody(req);
    const upstreamUrl = new URL(req.url ?? '/', this.upstreamBaseUrl);
    const headers = buildForwardHeaders(req.headers, rawBody);

    const upstream = await forwardAndBuffer(
      upstreamUrl,
      req.method ?? 'POST',
      headers,
      rawBody,
      this.timeoutMs
    );

    try {
      const parsed: unknown = JSON.parse(upstream.body);
      if (parsed && typeof parsed === 'object' && 'models' in parsed) {
        const obj = parsed as { models: unknown };
        if (typeof obj.models === 'object' && obj.models !== null && !Array.isArray(obj.models)) {
          // Antigravity returns models as Record<string, object>
          const record = obj.models as Record<string, unknown>;
          for (const ultraModel of Object.keys(this.fallbackMap)) {
            if (!(ultraModel in record)) {
              record[ultraModel] = { displayName: ultraModel };
              this.stats.modelListInjections++;
              this.log(`Injected ${ultraModel} into model list`);
            }
          }
        } else if (Array.isArray(obj.models)) {
          // Fallback: handle array format if API changes
          const existingIds = new Set(
            (obj.models as unknown[]).map((m) =>
              typeof m === 'string' ? m : (m as Record<string, unknown>)?.id
            )
          );
          for (const ultraModel of Object.keys(this.fallbackMap)) {
            if (!existingIds.has(ultraModel)) {
              (obj.models as unknown[]).push(ultraModel);
              this.stats.modelListInjections++;
              this.log(`Injected ${ultraModel} into model list`);
            }
          }
        }
        const modifiedBody = JSON.stringify(parsed);
        // Strip content-encoding since body was re-serialized as plain JSON
        const { 'content-encoding': _ce, ...cleanHeaders } = upstream.headers;
        const responseHeaders = {
          ...cleanHeaders,
          'content-length': String(Buffer.byteLength(modifiedBody)),
        };
        res.writeHead(upstream.statusCode, responseHeaders);
        res.end(modifiedBody);
        return;
      }
    } catch {
      // Parse failed — forward unchanged
    }

    res.writeHead(upstream.statusCode, upstream.headers);
    res.end(upstream.body);
  }

  /** Rewrite model name in request body, pipe response (SSE streaming safe) */
  private async handleApiRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const rawBody = await readRequestBody(req);
    let forwardBody = rawBody;

    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (parsed && typeof parsed === 'object' && 'model' in parsed) {
        const obj = parsed as { model: string };
        if (typeof obj.model === 'string' && this.fallbackMap[obj.model]) {
          const original = obj.model;
          obj.model = this.fallbackMap[obj.model];
          this.stats.modelRewrites++;
          this.log(`Rewrite model: ${original} -> ${obj.model}`);
          forwardBody = JSON.stringify(parsed);
        } else {
          this.stats.passThrough++;
        }
      }
    } catch {
      this.stats.passThrough++;
    }

    const upstreamUrl = new URL(req.url ?? '/', this.upstreamBaseUrl);
    const headers = buildForwardHeaders(req.headers, forwardBody, { stripAcceptEncoding: false });
    await forwardAndPipe(
      upstreamUrl,
      req.method ?? 'POST',
      headers,
      forwardBody,
      res,
      this.timeoutMs
    );
  }

  private log(msg: string): void {
    if (this.verbose) {
      console.error(`[model-tier-transformer] ${msg}`);
    }
  }
}
