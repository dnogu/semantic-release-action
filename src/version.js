const core = require('@actions/core');
const fs = require('fs');
const { parseVersion, formatVersion } = require('./utils');

function calculateVersion(latestVersion, releaseType, isPrerelease, inputs) {
  const current = parseVersion(latestVersion);
  let { major, minor, patch } = current;

  switch (releaseType) {
    case 'major':
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor += 1;
      patch = 0;
      break;
    case 'patch':
      patch += 1;
      break;
    default:
      throw new Error(`Invalid release type: ${releaseType}`);
  }

  let prerelease = null;
  if (isPrerelease) {
    prerelease = `${inputs.prereleaseSuffix}.${inputs.prereleaseNumber}`;
  }

  return formatVersion(major, minor, patch, prerelease);
}

function updatePackageJson(packageJsonPath, newVersion) {
  if (!fs.existsSync(packageJsonPath)) {
    core.warning(`Package.json not found at ${packageJsonPath}, skipping version update`);
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    const versionWithoutV = newVersion.startsWith('v') ? newVersion.slice(1) : newVersion;
    packageJson.version = versionWithoutV;

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    core.info(`✅ Updated ${packageJsonPath} version to ${versionWithoutV}`);
    return true;
  } catch (error) {
    core.warning(`Failed to update package.json: ${error.message}`);
    return false;
  }
}

function normalizePackageJsonVersion(version) {
  return version.startsWith('v') ? version.slice(1) : version;
}

function verifyPackageJsonVersion(packageJsonPath, expectedVersion) {
  if (!fs.existsSync(packageJsonPath)) {
    core.warning(`Package.json not found at ${packageJsonPath}, skipping version verification`);
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const actualVersion = normalizePackageJsonVersion(packageJson.version || '');
    const expectedVersionWithoutV = normalizePackageJsonVersion(expectedVersion);

    if (actualVersion !== expectedVersionWithoutV) {
      throw new Error(
        `Expected ${packageJsonPath} version to be ${expectedVersionWithoutV}, but found ${actualVersion || '(empty)'}`
      );
    }

    core.info(`✅ Verified ${packageJsonPath} version matches ${expectedVersionWithoutV}`);
    return true;
  } catch (error) {
    core.error(`Package.json version verification failed: ${error.message}`);
    throw error;
  }
}

function parseExistingPrerelease(version) {
  const parts = version.split('-');
  if (parts.length < 2) {
    return null;
  }

  const prereleasePart = parts[1];
  const match = prereleasePart.match(/^(\w+)\.(\d+)$/);

  if (match) {
    return {
      suffix: match[1],
      number: parseInt(match[2])
    };
  }

  return null;
}

function incrementPrerelease(version, inputs) {
  const existing = parseExistingPrerelease(version);

  if (existing) {
    if (existing.suffix === inputs.prereleaseSuffix) {
      const versionBase = version.split('-')[0];
      return `${versionBase}-${inputs.prereleaseSuffix}.${existing.number + 1}`;
    }
  }

  return `${version}-${inputs.prereleaseSuffix}.${inputs.prereleaseNumber}`;
}

function validateVersion(version) {
  const versionRegex = /^v?\d+\.\d+\.\d+(-\w+\.\d+)?$/;
  if (!versionRegex.test(version)) {
    throw new Error(`Invalid version format: ${version}`);
  }
}

function compareVersions(version1, version2) {
  const v1 = parseVersion(version1);
  const v2 = parseVersion(version2);

  if (v1.major !== v2.major) {
    return v1.major - v2.major;
  }
  if (v1.minor !== v2.minor) {
    return v1.minor - v2.minor;
  }
  if (v1.patch !== v2.patch) {
    return v1.patch - v2.patch;
  }

  if (v1.prerelease && v2.prerelease) {
    return v1.prerelease.localeCompare(v2.prerelease);
  } else if (v1.prerelease) {
    return -1;
  } else if (v2.prerelease) {
    return 1;
  }

  return 0;
}

module.exports = {
  calculateVersion,
  updatePackageJson,
  verifyPackageJsonVersion,
  parseExistingPrerelease,
  incrementPrerelease,
  validateVersion,
  compareVersions
};
