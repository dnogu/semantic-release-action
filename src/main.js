const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');
const fs = require('fs');

const { detectTriggerMode, detectExecutionMode, parseLabels } = require('./utils');
const { calculateVersion, updatePackageJson, verifyPackageJsonVersion } = require('./version');
const { createRelease, createMajorRelease } = require('./release');

async function run() {
  try {
    // Get inputs
    const inputs = {
      githubToken: core.getInput('github-token', { required: true }),
      majorLabel: core.getInput('major-label'),
      minorLabel: core.getInput('minor-label'),
      patchLabel: core.getInput('patch-label'),
      prereleaseLabel: core.getInput('prerelease-label'),
      prereleaseSuffix: core.getInput('prerelease-suffix'),
      prereleaseNumber: core.getInput('prerelease-number'),
      nodeVersion: core.getInput('node-version'),
      packageManager: core.getInput('package-manager'),
      workingDirectory: core.getInput('working-directory'),
      installCommand: core.getInput('install-command'),
      testCommand: core.getInput('test-command'),
      buildCommand: core.getInput('build-command'),
      createMajorRelease: core.getBooleanInput('create-major-release'),
      baseRelease: core.getBooleanInput('base_release'),
      copyAssets: core.getBooleanInput('copy-assets'),
      autoGenerateNotes: core.getBooleanInput('auto-generate-notes'),
      updatePackageJson: core.getBooleanInput('update-package-json'),
      packageJsonMode: core.getInput('package-json-mode'),
      packageJsonPath: core.getInput('package-json-path'),
      gitUserName: core.getInput('git-user-name'),
      gitUserEmail: core.getInput('git-user-email'),
      triggerMode: core.getInput('trigger-mode'),
      executionMode: core.getInput('execution-mode'),
      commitChanges: core.getBooleanInput('commit-changes')
    };

    // Initialize GitHub client
    const octokit = github.getOctokit(inputs.githubToken);
    const context = github.context;

    core.info('🚀 Starting Semantic Release Action...');
    
    // Change to working directory if specified
    if (inputs.workingDirectory !== '.') {
      process.chdir(inputs.workingDirectory);
      core.info(`📁 Changed working directory to: ${inputs.workingDirectory}`);
    }

    // Detect trigger mode
    const triggerMode = detectTriggerMode(inputs.triggerMode, context);
    core.info(`🔍 Detected trigger mode: ${triggerMode}`);

    const executionMode = detectExecutionMode(inputs.executionMode, triggerMode);
    core.info(`🧭 Execution mode: ${executionMode}`);

    // Parse labels to determine release type
    const { releaseType, isPrerelease } = parseLabels(context, inputs, triggerMode);
    
    if (releaseType === 'none') {
      core.info('ℹ️ No release labels found. Skipping release creation.');
      core.setOutput('released', 'false');
      core.setOutput('release-type', 'none');
      return;
    }

    core.info(`📦 Release type: ${releaseType}${isPrerelease ? ' (prerelease)' : ''}`);

    // Get latest version
    const latestVersion = getLatestVersion();
    core.info(`🏷️ Latest version: ${latestVersion}`);

    // Calculate new version
    const newVersion = calculateVersion(latestVersion, releaseType, isPrerelease, inputs);
    core.info(`🆕 New version: ${newVersion}`);

    handlePackageJson(inputs, newVersion);

    setReleaseOutputs({
      released: false,
      version: newVersion,
      previousVersion: latestVersion,
      releaseType,
      isPrerelease,
      tagName: newVersion
    });

    if (executionMode === 'validate') {
      core.info('🧪 Validation mode enabled. Skipping build, tag, and release creation.');
      return;
    }

    // Setup Node.js and install dependencies
    await setupNodeAndDependencies(inputs);

    // Run tests
    await runTests(inputs);

    // Build project
    await runBuild(inputs);

    // Configure git
    configureGit(inputs);

    // Commit changes if any
    let shouldPushBranch = false;
    if (inputs.commitChanges) {
      shouldPushBranch = await commitChanges(newVersion, inputs);
    } else {
      core.info('📝 Skipping commit step because commit-changes is disabled');
    }

    // Create and push tag
    await createAndPushTag(newVersion, { pushBranch: shouldPushBranch });

    // Generate release notes
    const releaseNotes = generateReleaseNotes(latestVersion, newVersion, inputs);

    // Create GitHub release
    const release = await createRelease(octokit, context, {
      tagName: newVersion,
      name: newVersion,
      body: releaseNotes,
      prerelease: isPrerelease
    });

    core.info(`✅ Created release: ${release.html_url}`);

    // Set outputs
    setReleaseOutputs({
      released: true,
      version: newVersion,
      previousVersion: latestVersion,
      releaseType,
      isPrerelease,
      tagName: newVersion
    });
    core.setOutput('release-url', release.html_url);
    core.setOutput('release-id', release.id.toString());

    // Sync major version tag if requested and not a prerelease
    if (inputs.baseRelease && !isPrerelease) {
      const majorVersion = newVersion.split('.')[0]; // e.g., 'v1' from 'v1.2.3'
      
      const majorRelease = await createMajorRelease(octokit, context, {
        majorVersion,
        fullVersion: newVersion
      });

      if (majorRelease) {
        core.info(`✅ Synced major version tag ${majorVersion} to ${newVersion}`);
        core.setOutput('major-version', majorVersion);
        core.setOutput('major-release-url', release.html_url);
      }
    }

    core.info('🎉 Semantic release completed successfully!');

  } catch (error) {
    core.error(`❌ Action failed: ${error.message}`);
    core.setFailed(error.message);
  }
}

