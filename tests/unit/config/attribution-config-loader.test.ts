import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getAttributionConfig,
  getConfigYamlPath,
  loadOrCreateUnifiedConfig,
} from '../../../src/config/unified-config-loader';

describe('attribution resolver config loading', () => {
  let originalCcsHome: string | undefined;
  let tempHome = '';

  beforeEach(() => {
    originalCcsHome = process.env.CCS_HOME;
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-attribution-config-'));
    process.env.CCS_HOME = tempHome;
  });

  afterEach(() => {
    if (originalCcsHome === undefined) {
      delete process.env.CCS_HOME;
    } else {
      process.env.CCS_HOME = originalCcsHome;
    }
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('falls back to v2 when resolverVersion is invalid', () => {
    const yamlPath = getConfigYamlPath();
    fs.mkdirSync(path.dirname(yamlPath), { recursive: true });
    fs.writeFileSync(
      yamlPath,
      [
        'version: 9',
        'accounts: {}',
        'profiles: {}',
        'cliproxy:',
        '  oauth_accounts: {}',
        '  providers: []',
        '  variants: {}',
        'preferences: {}',
        'attribution:',
        '  resolverVersion: bad-value',
        '',
      ].join('\n')
    );

    const config = loadOrCreateUnifiedConfig();
    expect(config.attribution?.resolverVersion).toBe('v2');
    expect(getAttributionConfig().resolverVersion).toBe('v2');
  });

  it('accepts resolver_version legacy key when valid', () => {
    const yamlPath = getConfigYamlPath();
    fs.mkdirSync(path.dirname(yamlPath), { recursive: true });
    fs.writeFileSync(
      yamlPath,
      [
        'version: 9',
        'accounts: {}',
        'profiles: {}',
        'cliproxy:',
        '  oauth_accounts: {}',
        '  providers: []',
        '  variants: {}',
        'preferences: {}',
        'attribution:',
        '  resolver_version: v1',
        '',
      ].join('\n')
    );

    const config = loadOrCreateUnifiedConfig();
    expect(config.attribution?.resolverVersion).toBe('v1');
    expect(getAttributionConfig().resolverVersion).toBe('v1');
  });
});
