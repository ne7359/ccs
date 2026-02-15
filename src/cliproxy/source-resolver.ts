import type { AttributionResolverVersion } from '../config/unified-config-types';
import type { AccountInfo } from './accounts';
import {
  getProviderAliases,
  isCLIProxyProvider,
  mapExternalProviderName,
} from './provider-capabilities';
import type { CLIProxyProvider } from './types';

export type SourceMatchStep = 'account_id' | 'email' | 'nickname' | 'alias' | 'unmapped';

interface ResolverAccountCandidate {
  provider: CLIProxyProvider;
  account: AccountInfo;
  accountKey: string;
  normalizedId: string;
  normalizedEmail?: string;
  normalizedNickname?: string;
  aliasKeys: Set<string>;
}

export interface SourceResolution {
  source: string;
  normalizedSource: string;
  matched: boolean;
  provider: CLIProxyProvider | null;
  accountId: string | null;
  accountKey: string | null;
  matchStep: SourceMatchStep;
  resolverVersion: AttributionResolverVersion;
  ambiguous: boolean;
  candidateAccountIds?: string[];
}

interface CandidateSelection {
  candidate: ResolverAccountCandidate;
  ambiguous: boolean;
  candidateAccountIds?: string[];
}

function normalizeSource(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeAlias(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeSourceForAttribution(value: string): string {
  return normalizeSource(value);
}

function sanitizeForLog(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '?').slice(0, 120);
}

function hasExplicitProviderHint(providerHint: string | undefined): boolean {
  return typeof providerHint === 'string' && providerHint.trim().length > 0;
}

function getCanonicalProvider(providerHint: string | undefined): CLIProxyProvider | null {
  if (!providerHint) {
    return null;
  }

  const normalized = normalizeSource(providerHint);
  if (isCLIProxyProvider(normalized)) {
    return normalized;
  }

  return mapExternalProviderName(normalized);
}

function deriveSourceAliasKeys(source: string, providerHint: string | undefined): Set<string> {
  const normalized = normalizeSource(source);
  const keys = new Set<string>();

  const pushKey = (value: string) => {
    const alias = normalizeAlias(value);
    if (alias.length > 0) {
      keys.add(alias);
    }
  };

  pushKey(normalized);

  for (const separator of [':', '/', '|', '#']) {
    const index = normalized.lastIndexOf(separator);
    if (index > 0 && index < normalized.length - 1) {
      pushKey(normalized.slice(index + 1));
    }
  }

  const provider = getCanonicalProvider(providerHint);
  if (provider) {
    const aliases = [provider, ...getProviderAliases(provider)];
    for (const alias of aliases) {
      for (const separator of [':', '/', '|', '-']) {
        const prefix = `${alias}${separator}`;
        if (normalized.startsWith(prefix)) {
          pushKey(normalized.slice(prefix.length));
        }
      }
    }
  }

  return keys;
}

function buildAccountAliasKeys(account: AccountInfo): Set<string> {
  const keys = new Set<string>();

  const pushValue = (value: string | undefined) => {
    if (!value) {
      return;
    }
    const alias = normalizeAlias(value);
    if (alias.length > 0) {
      keys.add(alias);
    }
  };

  pushValue(account.id);
  pushValue(account.email);
  pushValue(account.nickname);

  if (account.id.includes('@')) {
    pushValue(account.id.split('@')[0]);
  }
  if (account.email?.includes('@')) {
    pushValue(account.email.split('@')[0]);
  }

  return keys;
}

function pickCandidate(
  matches: ResolverAccountCandidate[],
  source: string,
  step: SourceMatchStep
): CandidateSelection | null {
  if (matches.length === 0) {
    return null;
  }

  const sortedMatches = [...matches].sort((left, right) => {
    const accountCompare = left.account.id.localeCompare(right.account.id);
    return accountCompare !== 0 ? accountCompare : left.provider.localeCompare(right.provider);
  });

  const ambiguous = sortedMatches.length > 1;
  if (ambiguous) {
    const candidateList = sortedMatches.map(
      (candidate) => `${candidate.provider}:${candidate.account.id}`
    );
    console.warn(
      `[!] Source resolver ambiguity for "${sanitizeForLog(source)}" at ${step}. Candidates: ${candidateList.join(', ')}`
    );
  }

  return {
    candidate: sortedMatches[0],
    ambiguous,
    candidateAccountIds: ambiguous
      ? sortedMatches.map((candidate) => `${candidate.provider}:${candidate.account.id}`)
      : undefined,
  };
}

function createUnmappedResolution(
  source: string,
  normalizedSource: string,
  resolverVersion: AttributionResolverVersion
): SourceResolution {
  return {
    source,
    normalizedSource,
    matched: false,
    provider: null,
    accountId: null,
    accountKey: null,
    matchStep: 'unmapped',
    resolverVersion,
    ambiguous: false,
  };
}

export interface SourceResolver {
  resolve(source: string, providerHint?: string): SourceResolution;
}

export function createSourceResolver(
  accountsByProvider: Record<CLIProxyProvider, AccountInfo[]>,
  resolverVersion: AttributionResolverVersion
): SourceResolver {
  const candidates: ResolverAccountCandidate[] = [];
  const candidatesByProvider = new Map<CLIProxyProvider, ResolverAccountCandidate[]>();

  for (const [providerName, accounts] of Object.entries(accountsByProvider)) {
    const provider = providerName as CLIProxyProvider;
    const providerCandidates: ResolverAccountCandidate[] = [];

    for (const account of accounts) {
      const candidate: ResolverAccountCandidate = {
        provider,
        account,
        accountKey: `${provider}:${account.id}`,
        normalizedId: normalizeSource(account.id),
        normalizedEmail: account.email ? normalizeSource(account.email) : undefined,
        normalizedNickname: account.nickname ? normalizeSource(account.nickname) : undefined,
        aliasKeys: buildAccountAliasKeys(account),
      };

      candidates.push(candidate);
      providerCandidates.push(candidate);
    }

    candidatesByProvider.set(provider, providerCandidates);
  }

  const selectScope = (providerHint?: string): ResolverAccountCandidate[] => {
    if (!hasExplicitProviderHint(providerHint)) {
      return candidates;
    }

    const provider = getCanonicalProvider(providerHint);
    if (!provider) {
      return [];
    }

    return candidatesByProvider.get(provider) ?? [];
  };

  const resolveCandidate = (
    source: string,
    normalizedSource: string,
    providerHint: string | undefined
  ): { selection: CandidateSelection | null; step: SourceMatchStep } => {
    const scopedCandidates = selectScope(providerHint);

    const idMatches = scopedCandidates.filter(
      (candidate) => candidate.normalizedId === normalizedSource
    );
    const idSelection = pickCandidate(idMatches, source, 'account_id');
    if (idSelection) {
      return { selection: idSelection, step: 'account_id' };
    }

    const emailMatches = scopedCandidates.filter(
      (candidate) => candidate.normalizedEmail && candidate.normalizedEmail === normalizedSource
    );
    const emailSelection = pickCandidate(emailMatches, source, 'email');
    if (emailSelection) {
      return { selection: emailSelection, step: 'email' };
    }

    if (resolverVersion === 'v1') {
      return { selection: null, step: 'unmapped' };
    }

    const nicknameMatches = scopedCandidates.filter(
      (candidate) =>
        candidate.normalizedNickname && candidate.normalizedNickname === normalizedSource
    );

    if (nicknameMatches.length > 1 && !getCanonicalProvider(providerHint)) {
      const matchedProviders = new Set(nicknameMatches.map((candidate) => candidate.provider));
      if (matchedProviders.size > 1) {
        return { selection: null, step: 'unmapped' };
      }
    }

    const nicknameSelection = pickCandidate(nicknameMatches, source, 'nickname');
    if (nicknameSelection) {
      return { selection: nicknameSelection, step: 'nickname' };
    }

    const sourceAliasKeys = deriveSourceAliasKeys(source, providerHint);
    if (sourceAliasKeys.size === 0) {
      return { selection: null, step: 'unmapped' };
    }

    const aliasMatches = scopedCandidates.filter((candidate) => {
      for (const key of sourceAliasKeys) {
        if (candidate.aliasKeys.has(key)) {
          return true;
        }
      }
      return false;
    });

    if (aliasMatches.length > 1 && !getCanonicalProvider(providerHint)) {
      const matchedProviders = new Set(aliasMatches.map((candidate) => candidate.provider));
      if (matchedProviders.size > 1) {
        return { selection: null, step: 'unmapped' };
      }
    }

    const aliasSelection = pickCandidate(aliasMatches, source, 'alias');
    if (aliasSelection) {
      return { selection: aliasSelection, step: 'alias' };
    }

    return { selection: null, step: 'unmapped' };
  };

  return {
    resolve(source: string, providerHint?: string): SourceResolution {
      const normalizedSource = normalizeSource(source);
      if (normalizedSource.length === 0) {
        return createUnmappedResolution(source, normalizedSource, resolverVersion);
      }

      const { selection, step } = resolveCandidate(source, normalizedSource, providerHint);
      if (!selection) {
        return createUnmappedResolution(source, normalizedSource, resolverVersion);
      }

      return {
        source,
        normalizedSource,
        matched: true,
        provider: selection.candidate.provider,
        accountId: selection.candidate.account.id,
        accountKey: selection.candidate.accountKey,
        matchStep: step,
        resolverVersion,
        ambiguous: selection.ambiguous,
        candidateAccountIds: selection.candidateAccountIds,
      };
    },
  };
}
