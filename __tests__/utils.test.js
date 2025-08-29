const { parseVersion, formatVersion, detectTriggerMode } = require('../src/utils');

describe('Utils', () => {
  describe('parseVersion', () => {
    test('parses standard version', () => {
      const result = parseVersion('v1.2.3');
      expect(result).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: null
      });
    });

    test('parses prerelease version', () => {
      const result = parseVersion('v1.2.3-beta.1');
      expect(result).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: 'beta.1'
      });
    });
  });

  describe('formatVersion', () => {
    test('formats standard version', () => {
      const result = formatVersion(1, 2, 3);
      expect(result).toBe('v1.2.3');
    });

    test('formats prerelease version', () => {
      const result = formatVersion(1, 2, 3, 'beta.1');
      expect(result).toBe('v1.2.3-beta.1');
    });
  });

  describe('detectTriggerMode', () => {
    test('detects PR merge', () => {
      const context = {
        eventName: 'pull_request',
        payload: { pull_request: { merged: true } }
      };
      const result = detectTriggerMode('auto-detect', context);
      expect(result).toBe('pr-merge');
    });

    test('detects manual trigger', () => {
      const context = { eventName: 'workflow_dispatch' };
      const result = detectTriggerMode('auto-detect', context);
      expect(result).toBe('manual');
    });
  });
});
