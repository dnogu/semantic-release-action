const core = require('@actions/core');
const github = require('@actions/github');

function detectTriggerMode(inputMode, context) {
  if (inputMode !== 'auto-detect') {
    return inputMode;
  }

  const eventName = context.eventName;

  if (eventName === 'pull_request') {
    if (context.payload.pull_request?.merged) {
      return 'pr-merge';
    }
    return 'pr-open';
  } else if (eventName === 'workflow_dispatch') {
    return 'manual';
  } else if (eventName === 'workflow_call') {
    return 'workflow-call';
  } else if (eventName === 'push' && context.ref === 'refs/heads/main') {
    return 'push-main';
  }

  return 'unknown';
}

function detectExecutionMode(inputMode, triggerMode, context = github.context) {
  if (inputMode !== 'auto-detect') {
    return inputMode;
  }

  if (triggerMode === 'pr-open') {
    const headRepo = context.payload?.pull_request?.head?.repo?.full_name;
    const baseRepo = context.repo?.owner && context.repo?.repo
      ? `${context.repo.owner}/${context.repo.repo}`
      : null;

    if (headRepo && baseRepo && headRepo !== baseRepo) {
      return 'validate';
    }

    return 'prepare';
  }

  return 'release';
}

function parseLabels(context, inputs, triggerMode) {
  let releaseType = 'none';
  let isPrerelease = false;

  if (triggerMode === 'pr-open' || triggerMode === 'pr-merge') {
    const labels = context.payload.pull_request?.labels?.map(label => label.name) || [];
    core.info(`PR labels: ${labels.join(', ')}`);

    isPrerelease = labels.includes(inputs.prereleaseLabel);

    if (labels.includes(inputs.majorLabel)) {
      releaseType = 'major';
    } else if (labels.includes(inputs.minorLabel)) {
      releaseType = 'minor';
    } else if (labels.includes(inputs.patchLabel)) {
      releaseType = 'patch';
    }
  } else if (triggerMode === 'manual') {
    releaseType = core.getInput('manual-release-type') || 'patch';
    isPrerelease = core.getBooleanInput('manual-is-prerelease') || false;
  } else if (triggerMode === 'workflow-call') {
    releaseType = core.getInput('release-type') || 'patch';
    isPrerelease = core.getBooleanInput('is-prerelease') || false;
  }

  return { releaseType, isPrerelease };
}

function parseVersion(version) {
  const cleanVersion = version.startsWith('v') ? version.slice(1) : version;

  const prereleaseIndex = cleanVersion.indexOf('-');
  let versionPart;
  let prereleasePart = null;

  if (prereleaseIndex !== -1) {
    versionPart = cleanVersion.substring(0, prereleaseIndex);
    prereleasePart = cleanVersion.substring(prereleaseIndex + 1);
  } else {
    versionPart = cleanVersion;
  }

  const parts = versionPart.split('.');

  return {
    major: parseInt(parts[0]) || 0,
    minor: parseInt(parts[1]) || 0,
    patch: parseInt(parts[2]) || 0,
    prerelease: prereleasePart
  };
}

function formatVersion(major, minor, patch, prerelease = null) {
  let version = `v${major}.${minor}.${patch}`;
  if (prerelease) {
    version += `-${prerelease}`;
  }
  return version;
}

function validateInputs(inputs) {
  const errors = [];

  if (!inputs.githubToken) {
    errors.push('github-token is required');
  }

  if (!['npm', 'yarn', 'pnpm'].includes(inputs.packageManager)) {
    errors.push('package-manager must be one of: npm, yarn, pnpm');
  }

  if (!['auto-detect', 'validate', 'prepare', 'release'].includes(inputs.executionMode)) {
    errors.push('execution-mode must be one of: auto-detect, validate, prepare, release');
  }

  if (inputs.packageJsonMode && !['update', 'verify', 'ignore'].includes(inputs.packageJsonMode)) {
    errors.push('package-json-mode must be one of: update, verify, ignore');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid inputs: ${errors.join(', ')}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  detectTriggerMode,
  detectExecutionMode,
  parseLabels,
  parseVersion,
  formatVersion,
  validateInputs,
  sleep
};
