import { describe, expect, it } from 'vitest';

import type { OAuthAccount } from '@/lib/api-client';
import { buildAccountVisualGroups } from '@/lib/account-visual-groups';

function makeAccount(overrides: Partial<OAuthAccount> & Pick<OAuthAccount, 'id' | 'tokenFile'>) {
  return {
    id: overrides.id,
    email: 'kaidu.kd@gmail.com',
    provider: 'codex',
    isDefault: false,
    tokenFile: overrides.tokenFile,
    createdAt: '2026-03-30T00:00:00.000Z',
    ...overrides,
  } satisfies OAuthAccount;
}

describe('buildAccountVisualGroups', () => {
  it('orders grouped codex variants by audience consistently', () => {
    const groups = buildAccountVisualGroups([
      makeAccount({
        id: 'kaidu.kd@gmail.com#free',
        tokenFile: 'codex-kaidu.kd@gmail.com-free.json',
      }),
      makeAccount({
        id: 'kaidu.kd@gmail.com#04a0f049-team',
        tokenFile: 'codex-04a0f049-kaidu.kd@gmail.com-team.json',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.variants?.map((variant) => variant.audience)).toEqual([
      'business',
      'personal',
    ]);
    expect(groups[0]?.memberIds).toEqual([
      'kaidu.kd@gmail.com#04a0f049-team',
      'kaidu.kd@gmail.com#free',
    ]);
  });
});
