import {
  AI_PROVIDER_FAMILY_DEFINITIONS,
  AI_PROVIDER_FAMILY_IDS,
  type AiProviderApiKeyEntry,
  type AiProviderEntryView,
  type AiProviderFamilyId,
  type AiProviderFamilyState,
  type AiProviderModelAlias,
  type ListAiProvidersResult,
  type OpenAICompatEntry,
  type UpsertAiProviderEntryInput,
} from './types';
import { getAiProvidersSourceSummary, readFamilyEntries, writeFamilyEntries } from './config-store';

function maskSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > 8 ? `...${value.slice(-4)}` : '***';
}

function normalizeHeaders(
  headers: Array<{ key: string; value: string }> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const normalized = headers.reduce<Record<string, string>>((acc, header) => {
    const key = header.key.trim();
    if (!key) return acc;
    acc[key] = header.value;
    return acc;
  }, {});
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function toHeaderPairs(
  headers: Record<string, string> | undefined
): Array<{ key: string; value: string }> {
  return Object.entries(headers || {}).map(([key, value]) => ({ key, value }));
}

function normalizeModelAliases(models: AiProviderModelAlias[] | undefined): AiProviderModelAlias[] {
  return (models || [])
    .map((model) => ({
      name: model.name.trim(),
      alias: model.alias.trim(),
    }))
    .filter((model) => model.name.length > 0 || model.alias.length > 0);
}

function buildApiKeyEntryView(
  family: AiProviderFamilyId,
  entry: AiProviderApiKeyEntry,
  index: number
): AiProviderEntryView {
  return {
    id: entry.id || `${family}:${index}`,
    index,
    label: entry.prefix?.trim() || entry['base-url']?.trim() || `Entry ${index + 1}`,
    baseUrl: entry['base-url']?.trim() || undefined,
    proxyUrl: entry['proxy-url']?.trim() || undefined,
    prefix: entry.prefix?.trim() || undefined,
    headers: toHeaderPairs(entry.headers),
    excludedModels: [...(entry['excluded-models'] || [])],
    models: normalizeModelAliases(entry.models),
    apiKeyMasked: maskSecret(entry['api-key']),
    secretConfigured: Boolean(entry['api-key']),
  };
}

function buildOpenAiCompatEntryView(entry: OpenAICompatEntry, index: number): AiProviderEntryView {
  return {
    id: entry.id || `openai-compatibility:${index}`,
    index,
    name: entry.name,
    label: entry.name,
    baseUrl: entry['base-url']?.trim() || undefined,
    headers: toHeaderPairs(entry.headers),
    excludedModels: [],
    models: normalizeModelAliases(entry.models),
    apiKeysMasked: (entry['api-key-entries'] || []).map(
      (apiKeyEntry) => maskSecret(apiKeyEntry['api-key']) || '***'
    ),
    secretConfigured: (entry['api-key-entries'] || []).length > 0,
  };
}

function resolveFamilyStatus(entries: AiProviderEntryView[]): AiProviderFamilyState['status'] {
  if (entries.length === 0) return 'empty';
  return entries.every((entry) => entry.secretConfigured) ? 'ready' : 'partial';
}

export async function listAiProviders(): Promise<ListAiProvidersResult> {
  const families = await Promise.all(
    AI_PROVIDER_FAMILY_IDS.map(async (familyId) => {
      const definition = AI_PROVIDER_FAMILY_DEFINITIONS[familyId];
      if (familyId === 'openai-compatibility') {
        const entries = await readFamilyEntries(familyId);
        const entryViews = entries.map((entry, index) => buildOpenAiCompatEntryView(entry, index));
        return {
          ...definition,
          status: resolveFamilyStatus(entryViews),
          entries: entryViews,
        };
      }

      const entries = await readFamilyEntries(familyId);
      const entryViews = entries.map((entry, index) =>
        buildApiKeyEntryView(familyId, entry, index)
      );
      return {
        ...definition,
        status: resolveFamilyStatus(entryViews),
        entries: entryViews,
      };
    })
  );

  return {
    source: getAiProvidersSourceSummary(),
    families,
  };
}

function toApiKeyEntry(
  input: UpsertAiProviderEntryInput,
  existing?: AiProviderApiKeyEntry
): AiProviderApiKeyEntry {
  const nextSecret =
    input.apiKey !== undefined
      ? input.apiKey.trim()
      : input.preserveSecrets
        ? existing?.['api-key'] || ''
        : existing?.['api-key'] || '';

  return {
    id: existing?.id,
    'api-key': nextSecret,
    'base-url': input.baseUrl?.trim() || undefined,
    'proxy-url': input.proxyUrl?.trim() || undefined,
    prefix: input.prefix?.trim() || undefined,
    headers: normalizeHeaders(input.headers),
    'excluded-models': (input.excludedModels || [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    models: normalizeModelAliases(input.models),
  };
}

function toOpenAiCompatEntry(
  input: UpsertAiProviderEntryInput,
  existing?: OpenAICompatEntry
): OpenAICompatEntry {
  const nextApiKeys =
    input.apiKeys !== undefined
      ? input.apiKeys.map((value) => value.trim()).filter((value) => value.length > 0)
      : input.preserveSecrets
        ? (existing?.['api-key-entries'] || []).map((entry) => entry['api-key'])
        : (existing?.['api-key-entries'] || []).map((entry) => entry['api-key']);

  return {
    id: existing?.id,
    name: input.name?.trim() || existing?.name || 'connector',
    'base-url': input.baseUrl?.trim() || existing?.['base-url'] || '',
    headers: normalizeHeaders(input.headers),
    'api-key-entries': nextApiKeys.map((apiKey) => ({ 'api-key': apiKey })),
    models: normalizeModelAliases(input.models),
  };
}

function resolveEntryIndex(entries: Array<{ id?: string }>, entryId: string): number {
  const normalizedEntryId = entryId.trim();
  const matchedIndex = entries.findIndex((entry) => entry.id === normalizedEntryId);
  if (matchedIndex !== -1) {
    return matchedIndex;
  }

  const legacyIndex = Number.parseInt(normalizedEntryId, 10);
  if (
    Number.isInteger(legacyIndex) &&
    legacyIndex >= 0 &&
    legacyIndex < entries.length &&
    String(legacyIndex) === normalizedEntryId
  ) {
    return legacyIndex;
  }

  if (normalizedEntryId.startsWith('openai-compatibility:') || normalizedEntryId.includes(':')) {
    const legacySuffix = normalizedEntryId.split(':').at(-1) || '';
    const legacySuffixIndex = Number.parseInt(legacySuffix, 10);
    if (
      Number.isInteger(legacySuffixIndex) &&
      legacySuffixIndex >= 0 &&
      legacySuffixIndex < entries.length &&
      String(legacySuffixIndex) === legacySuffix
    ) {
      return legacySuffixIndex;
    }
  }

  throw new Error('Entry not found');
}

function assertEntryId(entryId: string): void {
  if (!entryId.trim()) {
    throw new Error('Entry not found');
  }
}

function validateFamilyInput(family: AiProviderFamilyId, input: UpsertAiProviderEntryInput): void {
  if (family === 'openai-compatibility') {
    if (!(input.name?.trim() || '').length) {
      throw new Error('name is required');
    }
    if (!(input.baseUrl?.trim() || '').length) {
      throw new Error('baseUrl is required');
    }
    if (!input.preserveSecrets && !(input.apiKeys || []).some((value) => value.trim().length > 0)) {
      throw new Error('At least one api key is required');
    }
    return;
  }

  if (!input.preserveSecrets && !(input.apiKey?.trim() || '').length) {
    throw new Error('apiKey is required');
  }
}

export async function createAiProviderEntry(
  family: AiProviderFamilyId,
  input: UpsertAiProviderEntryInput
): Promise<void> {
  validateFamilyInput(family, input);

  if (family === 'openai-compatibility') {
    const entries = await readFamilyEntries(family);
    entries.push(toOpenAiCompatEntry(input));
    await writeFamilyEntries(family, entries);
    return;
  }

  const entries = await readFamilyEntries(family);
  entries.push(toApiKeyEntry(input));
  await writeFamilyEntries(family, entries);
}

export async function updateAiProviderEntry(
  family: AiProviderFamilyId,
  entryId: string,
  input: UpsertAiProviderEntryInput
): Promise<void> {
  assertEntryId(entryId);

  if (family === 'openai-compatibility') {
    const entries = await readFamilyEntries(family);
    const index = resolveEntryIndex(entries, entryId);
    validateFamilyInput(family, input);
    entries[index] = toOpenAiCompatEntry(input, entries[index]);
    await writeFamilyEntries(family, entries);
    return;
  }

  const entries = await readFamilyEntries(family);
  const index = resolveEntryIndex(entries, entryId);
  validateFamilyInput(family, input);
  entries[index] = toApiKeyEntry(input, entries[index]);
  await writeFamilyEntries(family, entries);
}

export async function deleteAiProviderEntry(
  family: AiProviderFamilyId,
  entryId: string
): Promise<void> {
  assertEntryId(entryId);

  if (family === 'openai-compatibility') {
    const entries = await readFamilyEntries(family);
    const index = resolveEntryIndex(entries, entryId);
    entries.splice(index, 1);
    await writeFamilyEntries(family, entries);
    return;
  }

  const entries = await readFamilyEntries(family);
  const index = resolveEntryIndex(entries, entryId);
  entries.splice(index, 1);
  await writeFamilyEntries(family, entries);
}
