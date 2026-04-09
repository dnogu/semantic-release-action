const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');
const fs = require('fs');

const { detectTriggerMode, detectExecutionMode, parseLabels } = require('./utils');
const { calculateVersion, updatePackageJson, verifyPackageJsonVersion } = require('./version');
const { createRelease, createMajorRelease } = require('./release');

async function run() {
  try {
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

    const octokit = github.getOctokit(inputs.githubToken);
    const context = github.context;

    core.info('🚀 Starting Semantic Release Action...');

    if (inputs.workingDirectory !== '.') {
      process.chdir(inputs.workingDirectory);
      core.info(`📁 Changed working directory to: ${inputs.workingDirectory}`);
    }

    const triggerMode = detectTriggerMode(inputs.triggerMode, context);
    core.info(`🔍 Detected trigger mode: ${triggerMode}`);

    const executionMode = detectExecutionMode(inputs.executionMode, triggerMode, context);
    core.info(`🧭 Execution mode: ${executionMode}`);

    const { releaseType, isPrerelease } = parseLabels(context, inputs, triggerMode);

    if (releaseType === 'none') {
      core.info('ℹ️ No release labels found. Skipping release creation.');
      core.setOutput('released', 'false');
      core.setOutput('release-type', 'none');
      return;
    }

    core.info(`📦 Release type: ${releaseType}${isPrerelease ? ' (prerelease)' : ''}`);

    const latestVersion = getLatestVersion();
    core.info(`🏷️ Latest version: ${latestVersion}`);

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
      core.info('🧪 Validation mode enabled. Skipping build, branch push, tag, and release creation.');
      return;
    }

    if (executionMode === 'prepare') {
      await preparePullRequestRelease(context, inputs, newVersion);
      core.info('✅ Pull request release preparation completed');
      return;
    }

    await createFinalRelease(octokit, context, inputs, latestVersion, newVersion, releaseType, isPrerelease);
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

async function preparePullRequestRelease(context, inputs, newVersion) {
  core.info('🛠️ Prepare mode enabled. Running install, test, and build without creating a tag or release.');

  await setupNodeAndDependencies(inputs);
  await runTests(inputs);
  await runBuild(inputs);

  if (!inputs.commitChanges) {
    core.info('📝 Skipping commit step because commit-changes is disabled');
    return;
  }

  configureGit(inputs);

  const committed = await commitChanges(newVersion, inputs);
  if (committed) {
    await pushBranchChanges(context);
  } else {
    core.info('No branch changes to push after PR preparation');
  }
}

async function createFinalRelease(octokit, context, inputs, latestVersion, newVersion, releaseType, isPrerelease) {
  await setupNodeAndDependencies(inputs);
  await runTests(inputs);
  await runBuild(inputs);

  configureGit(inputs);

  let shouldPushBranch = false;
  if (inputs.commitChanges) {
    shouldPushBranch = await commitChanges(newVersion, inputs);
  } else {
    core.info('📝 Skipping commit step because commit-changes is disabled');
  }

  await createAndPushTag(newVersion, { pushBranch: shouldPushBranch });

  const releaseNotes = generateReleaseNotes(latestVersion, newVersion, inputs);

  const release = await createRelease(octokit, context, {
    tagName: newVersion,
    name: newVersion,
    body: releaseNotes,
    prerelease: isPrerelease
  });

  core.info(`✅ Created release: ${release.html_url}`);

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

  if (inputs.baseRelease && !isPrerelease) {
    const majorVersion = newVersion.split('.')[0];

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
}

function getLatestVersion() {
  try {
    execSync('git fetch --tags', { stdio: 'pipe' });

    const allTags = execSync('git tag --sort=-version:refname', { encoding: 'utf8' }).trim();
    if (allTags) {
      const tags = allTags.split('\n');
      const semverTags = tags.filter(tag => /^v\d+\.\d+\.\d+/.test(tag));
      if (semverTags.length > 0) {
        return semverTags[0];
      }
    }

    try {
      const latestTag = execSync('git describe --tags --abbrev=0 --match="v*.*.*"', { encoding: 'utf8' }).trim();
      return latestTag;
    } catch (error) {
      // No semantic version tags found.
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

  let installCmd = inputs.installCommand;
  if (!installCmd) {
    const commands = {
      npm: 'npm ci',
      yarn: 'yarn install --frozen-lockfile',
      pnpm: 'pnpm install --frozen-lockfile'
    };
    installCmd = commands[inputs.packageManager] || 'npm ci';
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

  if (!testCmd && fs.existsSync('package.json')) {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (pkg.scripts && pkg.scripts.test) {
      testCmd = `${inputs.packageManager} test`;
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

  if (!buildCmd && fs.existsSync('package.json')) {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (pkg.scripts && pkg.scripts.build) {
      buildCmd = `${inputs.packageManager} run build`;
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
    const isGitHubAction = fs.existsSync('action.yml') || fs.existsSync('action.yaml');

    if (isGitHubAction) {
      core.info('📝 Detected GitHub Action project - ensuring dist/ is committed...');

      tryGitAdd('dist/');
      tryGitAdd('coverage/');

      if (resolvePackageJsonMode(inputs) === 'update') {
        tryGitAdd(inputs.packageJsonPath);
      }

      if (!hasStagedChanges()) {
        core.info('No staged changes to commit');
        return false;
      }

      core.info('📝 Committing built files and version changes...');
      execSync(`git commit -m "build: update dist and version for ${newVersion}"`, {
        stdio: 'inherit'
      });
      return true;
    }

    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (status.trim()) {
      core.info('📝 Committing version changes...');
      execSync('git add .');
      execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });
      return true;
    }

    core.info('No changes to commit');
    return false;
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

async function pushBranchChanges(context) {
  const headRepo = context.payload.pull_request?.head?.repo?.full_name;
  const baseRepo = `${context.repo.owner}/${context.repo.repo}`;
  const headRef = context.payload.pull_request?.head?.ref;

  if (!headRef) {
    throw new Error('Unable to determine the pull request branch to push changes back to');
  }

  if (headRepo && headRepo !== baseRepo) {
    throw new Error('Cannot push preparation changes to a pull request from a fork');
  }

  core.info(`⬆️ Pushing preparation changes back to PR branch: ${headRef}`);
  execSync(`git push origin HEAD:${headRef}`);
}

async function createAndPushTag(newVersion, options = {}) {
  const { pushBranch = false } = options;
  core.info(`🏷️ Creating and pushing tag: ${newVersion}`);

  try {
    execSync(`git tag -d "${newVersion}"`, { stdio: 'pipe' });
    core.info(`Deleted existing local tag: ${newVersion}`);
  } catch (error) {
    // Tag doesn't exist locally.
  }

  try {
    execSync(`git push origin ":refs/tags/${newVersion}"`, { stdio: 'pipe' });
    core.info(`Deleted existing remote tag: ${newVersion}`);
  } catch (error) {
    // Tag doesn't exist remotely.
  }

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
    const commitRange = latestVersion === 'v0.0.0' ? 'HEAD' : `${latestVersion}..HEAD`;
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

if (require.main === module) {
  run();
}

module.exports = { run };
