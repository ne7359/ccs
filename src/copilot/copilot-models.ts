/**
 * Copilot Model Catalog
 *
 * Manages available models from copilot-api.
 * Based on GitHub Copilot supported models:
 * https://docs.github.com/copilot/reference/ai-models/supported-models
 */

import * as http from 'http';
import { CopilotModel } from './types';

const DEFAULT_COPILOT_MODEL_ID = 'gpt-4.1';
const MAX_MODELS_BODY_SIZE = 1024 * 1024; // 1MB

interface CopilotDaemonModelLimits {
  max_context_window_tokens?: unknown;
  max_output_tokens?: unknown;
  max_prompt_tokens?: unknown;
}

interface CopilotDaemonModel {
  id?: unknown;
  name?: unknown;
  capabilities?: {
    limits?: CopilotDaemonModelLimits;
  };
}

interface CopilotModelsResponse {
  data?: CopilotDaemonModel[];
}

/**
 * Default models available through copilot-api.
 * Used as fallback when API is not reachable.
 * Source: GitHub Copilot Supported Models (Dec 2025)
 *
 * Plan tiers: free, pro, pro+, business, enterprise
 * Multipliers: 0 = free tier, 0.25-0.33 = cheap, 1 = standard, 3-10 = premium
 */
export const DEFAULT_COPILOT_MODELS: CopilotModel[] = [
  // Anthropic Models - All require paid Copilot subscription
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    minPlan: 'pro',
    multiplier: 1,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    minPlan: 'pro',
    multiplier: 1,
  },
  {
    id: 'claude-opus-4.5',
    name: 'Claude Opus 4.5',
    provider: 'anthropic',
    minPlan: 'pro',
    multiplier: 3,
    preview: true,
  },
  {
    id: 'claude-opus-4.1',
    name: 'Claude Opus 4.1',
    provider: 'anthropic',
    minPlan: 'pro',
    multiplier: 10,
  },
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    minPlan: 'pro', // Requires paid Copilot subscription
    multiplier: 0.33,
  },

  // OpenAI Models
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'openai',
    minPlan: 'pro',
    multiplier: 1,
    preview: true,
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'GPT-5.1 Codex Max',
    provider: 'openai',
    minPlan: 'pro',
    multiplier: 1,
  },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', provider: 'openai', minPlan: 'pro', multiplier: 1 },
  {
    id: 'gpt-5.1-codex-mini',
    name: 'GPT-5.1 Codex Mini',
    provider: 'openai',
    minPlan: 'pro',
    multiplier: 0.33,
    preview: true,
  },
  { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'openai', minPlan: 'pro', multiplier: 1 },
  {
    id: 'gpt-5-codex',
    name: 'GPT-5 Codex',
    provider: 'openai',
    minPlan: 'pro',
    multiplier: 1,
    preview: true,
  },
  { id: 'gpt-5', name: 'GPT-5', provider: 'openai', minPlan: 'pro', multiplier: 1 },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai', minPlan: 'free', multiplier: 0 },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'openai',
    isDefault: true,
    minPlan: 'free',
    multiplier: 0,
  },

  // Google Models
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    provider: 'openai',
    minPlan: 'pro',
    multiplier: 1,
    preview: true,
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    provider: 'openai',
    minPlan: 'pro',
    multiplier: 0.33,
    preview: true,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'openai',
    minPlan: 'pro',
    multiplier: 1,
  },

  // xAI Models
  {
    id: 'grok-code-fast-1',
    name: 'Grok Code Fast 1',
    provider: 'openai',
    minPlan: 'pro',
    multiplier: 0.25,
  },

  // Fine-tuned Models
  {
    id: 'raptor-mini',
    name: 'Raptor Mini',
    provider: 'openai',
    minPlan: 'free',
    multiplier: 0,
    preview: true,
  },
];

/**
 * Fetch available models from running copilot-api daemon.
 *
 * @param port The port copilot-api is running on
 * @returns List of available models
 */
export async function fetchModelsFromDaemon(port: number): Promise<CopilotModel[]> {
  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (models: CopilotModel[]) => {
      if (resolved) return;
      resolved = true;
      resolve(models);
    };

    const req = http.request(
      {
        // Use 127.0.0.1 instead of localhost for more reliable local connections
        hostname: '127.0.0.1',
        port,
        path: '/v1/models',
        method: 'GET',
        timeout: 5000,
      },
      (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > MAX_MODELS_BODY_SIZE) {
            req.destroy();
            safeResolve(DEFAULT_COPILOT_MODELS);
          }
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data) as CopilotModelsResponse;
            if (Array.isArray(response.data)) {
              const models = response.data
                .map(mapDaemonModel)
                .filter((model): model is CopilotModel => model !== null);
              safeResolve(models.length > 0 ? models : DEFAULT_COPILOT_MODELS);
            } else {
              safeResolve(DEFAULT_COPILOT_MODELS);
            }
          } catch {
            safeResolve(DEFAULT_COPILOT_MODELS);
          }
        });
      }
    );

    req.on('error', () => {
      safeResolve(DEFAULT_COPILOT_MODELS);
    });

    req.on('timeout', () => {
      req.destroy();
      safeResolve(DEFAULT_COPILOT_MODELS);
    });

    req.end();
  });
}

/**
 * Get available models (from daemon or defaults).
 */
export async function getAvailableModels(port: number): Promise<CopilotModel[]> {
  return fetchModelsFromDaemon(port);
}

/**
 * Get the default model.
 * Uses gpt-4.1 as it's available on free tier.
 */
export function getDefaultModel(): string {
  return DEFAULT_COPILOT_MODEL_ID;
}

/**
 * Detect provider from model ID.
 */
function detectProvider(modelId: string): 'openai' | 'anthropic' {
  if (modelId.includes('claude')) return 'anthropic';
  return 'openai';
}

/**
 * Format model ID to human-readable name.
 * Includes badges for preview and plan tier.
 */
function formatModelName(modelId: string): string {
  // Find model in catalog for metadata
  const model = DEFAULT_COPILOT_MODELS.find((m) => m.id === modelId);
  if (model) {
    let name = model.name;
    if (model.preview) name += ' (Preview)';
    return name;
  }

  // Fallback: convert kebab-case to title case
  return modelId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function normalizeLimitValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractLimits(limits?: CopilotDaemonModelLimits): CopilotModel['limits'] | undefined {
  if (!limits) return undefined;

  const normalized = {
    maxContextWindowTokens: normalizeLimitValue(limits.max_context_window_tokens),
    maxOutputTokens: normalizeLimitValue(limits.max_output_tokens),
    maxPromptTokens: normalizeLimitValue(limits.max_prompt_tokens),
  };

  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
}

function mapDaemonModel(entry: CopilotDaemonModel): CopilotModel | null {
  if (typeof entry.id !== 'string') return null;
  const id = entry.id.trim();
  if (!id) return null;

  const defaultMeta = DEFAULT_COPILOT_MODELS.find((model) => model.id === id);
  const limits = extractLimits(entry.capabilities?.limits);

  return {
    ...defaultMeta,
    id,
    name:
      typeof entry.name === 'string' && entry.name.trim().length > 0
        ? entry.name.trim()
        : (defaultMeta?.name ?? formatModelName(id)),
    provider: defaultMeta?.provider ?? detectProvider(id),
    isDefault: id === DEFAULT_COPILOT_MODEL_ID,
    ...(limits ? { limits } : {}),
  };
}
