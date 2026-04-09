jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  getInput: jest.fn(),
  getBooleanInput: jest.fn()
}));

jest.mock('@actions/github', () => ({}));

const core = require('@actions/core');
const {
  detectTriggerMode,
  detectExecutionMode,
  parseLabels,
  parseVersion,
  formatVersion,
  validateInputs,
  sleep
} = require('../src/utils');

describe('utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectTriggerMode', () => {
    test('returns explicit mode when auto-detect is not used', () => {
      const context = { eventName: 'pull_request' };
      expect(detectTriggerMode('workflow-call', context)).toBe('workflow-call');
    });

    test('detects PR merge', () => {
      const context = {
        eventName: 'pull_request',
        payload: { pull_request: { merged: true } }
      };
      expect(detectTriggerMode('auto-detect', context)).toBe('pr-merge');
    });

    test('detects open PR events', () => {
      const context = {
        eventName: 'pull_request',
        payload: { pull_request: { merged: false } }
      };
      expect(detectTriggerMode('auto-detect', context)).toBe('pr-open');
    });

    test('detects manual trigger', () => {
      expect(detectTriggerMode('auto-detect', { eventName: 'workflow_dispatch' })).toBe('manual');
    });

    test('detects workflow_call trigger', () => {
      expect(detectTriggerMode('auto-detect', { eventName: 'workflow_call' })).toBe('workflow-call');
    });

    test('detects push to main', () => {
      const context = { eventName: 'push', ref: 'refs/heads/main' };
      expect(detectTriggerMode('auto-detect', context)).toBe('push-main');
    });

    test('returns unknown for unsupported events', () => {
      expect(detectTriggerMode('auto-detect', { eventName: 'schedule' })).toBe('unknown');
    });
  });

  describe('detectExecutionMode', () => {
    test('returns explicit mode when auto-detect is not used', () => {
      expect(detectExecutionMode('release', 'pr-open')).toBe('release');
    });

    test('uses validate mode for open PRs', () => {
      expect(detectExecutionMode('auto-detect', 'pr-open')).toBe('validate');
    });

    test('uses release mode for merged PRs and other triggers', () => {
      expect(detectExecutionMode('auto-detect', 'pr-merge')).toBe('release');
      expect(detectExecutionMode('auto-detect', 'workflow-call')).toBe('release');
    });
  });

  describe('parseLabels', () => {
    const labelInputs = {
      majorLabel: 'major',
      minorLabel: 'minor',
      patchLabel: 'patch',
      prereleaseLabel: 'prerelease'
    };

    test('parses PR labels and applies major > minor > patch precedence', () => {
      const context = {
        payload: {
          pull_request: {
            labels: [{ name: 'patch' }, { name: 'minor' }, { name: 'major' }, { name: 'prerelease' }]
          }
        }
      };

      expect(parseLabels(context, labelInputs, 'pr-merge')).toEqual({
        releaseType: 'major',
        isPrerelease: true
      });
      expect(core.info).toHaveBeenCalledWith('PR labels: patch, minor, major, prerelease');
    });

    test('returns none when PR has no release labels', () => {
      const context = { payload: { pull_request: { labels: [{ name: 'docs' }] } } };
      expect(parseLabels(context, labelInputs, 'pr-merge')).toEqual({
        releaseType: 'none',
        isPrerelease: false
      });
    });

    test('supports prerelease-only PR labels', () => {
      const context = { payload: { pull_request: { labels: [{ name: 'prerelease' }] } } };
      expect(parseLabels(context, labelInputs, 'pr-merge')).toEqual({
        releaseType: 'none',
        isPrerelease: true
      });
    });

    test('reads manual trigger inputs', () => {
      core.getInput.mockReturnValue('minor');
      core.getBooleanInput.mockReturnValue(true);

      expect(parseLabels({}, labelInputs, 'manual')).toEqual({
        releaseType: 'minor',
        isPrerelease: true
      });
      expect(core.getInput).toHaveBeenCalledWith('manual-release-type');
      expect(core.getBooleanInput).toHaveBeenCalledWith('manual-is-prerelease');
    });

    test('uses manual defaults when manual inputs are not set', () => {
      core.getInput.mockReturnValue('');
      core.getBooleanInput.mockReturnValue(false);

      expect(parseLabels({}, labelInputs, 'manual')).toEqual({
        releaseType: 'patch',
        isPrerelease: false
      });
    });

    test('reads workflow-call inputs', () => {
      core.getInput.mockReturnValue('major');
      core.getBooleanInput.mockReturnValue(true);

      expect(parseLabels({}, labelInputs, 'workflow-call')).toEqual({
        releaseType: 'major',
        isPrerelease: true
      });
      expect(core.getInput).toHaveBeenCalledWith('release-type');
      expect(core.getBooleanInput).toHaveBeenCalledWith('is-prerelease');
    });

    test('returns defaults for unknown trigger modes', () => {
      expect(parseLabels({}, labelInputs, 'unknown')).toEqual({
        releaseType: 'none',
        isPrerelease: false
      });
    });
  });

  describe('parseVersion', () => {
    test('parses standard version', () => {
      expect(parseVersion('v1.2.3')).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: null
      });
    });

    test('parses version without v prefix', () => {
      expect(parseVersion('2.5.9')).toEqual({
        major: 2,
        minor: 5,
        patch: 9,
        prerelease: null
      });
    });

    test('parses prerelease version', () => {
      expect(parseVersion('v1.2.3-beta.1')).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: 'beta.1'
      });
    });

    test('fills missing version segments with zero', () => {
      expect(parseVersion('v7.1')).toEqual({
        major: 7,
        minor: 1,
        patch: 0,
        prerelease: null
      });
    });
  });

  describe('formatVersion', () => {
    test('formats standard version', () => {
      expect(formatVersion(1, 2, 3)).toBe('v1.2.3');
    });

    test('formats prerelease version', () => {
      expect(formatVersion(1, 2, 3, 'beta.1')).toBe('v1.2.3-beta.1');
    });
  });

  describe('validateInputs', () => {
    test('accepts valid input values', () => {
      expect(() =>
        validateInputs({
          githubToken: 'token',
          packageManager: 'npm',
          executionMode: 'auto-detect',
          packageJsonMode: 'update'
        })
      ).not.toThrow();
    });

    test('rejects missing github token', () => {
      expect(() =>
        validateInputs({
          githubToken: '',
          packageManager: 'npm',
          executionMode: 'auto-detect',
          packageJsonMode: 'update'
        })
      ).toThrow(
        'Invalid inputs: github-token is required'
      );
    });

    test('rejects invalid package manager', () => {
      expect(() =>
        validateInputs({
          githubToken: 'token',
          packageManager: 'pip',
          executionMode: 'auto-detect',
          packageJsonMode: 'update'
        })
      ).toThrow(
        'Invalid inputs: package-manager must be one of: npm, yarn, pnpm'
      );
    });

    test('rejects invalid execution mode', () => {
      expect(() =>
        validateInputs({
          githubToken: 'token',
          packageManager: 'npm',
          executionMode: 'preview',
          packageJsonMode: 'update'
        })
      ).toThrow(
        'Invalid inputs: execution-mode must be one of: auto-detect, validate, release'
      );
    });

    test('rejects invalid package.json mode', () => {
      expect(() =>
        validateInputs({
          githubToken: 'token',
          packageManager: 'npm',
          executionMode: 'auto-detect',
          packageJsonMode: 'sync'
        })
      ).toThrow(
        'Invalid inputs: package-json-mode must be one of: update, verify, ignore'
      );
    });

    test('returns all input validation errors', () => {
      expect(() =>
        validateInputs({
          githubToken: '',
          packageManager: 'pip',
          executionMode: 'preview',
          packageJsonMode: 'sync'
        })
      ).toThrow(
        'Invalid inputs: github-token is required, package-manager must be one of: npm, yarn, pnpm, execution-mode must be one of: auto-detect, validate, release, package-json-mode must be one of: update, verify, ignore'
      );
    });
  });

  describe('sleep', () => {
    test('resolves after waiting', async () => {
      await expect(sleep(0)).resolves.toBeUndefined();
    });
  });
});
