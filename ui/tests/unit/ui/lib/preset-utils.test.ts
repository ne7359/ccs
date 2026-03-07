import { afterEach, describe, expect, it, vi } from 'vitest';

import { MODEL_CATALOGS } from '@/lib/model-catalogs';
import { applyDefaultPreset } from '@/lib/preset-utils';

describe('claude preset utils', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the claude catalog default on Sonnet 4.6', () => {
    const claudeCatalog = MODEL_CATALOGS.claude;

    expect(claudeCatalog.defaultModel).toBe('claude-sonnet-4-6');
    expect(claudeCatalog.models.map((model) => model.id)).toContain('claude-sonnet-4-6');
  });

  it('applies the default claude preset from the catalog default model mapping', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiKey: { value: 'managed-key' } }),
      })
      .mockResolvedValueOnce({ ok: true });

    vi.stubGlobal('fetch', fetchMock);

    const result = await applyDefaultPreset('claude');

    expect(result).toEqual({ success: true, presetName: 'Claude Sonnet 4.6' });

    const [, requestInit] = fetchMock.mock.calls[1] ?? [];
    const body = JSON.parse(String(requestInit?.body));

    expect(body.settings.env).toMatchObject({
      ANTHROPIC_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-6',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
    });
  });
});
