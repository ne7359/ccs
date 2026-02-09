/**
 * Transformer Proxy Forwarding Tests
 *
 * Tests for HTTP forwarding utilities used by the model tier transformer proxy.
 */
import { describe, it, expect } from 'bun:test';
import * as http from 'http';
import { Readable } from 'stream';
import { readRequestBody, buildForwardHeaders } from '../../../src/cliproxy/transformer-proxy-forwarding';

/** Create a mock IncomingMessage from a string body */
function createMockRequest(body: string): http.IncomingMessage {
  const stream = new Readable({
    read() {
      this.push(Buffer.from(body));
      this.push(null);
    },
  });
  return stream as unknown as http.IncomingMessage;
}

/** Create a mock IncomingMessage that emits chunks of a given total size */
function createLargeRequest(sizeBytes: number): http.IncomingMessage {
  const chunkSize = 64 * 1024; // 64KB chunks
  let remaining = sizeBytes;
  const stream = new Readable({
    read() {
      if (remaining <= 0) {
        this.push(null);
        return;
      }
      const size = Math.min(chunkSize, remaining);
      this.push(Buffer.alloc(size, 0x41)); // 'A' bytes
      remaining -= size;
    },
  });
  return stream as unknown as http.IncomingMessage;
}

describe('readRequestBody', () => {
  it('should read a normal request body', async () => {
    const body = '{"model": "claude-opus-4-6-thinking"}';
    const req = createMockRequest(body);
    const result = await readRequestBody(req);
    expect(result).toBe(body);
  });

  it('should handle empty body', async () => {
    const req = createMockRequest('');
    const result = await readRequestBody(req);
    expect(result).toBe('');
  });

  it('should handle multi-byte UTF-8 body', async () => {
    const body = '{"name": "日本語テスト"}';
    const req = createMockRequest(body);
    const result = await readRequestBody(req);
    expect(result).toBe(body);
  });

  it('should reject body exceeding 50MB limit', async () => {
    const oversized = 51 * 1024 * 1024; // 51MB
    const req = createLargeRequest(oversized);
    await expect(readRequestBody(req)).rejects.toThrow();
  });

  it('should accept body just under 50MB limit', async () => {
    const justUnder = 49 * 1024 * 1024; // 49MB
    const req = createLargeRequest(justUnder);
    const result = await readRequestBody(req);
    expect(result.length).toBe(justUnder);
  });
});

describe('buildForwardHeaders', () => {
  it('should strip hop-by-hop headers', () => {
    const original: http.IncomingHttpHeaders = {
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
      'proxy-authorization': 'Bearer token',
      'content-type': 'application/json',
      authorization: 'Bearer real-token',
    };
    const headers = buildForwardHeaders(original, '{}');
    expect(headers['content-type']).toBe('application/json');
    expect(headers['authorization']).toBe('Bearer real-token');
    expect(headers['connection']).toBeUndefined();
    expect(headers['transfer-encoding']).toBeUndefined();
    expect(headers['proxy-authorization']).toBeUndefined();
  });

  it('should strip host header', () => {
    const original: http.IncomingHttpHeaders = {
      host: 'localhost:12345',
      'content-type': 'application/json',
    };
    const headers = buildForwardHeaders(original, '{}');
    expect(headers['host']).toBeUndefined();
  });

  it('should recalculate content-length from body', () => {
    const body = '{"model":"test"}';
    const original: http.IncomingHttpHeaders = {
      'content-length': '999', // Wrong value
      'content-type': 'application/json',
    };
    const headers = buildForwardHeaders(original, body);
    expect(headers['content-length']).toBe(String(Buffer.byteLength(body)));
  });

  it('should strip accept-encoding by default (safe for buffered path)', () => {
    const original: http.IncomingHttpHeaders = {
      'accept-encoding': 'gzip, deflate, br',
      'content-type': 'application/json',
    };
    const headers = buildForwardHeaders(original, '{}');
    expect(headers['accept-encoding']).toBeUndefined();
  });

  it('should strip accept-encoding when stripAcceptEncoding is true', () => {
    const original: http.IncomingHttpHeaders = {
      'accept-encoding': 'gzip',
      'content-type': 'application/json',
    };
    const headers = buildForwardHeaders(original, '{}', { stripAcceptEncoding: true });
    expect(headers['accept-encoding']).toBeUndefined();
  });

  it('should preserve accept-encoding when stripAcceptEncoding is false', () => {
    const original: http.IncomingHttpHeaders = {
      'accept-encoding': 'gzip, deflate',
      'content-type': 'application/json',
    };
    const headers = buildForwardHeaders(original, '{}', { stripAcceptEncoding: false });
    expect(headers['accept-encoding']).toBe('gzip, deflate');
  });

  it('should join array header values with comma', () => {
    const original: http.IncomingHttpHeaders = {
      'x-custom': ['value1', 'value2'],
    };
    const headers = buildForwardHeaders(original, '{}');
    expect(headers['x-custom']).toBe('value1, value2');
  });

  it('should handle empty headers', () => {
    const headers = buildForwardHeaders({}, '{}');
    expect(headers['content-length']).toBe('2');
    expect(Object.keys(headers)).toEqual(['content-length']);
  });
});