function handlePackageJson(inputs, newVersion) {
  const packageJsonMode = resolvePackageJsonMode(inputs);

  switch (packageJsonMode) {
    case 'update':
      updatePackageJson(inputs.packageJsonPath, newVersion);
      break;
    case 'verify':
      verifyPackageJsonVersion(inputs.packageJsonPath, newVersion);
      break;
    case 'ignore':
      core.info('📦 Skipping package.json handling');
      break;
    default:
      throw new Error(`Invalid package-json-mode: ${packageJsonMode}`);
  }
}

function resolvePackageJsonMode(inputs) {
  return inputs.packageJsonMode || (inputs.updatePackageJson ? 'update' : 'ignore');
}

function setReleaseOutputs({ released, version, previousVersion, releaseType, isPrerelease, tagName }) {
  core.setOutput('released', released.toString());
  core.setOutput('version', version);
  core.setOutput('previous-version', previousVersion);
  core.setOutput('release-type', releaseType);
  core.setOutput('is-prerelease', isPrerelease.toString());
  core.setOutput('tag-name', tagName);
}

function getLatestVersion() {
  try {
    // First try to get tags from remote to ensure we have the latest
    execSync('git fetch --tags', { stdio: 'pipe' });
    
    // Get all tags and filter for semantic version tags only (exclude major version tags like v1, v2)
    const allTags = execSync('git tag --sort=-version:refname', { encoding: 'utf8' }).trim();
    if (allTags) {
      const tags = allTags.split('\n');
      // Filter for semantic version tags (v1.2.3 format, not just v1)
      const semverTags = tags.filter(tag => /^v\d+\.\d+\.\d+/.test(tag));
      if (semverTags.length > 0) {
        return semverTags[0]; // First one is the latest due to sorting
      }
    }
    
    // Fallback: try git describe but only for semantic version tags
    try {
      const latestTag = execSync('git describe --tags --abbrev=0 --match="v*.*.*"', { encoding: 'utf8' }).trim();
      return latestTag;
    } catch (e) {
      // If no semantic version tags found
    }
    
    core.info('No previous semantic version tags found, starting from v0.0.0');
    return 'v0.0.0';
  } catch (error) {
    core.info('No previous tags found, starting from v0.0.0');
    return 'v0.0.0';
  }
}

async function setupNodeAndDependencies(inputs) {
  core.info('📦 Setting up dependencies...');
  
  // Auto-detect install command if not provided
  let installCmd = inputs.installCommand;
  if (!installCmd) {
    const packageManager = inputs.packageManager;
    const commands = {
      npm: 'npm ci',
      yarn: 'yarn install --frozen-lockfile',
      pnpm: 'pnpm install --frozen-lockfile'
    };
    installCmd = commands[packageManager] || 'npm ci';
  }

  if (fs.existsSync('package.json')) {
    core.info(`Running: ${installCmd}`);
    execSync(installCmd, { stdio: 'inherit' });
  } else {
    core.info('No package.json found, skipping dependency installation');
  }
}

async function runTests(inputs) {
  let testCmd = inputs.testCommand;
  
  if (!testCmd) {
    // Auto-detect test command
    if (fs.existsSync('package.json')) {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (pkg.scripts && pkg.scripts.test) {
        testCmd = `${inputs.packageManager} test`;
      }
    }
  }

  if (testCmd) {
    core.info(`🧪 Running tests: ${testCmd}`);
    execSync(testCmd, { stdio: 'inherit' });
  } else {
    core.info('No test command specified, skipping tests');
  }
}

