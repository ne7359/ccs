#!/usr/bin/env node

/**
 * SSEParser - Parse Server-Sent Events (SSE) stream
 *
 * Handles:
 * - Incomplete events across chunks
 * - Multiple events in single chunk
 * - Malformed data (skip gracefully)
 * - [DONE] marker
 *
 * Usage:
 *   const parser = new SSEParser();
 *   stream.on('data', chunk => {
 *     const events = parser.parse(chunk);
 *     events.forEach(event => { ... });
 *   });
 */

interface SSEParserOptions {
  maxBufferSize?: number;
  throwOnMalformedJson?: boolean;
}

interface SSEEvent {
  event: string;
  data: unknown;
  index?: number;
  id?: string;
  retry?: number;
}

export class SSEParser {
  private buffer: string;
  private eventCount: number;
  private maxBufferSize: number;
  private throwOnMalformedJson: boolean;

  constructor(options: SSEParserOptions = {}) {
    this.buffer = '';
    this.eventCount = 0;
    this.maxBufferSize = options.maxBufferSize || 1024 * 1024; // 1MB default
    this.throwOnMalformedJson = options.throwOnMalformedJson === true;
  }

  /**
   * Parse chunk and extract SSE events
   * @param chunk - Data chunk from stream
   * @returns Array of parsed events
   */
  parse(chunk: Buffer | string): SSEEvent[] {
    this.buffer += chunk.toString();

    // C-01 Fix: Prevent unbounded buffer growth (DoS protection)
    if (this.buffer.length > this.maxBufferSize) {
      throw new Error(`SSE buffer exceeded ${this.maxBufferSize} bytes (DoS protection)`);
    }

    const lines = this.buffer.split('\n');

    // Keep incomplete line in buffer
    this.buffer = lines.pop() || '';

    const events: SSEEvent[] = [];
    let currentEvent: SSEEvent = { event: 'message', data: '' };

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent.event = line.substring(7).trim();
      } else if (line.startsWith('data: ')) {
        const data = line.substring(6);

        if (data === '[DONE]') {
          this.eventCount++;
          events.push({
            event: 'done',
            data: null,
            index: this.eventCount,
          });
          currentEvent = { event: 'message', data: '' };
        } else {
          try {
            currentEvent.data = JSON.parse(data);
            this.eventCount++;
            currentEvent.index = this.eventCount;
            events.push({ ...currentEvent });
            currentEvent = { event: 'message', data: '' };
          } catch (e) {
            // H-01 Fix: Log parse errors for debugging
            if (typeof console !== 'undefined' && console.error) {
              console.error(
                '[SSEParser] Malformed JSON event:',
                (e as Error).message,
                'Data:',
                data.substring(0, 100)
              );
            }
            if (this.throwOnMalformedJson) {
              throw new Error(`Malformed SSE JSON event: ${(e as Error).message}`);
            }
          }
        }
      } else if (line.startsWith('id: ')) {
        currentEvent.id = line.substring(4).trim();
      } else if (line.startsWith('retry: ')) {
        currentEvent.retry = parseInt(line.substring(7), 10);
      }
      // Empty lines separate events (already handled by JSON parsing)
    }

    return events;
  }

  /**
   * Reset parser state (for reuse)
   */
  reset(): void {
    this.buffer = '';
    this.eventCount = 0;
  }
}
