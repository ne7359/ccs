import { describe, expect, it } from 'bun:test';
import { ERROR_CODES, getErrorCategory, getErrorDocUrl } from '../../../src/utils/error-codes';

describe('error-codes', () => {
  it('builds live docs URLs with lowercase anchors', () => {
    expect(getErrorDocUrl(ERROR_CODES.PROFILE_NOT_FOUND)).toBe(
      'https://docs.ccs.kaitran.ca/reference/error-codes#e104'
    );
    expect(getErrorDocUrl(ERROR_CODES.INTERNAL_ERROR)).toBe(
      'https://docs.ccs.kaitran.ca/reference/error-codes#e900'
    );
  });

  it('maps numeric ranges to human-readable categories', () => {
    expect(getErrorCategory(ERROR_CODES.CONFIG_MISSING)).toBe('Configuration');
    expect(getErrorCategory(ERROR_CODES.PROFILE_NOT_FOUND)).toBe('Profile Management');
    expect(getErrorCategory(ERROR_CODES.CLAUDE_NOT_FOUND)).toBe('Claude CLI Detection');
    expect(getErrorCategory(ERROR_CODES.API_AUTH_FAILED)).toBe('Network/API');
    expect(getErrorCategory(ERROR_CODES.FS_CANNOT_READ_FILE)).toBe('File System');
    expect(getErrorCategory(ERROR_CODES.INVALID_STATE)).toBe('Internal');
  });
});