async function runBuild(inputs) {
  let buildCmd = inputs.buildCommand;
  
  if (!buildCmd) {
    // Auto-detect build command
    if (fs.existsSync('package.json')) {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (pkg.scripts && pkg.scripts.build) {
        buildCmd = `${inputs.packageManager} run build`;
      }
    }
  }

  if (buildCmd) {
    core.info(`🔨 Building project: ${buildCmd}`);
    execSync(buildCmd, { stdio: 'inherit' });
  } else {
    core.info('No build command specified, skipping build');
  }
}

function configureGit(inputs) {
  core.info('⚙️ Configuring git...');
  execSync(`git config --local user.email "${inputs.gitUserEmail}"`);
  execSync(`git config --local user.name "${inputs.gitUserName}"`);
}

async function commitChanges(newVersion, inputs) {
  try {
    // Check if this is a GitHub Action project
    const isGitHubAction = fs.existsSync('action.yml') || fs.existsSync('action.yaml');
    
    if (isGitHubAction) {
      core.info('📝 Detected GitHub Action project - ensuring dist/ is committed...');
      
      // Add built files that are essential for GitHub Actions
      tryGitAdd('dist/');
      tryGitAdd('coverage/');

      if (resolvePackageJsonMode(inputs) === 'update') {
        tryGitAdd(inputs.packageJsonPath);
      }
      
      // For GitHub Actions, always commit to ensure dist/ is included in releases
      if (!hasStagedChanges()) {
        core.info('No staged changes to commit');
        return false;
      }

      core.info('📝 Committing built files and version changes...');
      execSync(`git commit -m "build: update dist and version for ${newVersion}"`, {
        stdio: 'inherit'
      });
      return true;
    } else {
      // Non-GitHub Action project - use original logic
      const status = execSync('git status --porcelain', { encoding: 'utf8' });
      if (status.trim()) {
        core.info('📝 Committing version changes...');
        execSync('git add .');
        execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });
        return true;
      } else {
        core.info('No changes to commit');
        return false;
      }
    }
  } catch (error) {
    core.info('No changes to commit or commit failed');
    return false;
  }
}

function hasStagedChanges() {
  try {
    execSync('git diff --cached --quiet');
    return false;
  } catch (error) {
    return true;
  }
}

function tryGitAdd(pathspec) {
  try {
    execSync(`git add "${pathspec}"`, { stdio: 'inherit' });
  } catch (error) {
    core.info(`Skipping git add for ${pathspec}: ${error.message}`);
  }
}

async function createAndPushTag(newVersion, options = {}) {
  const { pushBranch = false } = options;
  core.info(`🏷️ Creating and pushing tag: ${newVersion}`);
  
  // Delete existing tag if it exists (locally and remote)
  try {
    execSync(`git tag -d "${newVersion}"`, { stdio: 'pipe' });
    core.info(`Deleted existing local tag: ${newVersion}`);
  } catch (e) {
    // Tag doesn't exist locally, that's fine
  }
  
  try {
    execSync(`git push origin ":refs/tags/${newVersion}"`, { stdio: 'pipe' });
    core.info(`Deleted existing remote tag: ${newVersion}`);
  } catch (e) {
    // Tag doesn't exist remotely, that's fine
  }
  
  // Create new tag
  execSync(`git tag -a "${newVersion}" -m "Release ${newVersion}"`);

  if (pushBranch) {
    execSync('git push origin HEAD');
  } else {
    core.info('Skipping branch push; only pushing the release tag');
  }

  execSync(`git push origin "${newVersion}"`);
}

function generateReleaseNotes(latestVersion, newVersion, inputs) {
  if (!inputs.autoGenerateNotes) {
    return `Release ${newVersion}`;
  }

  core.info('📝 Generating release notes...');
  
  let notes = '## What\'s Changed\n\n';
  
  try {
    let commitRange;
    if (latestVersion === 'v0.0.0') {
      commitRange = 'HEAD';
    } else {
      commitRange = `${latestVersion}..HEAD`;
    }
    
    const commits = execSync(`git log --pretty=format:"- %s (%h)" ${commitRange}`, { encoding: 'utf8' });
    notes += commits;
    
    if (latestVersion !== 'v0.0.0') {
      const repoUrl = `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}`;
      notes += `\n\n**Full Changelog**: ${repoUrl}/compare/${latestVersion}...${newVersion}`;
    }
  } catch (error) {
    core.warning('Failed to generate detailed release notes');
    notes = `Release ${newVersion}`;
  }
  
  return notes;
}

// Only run if this is the main module
if (require.main === module) {
  run();
}

module.exports = { run };
