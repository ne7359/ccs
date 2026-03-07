import { describe, expect, it } from 'bun:test';
import * as http from 'http';
import { DEFAULT_COPILOT_MODELS, fetchModelsFromDaemon } from '../../../src/copilot/copilot-models';

describe('fetchModelsFromDaemon', () => {
  it('falls back to defaults when daemon is unreachable', async () => {
    const models = await fetchModelsFromDaemon(9999);
    expect(models).toEqual(DEFAULT_COPILOT_MODELS);
  });

  it('falls back to defaults when daemon returns invalid JSON', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{not-valid-json');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to resolve test server port');
    }

    try {
      const models = await fetchModelsFromDaemon(address.port);
      expect(models).toEqual(DEFAULT_COPILOT_MODELS);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('parses live limits from daemon metadata and preserves known model metadata', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [
            {
              id: 'claude-sonnet-4.5',
              name: 'Claude Sonnet 4.5',
              capabilities: {
                limits: {
                  max_context_window_tokens: 128000,
                  max_prompt_tokens: 128000,
                  max_output_tokens: 64000,
                },
              },
            },
            {
              id: 'claude-sonnet-4.6',
              name: 'Claude Sonnet 4.6',
              capabilities: {
                limits: {
                  max_context_window_tokens: 128000,
                  max_prompt_tokens: 128000,
                  max_output_tokens: 64000,
                },
              },
            },
            {
              id: '',
              name: 'invalid-entry',
            },
          ],
        })
      );
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to resolve test server port');
    }

    try {
      const models = await fetchModelsFromDaemon(address.port);
      expect(models).toHaveLength(2);

      const knownModel = models.find((model) => model.id === 'claude-sonnet-4.5');
      expect(knownModel?.provider).toBe('anthropic');
      expect(knownModel?.minPlan).toBe('pro');
      expect(knownModel?.multiplier).toBe(1);
      expect(knownModel?.limits).toEqual({
        maxContextWindowTokens: 128000,
        maxPromptTokens: 128000,
        maxOutputTokens: 64000,
      });

      const liveOnlyModel = models.find((model) => model.id === 'claude-sonnet-4.6');
      expect(liveOnlyModel?.name).toBe('Claude Sonnet 4.6');
      expect(liveOnlyModel?.provider).toBe('anthropic');
      expect(liveOnlyModel?.limits?.maxPromptTokens).toBe(128000);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
