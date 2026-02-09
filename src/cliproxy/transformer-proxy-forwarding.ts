/**
 * Transformer Proxy Forwarding Utilities
 *
 * HTTP forwarding helpers for the model tier transformer proxy.
 * Extracted to keep the main proxy file focused on routing logic.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

/** Hop-by-hop headers that should not be forwarded */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

/** Maximum request body size (50MB) — defensive limit for localhost proxy */
const MAX_BODY_SIZE = 50 * 1024 * 1024;

/** Maximum response body size (10MB) — model list responses are typically <50KB */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

/**
 * Read full request body as a string.
 * Rejects with 413 if body exceeds MAX_BODY_SIZE.
 */
export function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let destroyed = false;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        destroyed = true;
        req.destroy(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!destroyed) resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', reject);
  });
}

/**
 * Build headers to forward to upstream.
 * Strips hop-by-hop headers, recalculates content-length.
 * @param options.stripAcceptEncoding Strip accept-encoding header (default: true).
 *   Set to false for streaming paths where compressed bytes are piped directly.
 */
export function buildForwardHeaders(
  originalHeaders: http.IncomingHttpHeaders,
  body: string,
  options?: { stripAcceptEncoding?: boolean }
): Record<string, string> {
  const stripEncoding = options?.stripAcceptEncoding ?? true;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(originalHeaders)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (key.toLowerCase() === 'host') continue;
    if (key.toLowerCase() === 'content-length') continue;
    // Strip accept-encoding to prevent gzip responses in buffered path
    // (forwardAndBuffer parses response as UTF-8 string, gzip bytes would corrupt JSON)
    if (stripEncoding && key.toLowerCase() === 'accept-encoding') continue;
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  headers['content-length'] = String(Buffer.byteLength(body));
  return headers;
}

/** Buffered upstream response */
export interface BufferedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Forward request to upstream and buffer the entire response.
 * Used for model list responses that need modification.
 */
export function forwardAndBuffer(
  upstreamUrl: URL,
  method: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number
): Promise<BufferedResponse> {
  return new Promise((resolve, reject) => {
    const isHttp = upstreamUrl.protocol === 'http:';
    const transport = isHttp ? http : https;
    const upstreamReq = transport.request(
      {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port || (isHttp ? 80 : 443),
        path: upstreamUrl.pathname + upstreamUrl.search,
        method,
        headers,
        timeout: timeoutMs,
      },
      (upstreamRes) => {
        const chunks: Buffer[] = [];
        let totalSize = 0;
        let destroyed = false;
        upstreamRes.on('data', (chunk: Buffer) => {
          totalSize += chunk.length;
          if (totalSize > MAX_RESPONSE_SIZE) {
            destroyed = true;
            upstreamRes.destroy(new Error('Response body too large'));
            return;
          }
          chunks.push(chunk);
        });
        upstreamRes.on('end', () => {
          if (destroyed) return;
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(upstreamRes.headers)) {
            if (value !== undefined) {
              responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
            }
          }
          resolve({
            statusCode: upstreamRes.statusCode ?? 502,
            headers: responseHeaders,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
        upstreamRes.on('error', reject);
      }
    );

    upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('Upstream timeout')));
    upstreamReq.on('error', reject);
    upstreamReq.write(body);
    upstreamReq.end();
  });
}

/**
 * Forward request to upstream and pipe the response directly to client.
 * SSE streaming safe — no buffering, uses pipe().
 */
export function forwardAndPipe(
  upstreamUrl: URL,
  method: string,
  headers: Record<string, string>,
  body: string,
  clientRes: http.ServerResponse,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const isHttp = upstreamUrl.protocol === 'http:';
    const transport = isHttp ? http : https;
    const upstreamReq = transport.request(
      {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port || (isHttp ? 80 : 443),
        path: upstreamUrl.pathname + upstreamUrl.search,
        method,
        headers,
        timeout: timeoutMs,
      },
      (upstreamRes) => {
        clientRes.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers);
        upstreamRes.pipe(clientRes);
        upstreamRes.on('end', resolve);
        upstreamRes.on('error', reject);
        // Clean up upstream connection if client disconnects mid-stream
        clientRes.on('close', () => {
          if (!upstreamRes.complete) {
            upstreamRes.destroy();
          }
        });
      }
    );

    upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('Upstream timeout')));
    upstreamReq.on('error', (err) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
        clientRes.end('Upstream error');
      }
      reject(err);
    });
    upstreamReq.write(body);
    upstreamReq.end();
  });
}
