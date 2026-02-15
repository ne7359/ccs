import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { droidToolAdapter } from '../../../src/tools/adapters/droid-tool-adapter';

let originalCcsHome: string | undefined;
let tempHome: string;
let originalLog: typeof console.log;
let originalError: typeof console.error;
let logLines: string[] = [];
let errorLines: string[] = [];

beforeEach(() => {
  originalCcsHome = process.env.CCS_HOME;
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-droid-tool-test-'));
  process.env.CCS_HOME = tempHome;

  logLines = [];
  errorLines = [];
  originalLog = console.log;
  originalError = console.error;
  console.log = (...args: unknown[]) => {
    logLines.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    errorLines.push(args.map(String).join(' '));
  };
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;

  if (originalCcsHome === undefined) {
    delete process.env.CCS_HOME;
  } else {
    process.env.CCS_HOME = originalCcsHome;
  }

  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe('droid-tool-adapter', () => {
  it('writes config from setup flags', async () => {
    const exitCode = await droidToolAdapter.run([
      'setup',
      '--profile',
      'factory',
      '--endpoint',
      'https://droid.example.com',
      '--key',
      'sk-droid',
    ]);
    expect(exitCode).toBe(0);

    const configPath = path.join(tempHome, '.ccs', 'tools', 'droid', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      profile: string;
      endpoint: string;
      apiKey: string;
    };

    expect(config.profile).toBe('factory');
    expect(config.endpoint).toBe('https://droid.example.com');
    expect(config.apiKey).toBe('sk-droid');
  });

  it('rejects endpoint override when profile is missing', async () => {
    const exitCode = await droidToolAdapter.run(['setup', '--endpoint', 'https://droid.example.com']);
    expect(exitCode).toBe(1);
    expect(errorLines.some((line) => line.includes('--endpoint requires --profile'))).toBe(true);
  });

  it('rejects invalid endpoint URLs in setup flags', async () => {
    const exitCode = await droidToolAdapter.run([
      'setup',
      '--profile',
      'factory',
      '--endpoint',
      'not-a-url',
    ]);

    expect(exitCode).toBe(1);
    expect(errorLines.some((line) => line.includes('valid URL'))).toBe(true);
  });

  it('prints droid api key env export when configured', async () => {
    const configPath = path.join(tempHome, '.ccs', 'tools', 'droid', 'config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          profile: 'factory',
          endpoint: 'https://droid.example.com',
          apiKey: 'sk-droid',
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    const exitCode = await droidToolAdapter.run(['env', '--shell', 'bash']);
    expect(exitCode).toBe(0);
    expect(logLines.some((line) => line.includes("export DROID_API_KEY='sk-droid'"))).toBe(true);
  });

  it('reports unhealthy doctor status when config is missing', async () => {
    const exitCode = await droidToolAdapter.run(['doctor']);
    expect(exitCode).toBe(1);
    expect(errorLines.some((line) => line.includes('Config missing'))).toBe(true);
  });
});
