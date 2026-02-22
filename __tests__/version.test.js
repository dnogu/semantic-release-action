jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn()
}));

const core = require('@actions/core');
const fs = require('fs');
const {
  calculateVersion,
  updatePackageJson,
  parseExistingPrerelease,
  incrementPrerelease,
  validateVersion,
  compareVersions
} = require('../src/version');

describe('version', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateVersion', () => {
    const prereleaseInputs = { prereleaseSuffix: 'beta', prereleaseNumber: '1' };

    test('calculates major release', () => {
      expect(calculateVersion('v1.2.3', 'major', false, prereleaseInputs)).toBe('v2.0.0');
    });

    test('calculates minor release', () => {
      expect(calculateVersion('v1.2.3', 'minor', false, prereleaseInputs)).toBe('v1.3.0');
    });

    test('calculates patch release', () => {
      expect(calculateVersion('v1.2.3', 'patch', false, prereleaseInputs)).toBe('v1.2.4');
    });

    test('adds prerelease suffix when requested', () => {
      expect(calculateVersion('v1.2.3', 'minor', true, prereleaseInputs)).toBe('v1.3.0-beta.1');
    });

    test('throws for invalid release type', () => {
      expect(() => calculateVersion('v1.2.3', 'invalid', false, prereleaseInputs)).toThrow(
        'Invalid release type: invalid'
      );
    });
  });

  describe('updatePackageJson', () => {
    test('skips update when file does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      updatePackageJson('package.json', 'v1.2.3');

      expect(core.warning).toHaveBeenCalledWith(
        'Package.json not found at package.json, skipping version update'
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    test('updates package.json version and strips v prefix', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ name: 'demo', version: '0.1.0' }));

      updatePackageJson('package.json', 'v1.2.3');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        'package.json',
        expect.stringContaining('"version": "1.2.3"')
      );
      expect(core.info).toHaveBeenCalledWith('✅ Updated package.json version to 1.2.3');
    });

    test('logs warning when package.json cannot be parsed', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('{');

      updatePackageJson('package.json', 'v1.2.3');

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update package.json:')
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('parseExistingPrerelease', () => {
    test('parses prerelease suffix and number', () => {
      expect(parseExistingPrerelease('v1.2.3-beta.10')).toEqual({
        suffix: 'beta',
        number: 10
      });
    });

    test('returns null for non-prerelease version', () => {
      expect(parseExistingPrerelease('v1.2.3')).toBeNull();
    });

    test('returns null for unsupported prerelease format', () => {
      expect(parseExistingPrerelease('v1.2.3-beta')).toBeNull();
    });
  });

  describe('incrementPrerelease', () => {
    test('increments existing prerelease number when suffix matches', () => {
      const result = incrementPrerelease('v1.2.3-beta.2', {
        prereleaseSuffix: 'beta',
        prereleaseNumber: '1'
      });
      expect(result).toBe('v1.2.3-beta.3');
    });

    test('restarts prerelease when suffix differs', () => {
      const result = incrementPrerelease('v1.2.3-alpha.5', {
        prereleaseSuffix: 'beta',
        prereleaseNumber: '1'
      });
      expect(result).toBe('v1.2.3-alpha.5-beta.1');
    });

    test('starts prerelease when none exists', () => {
      const result = incrementPrerelease('v1.2.3', {
        prereleaseSuffix: 'rc',
        prereleaseNumber: '4'
      });
      expect(result).toBe('v1.2.3-rc.4');
    });
  });

  describe('validateVersion', () => {
    test('accepts valid stable versions', () => {
      expect(() => validateVersion('v1.2.3')).not.toThrow();
      expect(() => validateVersion('1.2.3')).not.toThrow();
    });

    test('accepts valid prerelease versions', () => {
      expect(() => validateVersion('v1.2.3-beta.1')).not.toThrow();
    });

    test('rejects invalid versions', () => {
      expect(() => validateVersion('1.2')).toThrow('Invalid version format: 1.2');
      expect(() => validateVersion('v1.2.3-beta')).toThrow('Invalid version format: v1.2.3-beta');
    });
  });

  describe('compareVersions', () => {
    test('compares major, minor and patch components', () => {
      expect(compareVersions('v2.0.0', 'v1.9.9')).toBeGreaterThan(0);
      expect(compareVersions('v1.5.0', 'v1.4.9')).toBeGreaterThan(0);
      expect(compareVersions('v1.4.2', 'v1.4.3')).toBeLessThan(0);
    });

    test('treats prerelease as lower than stable', () => {
      expect(compareVersions('v1.0.0-beta.1', 'v1.0.0')).toBeLessThan(0);
      expect(compareVersions('v1.0.0', 'v1.0.0-beta.1')).toBeGreaterThan(0);
    });

    test('compares prerelease strings lexicographically', () => {
      expect(compareVersions('v1.0.0-alpha.1', 'v1.0.0-beta.1')).toBeLessThan(0);
    });

    test('returns zero for equal versions', () => {
      expect(compareVersions('v1.2.3', 'v1.2.3')).toBe(0);
    });
  });
});
