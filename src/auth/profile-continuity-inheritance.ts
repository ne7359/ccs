import * as fs from 'fs';
import {
  getConfigJsonPath,
  getContinuityInheritanceMap,
  isUnifiedMode,
} from '../config/unified-config-loader';
import { warn } from '../utils/ui';
import InstanceManager from '../management/instance-manager';
import ProfileRegistry from './profile-registry';
import { isAccountContextMetadata, resolveAccountContextPolicy } from './account-context';
import type { ProfileType } from '../types/profile';
import { getProfileLookupCandidates, resolveAliasToCanonical } from '../utils/profile-compat';

export interface ProfileContinuityInheritanceInput {
  profileName: string;
  profileType: ProfileType;
  target: string;
}

export interface ProfileContinuityInheritanceResult {
  sourceAccount?: string;
  claudeConfigDir?: string;
}

function loadLegacyContinuityInheritanceMap(): Record<string, string> {
  const configJsonPath = getConfigJsonPath();
  if (!fs.existsSync(configJsonPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { continuity_inherit_from_account?: unknown };
    if (
      typeof parsed.continuity_inherit_from_account !== 'object' ||
      parsed.continuity_inherit_from_account === null ||
      Array.isArray(parsed.continuity_inherit_from_account)
    ) {
      return {};
    }

    const normalized: Record<string, string> = {};
    for (const [profileName, accountName] of Object.entries(
      parsed.continuity_inherit_from_account as Record<string, unknown>
    )) {
      if (typeof accountName !== 'string') continue;
      const normalizedProfile = profileName.trim();
      const normalizedAccount = accountName.trim();
      if (!normalizedProfile || !normalizedAccount) continue;
      normalized[normalizedProfile] = normalizedAccount;
    }

    return normalized;
  } catch (error) {
    if (process.env.CCS_DEBUG) {
      console.error(
        warn(
          `Failed to parse legacy continuity mapping at "${configJsonPath}": ${(error as Error).message}`
        )
      );
    }
    return {};
  }
}

function resolveMappedAccount(
  profileName: string,
  inheritFromAccount: Record<string, string>
): string | undefined {
  const candidates = new Set<string>([
    ...getProfileLookupCandidates(profileName),
    resolveAliasToCanonical(profileName),
  ]);

  for (const candidate of candidates) {
    const mapped = inheritFromAccount[candidate];
    if (typeof mapped !== 'string') {
      continue;
    }

    const normalized = mapped.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  const normalizedCandidates = new Set(
    [...candidates].map((candidate) => candidate.trim().toLowerCase()).filter(Boolean)
  );
  for (const [mappedProfileName, mappedAccountName] of Object.entries(inheritFromAccount)) {
    if (!normalizedCandidates.has(mappedProfileName.trim().toLowerCase())) {
      continue;
    }

    const normalized = mappedAccountName.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return undefined;
}

/**
 * Resolve optional cross-profile continuity inheritance.
 *
 * Rules:
 * - Claude target only.
 * - Never applies to account profiles.
 * - Mapping source must be an account profile.
 */
export async function resolveProfileContinuityInheritance(
  input: ProfileContinuityInheritanceInput
): Promise<ProfileContinuityInheritanceResult> {
  if (input.target !== 'claude' || input.profileType === 'account') {
    return {};
  }

  const inheritFromAccount = getContinuityInheritanceMap();
  const sourceAccount =
    resolveMappedAccount(input.profileName, inheritFromAccount) ??
    (!isUnifiedMode()
      ? resolveMappedAccount(input.profileName, loadLegacyContinuityInheritanceMap())
      : undefined);
  if (!sourceAccount) {
    return {};
  }

  try {
    const registry = new ProfileRegistry();
    const profiles = registry.getAllProfilesMerged();
    const mappedProfile = profiles[sourceAccount];
    if (!mappedProfile || mappedProfile.type !== 'account') {
      console.error(
        warn(
          `Continuity inheritance skipped for "${input.profileName}": source "${sourceAccount}" not found or not an account profile`
        )
      );
      return {};
    }

    const contextPolicy = resolveAccountContextPolicy(
      isAccountContextMetadata(mappedProfile) ? mappedProfile : undefined
    );
    const instanceMgr = new InstanceManager();
    const instancePath = await instanceMgr.ensureInstance(sourceAccount, contextPolicy);

    return {
      sourceAccount,
      claudeConfigDir: instancePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      warn(
        `Continuity inheritance skipped for "${input.profileName}": failed to initialize source "${sourceAccount}" (${message})`
      )
    );
    return {};
  }
}
