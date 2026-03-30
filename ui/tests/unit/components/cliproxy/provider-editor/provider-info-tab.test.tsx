import { describe, expect, it } from 'vitest';
import { render, screen } from '@tests/setup/test-utils';
import { ProviderInfoTab } from '@/components/cliproxy/provider-editor/provider-info-tab';

const authenticatedStatus = {
  provider: 'codex',
  displayName: 'Codex',
  authenticated: true,
  lastAuth: null,
  tokenFiles: 1,
  accounts: [],
};

describe('ProviderInfoTab', () => {
  it('routes management commands through Claude target for codex-target variants', () => {
    render(
      <ProviderInfoTab
        provider="codex"
        displayName="Codex"
        defaultTarget="codex"
        authStatus={authenticatedStatus}
        supportsModelConfig
      />
    );

    expect(screen.getByText('ccs codex --target claude --config')).toBeInTheDocument();
    expect(screen.getByText('ccs codex --target claude --auth --add')).toBeInTheDocument();
    expect(screen.getByText('ccs codex --target claude --accounts')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Codex and Droid runtime launches reject those CLIProxy management commands\./
      )
    ).toBeInTheDocument();
  });

  it('hides unsupported model-config commands when the provider has no catalog support', () => {
    render(
      <ProviderInfoTab
        provider="custom-provider"
        displayName="Custom Provider"
        defaultTarget="claude"
        authStatus={{
          ...authenticatedStatus,
          provider: 'custom-provider',
          displayName: 'Custom Provider',
        }}
        supportsModelConfig={false}
      />
    );

    expect(screen.queryByText('Change model')).not.toBeInTheDocument();
    expect(screen.getByText('ccs custom-provider --auth --add')).toBeInTheDocument();
  });
});
