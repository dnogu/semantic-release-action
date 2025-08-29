const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { detectTriggerMode, parseLabels } = require('./utils');
const { calculateVersion, updatePackageJson } = require('./version');
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
      copyAssets: core.getBooleanInput('copy-assets'),
      autoGenerateNotes: core.getBooleanInput('auto-generate-notes'),
      updatePackageJson: core.getBooleanInput('update-package-json'),
      packageJsonPath: core.getInput('package-json-path'),
      gitUserName: core.getInput('git-user-name'),
      gitUserEmail: core.getInput('git-user-email'),
      triggerMode: core.getInput('trigger-mode')
    };

    // Initialize GitHub client
    const octokit = github.getRestClient(inputs.githubToken);
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

    // Update package.json if requested
    if (inputs.updatePackageJson) {
      updatePackageJson(inputs.packageJsonPath, newVersion);
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
    await commitChanges(newVersion, inputs);

    // Create and push tag
    await createAndPushTag(newVersion);

    // Generate release notes
    const releaseNotes = generateReleaseNotes(latestVersion, newVersion, inputs);

    // Create GitHub release
    const release = await createRelease(octokit, context, {
      tagName: newVersion,
      name: `Release ${newVersion}`,
      body: releaseNotes,
      prerelease: isPrerelease
    });

    core.info(`✅ Created release: ${release.html_url}`);

    // Set outputs
    core.setOutput('released', 'true');
    core.setOutput('version', newVersion);
    core.setOutput('previous-version', latestVersion);
    core.setOutput('release-type', releaseType);
    core.setOutput('is-prerelease', isPrerelease.toString());
    core.setOutput('release-url', release.html_url);
    core.setOutput('release-id', release.id.toString());
    core.setOutput('tag-name', newVersion);

    // Create major version release if requested and not a prerelease
    if (inputs.createMajorRelease && !isPrerelease) {
      const majorVersion = newVersion.split('.')[0]; // e.g., 'v1' from 'v1.2.3'
      
      const majorRelease = await createMajorRelease(octokit, context, {
        majorVersion,
        fullVersion: newVersion,
        originalRelease: release,
        copyAssets: inputs.copyAssets
      });

      if (majorRelease) {
        core.info(`✅ Created major version release: ${majorRelease.html_url}`);
        core.setOutput('major-version', majorVersion);
        core.setOutput('major-release-url', majorRelease.html_url);
      }
    }

    core.info('🎉 Semantic release completed successfully!');

  } catch (error) {
    core.error(`❌ Action failed: ${error.message}`);
    core.setFailed(error.message);
  }
}

function getLatestVersion() {
  try {
    const latestTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
    return latestTag;
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
    // Check if there are any changes to commit
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (status.trim()) {
      core.info('📝 Committing version changes...');
      execSync('git add .');
      execSync(`git commit -m "chore: bump version to ${newVersion}"`);
    } else {
      core.info('No changes to commit');
    }
  } catch (error) {
    core.info('No changes to commit or commit failed');
  }
}

async function createAndPushTag(newVersion) {
  core.info(`🏷️ Creating and pushing tag: ${newVersion}`);
  execSync(`git tag -a "${newVersion}" -m "Release ${newVersion}"`);
  execSync(`git push origin HEAD`);
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
