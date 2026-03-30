import { describe, expect, it } from 'vitest';
import { render, screen } from '@tests/setup/test-utils';
import { CodexOverviewTab } from '@/components/compatible-cli/codex-overview-tab';
import type { CodexDashboardDiagnostics } from '@/hooks/use-codex-types';

function buildDiagnostics(activeProfile: string | null): CodexDashboardDiagnostics {
  return {
    binary: {
      installed: true,
      path: '/tmp/codex',
      installDir: '/tmp',
      source: 'PATH',
      version: 'codex-cli 0.118.0-alpha.3',
      overridePath: null,
      supportsConfigOverrides: true,
    },
    file: {
      label: 'Codex user config',
      path: '$CODEX_HOME/config.toml',
      resolvedPath: '/tmp/.codex/config.toml',
      exists: true,
      isSymlink: false,
      isRegularFile: true,
      sizeBytes: 64,
      mtimeMs: 100,
      parseError: null,
      readError: null,
    },
    workspacePath: '/tmp/workspace',
    config: {
      model: 'gpt-5.4',
      modelReasoningEffort: null,
      modelProvider: 'openai',
      activeProfile,
      approvalPolicy: null,
      sandboxMode: null,
      webSearch: null,
      toolOutputTokenLimit: null,
      personality: null,
      topLevelKeys: ['model_provider'],
      profileCount: activeProfile ? 1 : 0,
      profileNames: activeProfile ? [activeProfile] : [],
      modelProviderCount: 0,
      modelProviders: [],
      featureCount: 0,
      enabledFeatures: [],
      disabledFeatures: [],
      trustedProjectCount: 0,
      untrustedProjectCount: 0,
      projectTrust: [],
      mcpServerCount: 0,
      mcpServers: [],
    },
    supportMatrix: [],
    warnings: [],
    docsReference: {
      providerValues: ['openai', 'oss', 'custom model_providers'],
      settingsHierarchy: [],
      notes: [],
      links: [],
      providerDocs: [],
    },
  };
}

describe('CodexOverviewTab', () => {
  it('uses a bare codex command when no active profile is set', () => {
    render(<CodexOverviewTab diagnostics={buildDiagnostics(null)} />);

    expect(screen.getByText('Open native Codex')).toBeInTheDocument();
    expect(screen.getAllByText('codex').length).toBeGreaterThan(0);
    expect(screen.queryByText('codex --profile default')).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        (_, node) =>
          node?.textContent?.includes(
            'Built-in openai and oss providers are also valid native defaults'
          ) ?? false
      ).length
    ).toBeGreaterThan(0);
  });

  it('uses the active named profile when one is selected', () => {
    render(<CodexOverviewTab diagnostics={buildDiagnostics('work')} />);

    expect(screen.getByText('Inspect active profile')).toBeInTheDocument();
    expect(screen.getByText('codex --profile work')).toBeInTheDocument();
  });
});
