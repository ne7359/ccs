import * as fs from 'fs/promises';
import * as path from 'path';
import { getCcsDir } from '../utils/config-manager';
import { writeFileAtomic } from '../utils/atomic-writer';
import type { AttributionResolverVersion } from '../config/unified-config-types';
import type { CLIProxyProvider } from './types';
import type { SourceMatchStep, SourceResolution } from './source-resolver';
import { normalizeSourceForAttribution } from './source-resolver';
import { isCLIProxyProvider, mapExternalProviderName } from './provider-capabilities';

const ATTRIBUTION_HISTORY_FILENAME = 'attribution-history.json';
const ATTRIBUTION_HISTORY_VERSION = 1;
const MAX_ATTRIBUTION_HISTORY_RECORDS = 10000;

interface StoredAttributionRecord {
  matched: boolean;
  provider: CLIProxyProvider | null;
  accountId: string | null;
  accountKey: string | null;
  matchStep: SourceMatchStep;
  resolverVersion: AttributionResolverVersion;
  ambiguous: boolean;
  candidateAccountIds?: string[];
  updatedAt: string;
}

interface AttributionHistorySnapshot {
  version: number;
  records: Record<string, StoredAttributionRecord>;
}

function getAttributionHistoryPath(): string {
  return path.join(getCcsDir(), 'cliproxy', ATTRIBUTION_HISTORY_FILENAME);
}

function normalizeProviderHint(providerHint: string | undefined): string {
  if (!providerHint) {
    return '*';
  }

  const normalized = providerHint.trim().toLowerCase();
  if (!normalized) {
    return '*';
  }

  if (isCLIProxyProvider(normalized)) {
    return normalized;
  }

  return mapExternalProviderName(normalized) ?? normalized;
}

function buildHistoryKey(normalizedSource: string, providerHint: string | undefined): string {
  return `${normalizeProviderHint(providerHint)}::${normalizedSource}`;
}

function toSnapshot(records: Map<string, StoredAttributionRecord>): AttributionHistorySnapshot {
  return {
    version: ATTRIBUTION_HISTORY_VERSION,
    records: Object.fromEntries(records),
  };
}

function parseSnapshot(raw: string): AttributionHistorySnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AttributionHistorySnapshot>;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    if (
      typeof parsed.version !== 'number' ||
      typeof parsed.records !== 'object' ||
      !parsed.records
    ) {
      return null;
    }
    return {
      version: parsed.version,
      records: parsed.records as Record<string, StoredAttributionRecord>,
    };
  } catch {
    return null;
  }
}

function isRecordEqual(left: StoredAttributionRecord, right: StoredAttributionRecord): boolean {
  return (
    left.matched === right.matched &&
    left.provider === right.provider &&
    left.accountId === right.accountId &&
    left.accountKey === right.accountKey &&
    left.matchStep === right.matchStep &&
    left.resolverVersion === right.resolverVersion &&
    left.ambiguous === right.ambiguous &&
    JSON.stringify(left.candidateAccountIds ?? []) ===
      JSON.stringify(right.candidateAccountIds ?? [])
  );
}

function toSourceResolution(
  source: string,
  normalizedSource: string,
  record: StoredAttributionRecord
): SourceResolution {
  return {
    source,
    normalizedSource,
    matched: record.matched,
    provider: record.provider,
    accountId: record.accountId,
    accountKey: record.accountKey,
    matchStep: record.matchStep,
    resolverVersion: record.resolverVersion,
    ambiguous: record.ambiguous,
    candidateAccountIds: record.candidateAccountIds,
  };
}

function toStoredRecord(resolution: SourceResolution): StoredAttributionRecord {
  return {
    matched: resolution.matched,
    provider: resolution.provider,
    accountId: resolution.accountId,
    accountKey: resolution.accountKey,
    matchStep: resolution.matchStep,
    resolverVersion: resolution.resolverVersion,
    ambiguous: resolution.ambiguous,
    candidateAccountIds: resolution.candidateAccountIds,
    updatedAt: new Date().toISOString(),
  };
}

function trimHistoryRecords(records: Map<string, StoredAttributionRecord>): void {
  if (records.size <= MAX_ATTRIBUTION_HISTORY_RECORDS) {
    return;
  }

  const sorted = [...records.entries()].sort((left, right) =>
    left[1].updatedAt.localeCompare(right[1].updatedAt)
  );
  const removeCount = sorted.length - MAX_ATTRIBUTION_HISTORY_RECORDS;
  for (let index = 0; index < removeCount; index++) {
    const key = sorted[index]?.[0];
    if (key) {
      records.delete(key);
    }
  }
}

export class AttributionHistoryStore {
  private readonly records: Map<string, StoredAttributionRecord>;
  private dirty = false;

  private constructor(records: Map<string, StoredAttributionRecord>) {
    this.records = records;
  }

  static async load(): Promise<AttributionHistoryStore> {
    const historyPath = getAttributionHistoryPath();
    try {
      const raw = await fs.readFile(historyPath, 'utf8');
      const parsed = parseSnapshot(raw);
      if (!parsed) {
        return new AttributionHistoryStore(new Map());
      }
      return new AttributionHistoryStore(new Map(Object.entries(parsed.records)));
    } catch {
      return new AttributionHistoryStore(new Map());
    }
  }

  resolve(source: string, providerHint?: string): SourceResolution | null {
    const normalizedSource = normalizeSourceForAttribution(source);
    if (!normalizedSource) {
      return null;
    }

    const key = buildHistoryKey(normalizedSource, providerHint);
    const exactRecord = this.records.get(key);
    if (exactRecord) {
      return toSourceResolution(source, normalizedSource, exactRecord);
    }

    return null;
  }

  remember(source: string, providerHint: string | undefined, resolution: SourceResolution): void {
    const normalizedSource = normalizeSourceForAttribution(source);
    if (!normalizedSource) {
      return;
    }

    const key = buildHistoryKey(normalizedSource, providerHint);
    const record = toStoredRecord(resolution);
    const existing = this.records.get(key);
    if (existing && isRecordEqual(existing, record)) {
      return;
    }

    this.records.set(key, record);
    trimHistoryRecords(this.records);
    this.dirty = true;
  }

  async persist(): Promise<void> {
    if (!this.dirty) {
      return;
    }

    const historyPath = getAttributionHistoryPath();
    const payload = `${JSON.stringify(toSnapshot(this.records), null, 2)}\n`;
    await writeFileAtomic(historyPath, payload, { mode: 0o600 });

    this.dirty = false;
  }
}
