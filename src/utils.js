const core = require('@actions/core');
const github = require('@actions/github');

function detectTriggerMode(inputMode, context) {
  if (inputMode !== 'auto-detect') {
    return inputMode;
  }

  const eventName = context.eventName;
  
  if (eventName === 'pull_request' && context.payload.pull_request?.merged) {
    return 'pr-merge';
  } else if (eventName === 'workflow_dispatch') {
    return 'manual';
  } else if (eventName === 'workflow_call') {
    return 'workflow-call';
  } else if (eventName === 'push' && context.ref === 'refs/heads/main') {
    return 'push-main';
  }
  
  return 'unknown';
}

function parseLabels(context, inputs, triggerMode) {
  let releaseType = 'none';
  let isPrerelease = false;
  
  if (triggerMode === 'pr-merge') {
    // Parse PR labels
    const labels = context.payload.pull_request?.labels?.map(label => label.name) || [];
    core.info(`PR labels: ${labels.join(', ')}`);
    
    // Check for prerelease label
    isPrerelease = labels.includes(inputs.prereleaseLabel);
    
    // Determine release type
    if (labels.includes(inputs.majorLabel)) {
      releaseType = 'major';
    } else if (labels.includes(inputs.minorLabel)) {
      releaseType = 'minor';
    } else if (labels.includes(inputs.patchLabel)) {
      releaseType = 'patch';
    }
    
  } else if (triggerMode === 'manual') {
    // For manual triggers, we expect these to be passed as inputs
    // This would be set by a workflow_dispatch input
    releaseType = core.getInput('manual-release-type') || 'patch';
    isPrerelease = core.getBooleanInput('manual-is-prerelease') || false;
    
  } else if (triggerMode === 'workflow-call') {
    // For workflow_call, these would be passed as inputs
    releaseType = core.getInput('release-type') || 'patch';
    isPrerelease = core.getBooleanInput('is-prerelease') || false;
  }
  
  return { releaseType, isPrerelease };
}

function parseVersion(version) {
  // Remove 'v' prefix if present
  const cleanVersion = version.startsWith('v') ? version.slice(1) : version;
  
  // Check for prerelease (contains hyphen)
  const prereleaseIndex = cleanVersion.indexOf('-');
  let versionPart, prereleasePart = null;
  
  if (prereleaseIndex !== -1) {
    versionPart = cleanVersion.substring(0, prereleaseIndex);
    prereleasePart = cleanVersion.substring(prereleaseIndex + 1);
  } else {
    versionPart = cleanVersion;
  }
  
  // Split version parts
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
  
  if (errors.length > 0) {
    throw new Error(`Invalid inputs: ${errors.join(', ')}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  detectTriggerMode,
  parseLabels,
  parseVersion,
  formatVersion,
  validateInputs,
  sleep
};
