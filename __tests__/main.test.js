jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  getInput: jest.fn(),
  getBooleanInput: jest.fn()
}));

jest.mock('@actions/github', () => ({
  getOctokit: jest.fn(),
  context: {
    eventName: 'pull_request',
    payload: { pull_request: { merged: true, labels: [] } },
    ref: 'refs/heads/main',
    repo: { owner: 'octocat', repo: 'demo-repo' }
  }
}));

jest.mock('child_process', () => ({
  execSync: jest.fn()
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn()
}));

jest.mock('../src/utils', () => ({
  detectTriggerMode: jest.fn(),
  detectExecutionMode: jest.fn(),
  parseLabels: jest.fn()
}));

jest.mock('../src/version', () => ({
  calculateVersion: jest.fn(),
  updatePackageJson: jest.fn(),
  verifyPackageJsonVersion: jest.fn()
}));

jest.mock('../src/release', () => ({
  createRelease: jest.fn(),
  createMajorRelease: jest.fn()
}));

const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');
const fs = require('fs');
const utils = require('../src/utils');
const version = require('../src/version');
const release = require('../src/release');
const { run } = require('../src/main');

function setupCoreInputs(overrides = {}, booleanOverrides = {}) {
  const stringInputs = {
    'github-token': 'test-token',
    'major-label': 'major',
    'minor-label': 'minor',
    'patch-label': 'patch',
    'prerelease-label': 'prerelease',
    'prerelease-suffix': 'beta',
    'prerelease-number': '1',
    'node-version': '20',
    'package-manager': 'npm',
    'working-directory': '.',
    'install-command': 'npm ci',
    'test-command': 'npm test',
    'build-command': 'npm run build',
    'package-json-mode': 'update',
    'package-json-path': 'package.json',
    'git-user-name': 'github-actions[bot]',
    'git-user-email': 'github-actions[bot]@users.noreply.github.com',
    'trigger-mode': 'auto-detect',
    'execution-mode': 'auto-detect',
    ...overrides
  };

  const booleanInputs = {
    'create-major-release': true,
    'base_release': true,
    'copy-assets': true,
    'auto-generate-notes': true,
    'update-package-json': true,
    'commit-changes': true,
    ...booleanOverrides
  };

  core.getInput.mockImplementation(name => (name in stringInputs ? stringInputs[name] : ''));
  core.getBooleanInput.mockImplementation(name => !!booleanInputs[name]);
}

function setupFs({
  packageJson = true,
  actionYml = false,
  actionYaml = false,
  packageJsonContent = JSON.stringify({ scripts: { test: 'jest', build: 'ncc build src/main.js -o dist' } })
} = {}) {
  fs.existsSync.mockImplementation(filePath => {
    if (filePath === 'package.json') return packageJson;
    if (filePath === 'action.yml') return actionYml;
    if (filePath === 'action.yaml') return actionYaml;
    return false;
  });

  fs.readFileSync.mockReturnValue(packageJsonContent);
}

function setupExecSync({
  latestTags = 'v1.2.3\nv1',
  commits = '- feat: add feature (abc123)',
  throwOnFetch = false,
  stagedChanges = false
} = {}) {
  execSync.mockImplementation(command => {
    if (command === 'git fetch --tags' && throwOnFetch) {
      throw new Error('fetch failed');
    }
    if (command === 'git tag --sort=-version:refname') {
      return latestTags;
    }
    if (command.startsWith('git log --pretty=format:"- %s (%h)"')) {
      return commits;
    }
    if (command === 'git diff --cached --quiet' && stagedChanges) {
      throw new Error('staged changes present');
    }
    if (command === 'git status --porcelain') {
      return '';
    }
    return '';
  });
}

describe('main.run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    github.getOctokit.mockReturnValue({ rest: {} });
    github.context.payload = { pull_request: { merged: true, labels: [] } };
    github.context.ref = 'refs/heads/main';
    github.context.repo = { owner: 'octocat', repo: 'demo-repo' };
    setupCoreInputs();
    setupFs();
    setupExecSync();
    utils.detectExecutionMode.mockReturnValue('release');
  });

  test('skips release when no release labels are resolved', async () => {
    utils.detectTriggerMode.mockReturnValue('pr-merge');
    utils.parseLabels.mockReturnValue({ releaseType: 'none', isPrerelease: false });

    await run();

    expect(core.setOutput).toHaveBeenCalledWith('released', 'false');
    expect(core.setOutput).toHaveBeenCalledWith('release-type', 'none');
    expect(version.calculateVersion).not.toHaveBeenCalled();
    expect(release.createRelease).not.toHaveBeenCalled();
  });

  test('executes full stable release flow and syncs major tag without second release', async () => {
    setupCoreInputs({ 'working-directory': './project-dir' });
    setupFs({ packageJson: true, actionYml: true });

    utils.detectTriggerMode.mockReturnValue('pr-merge');
    utils.parseLabels.mockReturnValue({ releaseType: 'minor', isPrerelease: false });
    version.calculateVersion.mockReturnValue('v1.3.0');
    release.createRelease.mockResolvedValue({
      id: 99,
      html_url: 'https://example.com/releases/v1.3.0',
      name: 'v1.3.0',
      body: 'Release body',
      assets: []
    });
    release.createMajorRelease.mockResolvedValue({ tag: 'v1', version: 'v1.3.0' });

    const chdirSpy = jest.spyOn(process, 'chdir').mockImplementation(() => {});

    await run();

    expect(chdirSpy).toHaveBeenCalledWith('./project-dir');
    expect(version.updatePackageJson).toHaveBeenCalledWith('package.json', 'v1.3.0');
    expect(execSync).toHaveBeenCalledWith('npm ci', { stdio: 'inherit' });
    expect(execSync).toHaveBeenCalledWith('npm test', { stdio: 'inherit' });
    expect(execSync).toHaveBeenCalledWith('npm run build', { stdio: 'inherit' });
    expect(release.createRelease).toHaveBeenCalledWith(
      { rest: {} },
      github.context,
      expect.objectContaining({
        tagName: 'v1.3.0',
        name: 'v1.3.0',
        prerelease: false
      })
    );
    expect(release.createMajorRelease).toHaveBeenCalledWith(
      { rest: {} },
      github.context,
      expect.objectContaining({
        majorVersion: 'v1',
        fullVersion: 'v1.3.0'
      })
    );
    expect(core.setOutput).toHaveBeenCalledWith('released', 'true');
    expect(core.setOutput).toHaveBeenCalledWith('version', 'v1.3.0');
    expect(core.setOutput).toHaveBeenCalledWith('previous-version', 'v1.2.3');
    expect(core.setOutput).toHaveBeenCalledWith('major-version', 'v1');
    expect(core.setOutput).toHaveBeenCalledWith(
      'major-release-url',
      'https://example.com/releases/v1.3.0'
    );

    chdirSpy.mockRestore();
  });

  test('validates planned version for open PRs without creating a release', async () => {
    setupCoreInputs({ 'package-json-mode': 'verify' });

    utils.detectTriggerMode.mockReturnValue('pr-open');
    utils.detectExecutionMode.mockReturnValue('validate');
    utils.parseLabels.mockReturnValue({ releaseType: 'minor', isPrerelease: false });
    version.calculateVersion.mockReturnValue('v1.3.0');

    await run();

    expect(version.verifyPackageJsonVersion).toHaveBeenCalledWith('package.json', 'v1.3.0');
    expect(version.updatePackageJson).not.toHaveBeenCalled();
    expect(release.createRelease).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalledWith('npm ci', { stdio: 'inherit' });
    expect(core.setOutput).toHaveBeenCalledWith('released', 'false');
    expect(core.setOutput).toHaveBeenCalledWith('version', 'v1.3.0');
  });

  test('prepares an open PR by updating package.json, running checks, and pushing the PR branch', async () => {
    setupCoreInputs({
      'package-json-mode': 'update',
      'execution-mode': 'prepare'
    });
    setupFs({ packageJson: true, actionYml: true });
    setupExecSync({ stagedChanges: true });

    github.context.payload.pull_request = {
      merged: false,
      labels: [{ name: 'minor' }],
      head: {
        ref: 'feature/release-prep',
        repo: { full_name: 'octocat/demo-repo' }
      }
    };

    utils.detectTriggerMode.mockReturnValue('pr-open');
    utils.detectExecutionMode.mockReturnValue('prepare');
    utils.parseLabels.mockReturnValue({ releaseType: 'minor', isPrerelease: false });
    version.calculateVersion.mockReturnValue('v1.3.0');

    await run();

    expect(version.updatePackageJson).toHaveBeenCalledWith('package.json', 'v1.3.0');
    expect(version.verifyPackageJsonVersion).not.toHaveBeenCalled();
    expect(execSync).toHaveBeenCalledWith('npm ci', { stdio: 'inherit' });
    expect(execSync).toHaveBeenCalledWith('npm test', { stdio: 'inherit' });
    expect(execSync).toHaveBeenCalledWith('npm run build', { stdio: 'inherit' });
    expect(execSync).toHaveBeenCalledWith(
      'git commit -m "build: update dist and version for v1.3.0"',
      { stdio: 'inherit' }
    );
    expect(execSync).toHaveBeenCalledWith('git fetch origin "feature/release-prep"');
    expect(execSync).toHaveBeenCalledWith('git rebase "origin/feature/release-prep"');
    expect(execSync).toHaveBeenCalledWith('git push origin HEAD:feature/release-prep');
    expect(release.createRelease).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('released', 'false');
    expect(core.setOutput).toHaveBeenCalledWith('version', 'v1.3.0');
  });

  test('retries prepare push once when the PR branch moves during the run', async () => {
    setupCoreInputs({
      'package-json-mode': 'update',
      'execution-mode': 'prepare'
    });
    setupFs({ packageJson: true, actionYml: true });
    setupExecSync({ stagedChanges: true });

    github.context.payload.pull_request = {
      merged: false,
      labels: [{ name: 'minor' }],
      head: {
        ref: 'feature/release-prep',
        repo: { full_name: 'octocat/demo-repo' }
      }
    };

    utils.detectTriggerMode.mockReturnValue('pr-open');
    utils.detectExecutionMode.mockReturnValue('prepare');
    utils.parseLabels.mockReturnValue({ releaseType: 'minor', isPrerelease: false });
    version.calculateVersion.mockReturnValue('v1.3.0');

    const baseExecSync = execSync.getMockImplementation();
    let pushAttempts = 0;
    execSync.mockImplementation(command => {
      if (command === 'git push origin HEAD:feature/release-prep') {
        pushAttempts += 1;
        if (pushAttempts === 1) {
          throw new Error('Updates were rejected because a pushed branch tip is behind its remote counterpart');
        }
      }

      return baseExecSync(command);
    });

    await run();

    expect(core.warning).toHaveBeenCalledWith(
      'Remote PR branch moved while prepare mode was running. Retrying push for feature/release-prep.'
    );
    expect(
      execSync.mock.calls.filter(([command]) => command === 'git fetch origin "feature/release-prep"')
    ).toHaveLength(2);
    expect(
      execSync.mock.calls.filter(([command]) => command === 'git rebase "origin/feature/release-prep"')
    ).toHaveLength(2);
    expect(
      execSync.mock.calls.filter(([command]) => command === 'git push origin HEAD:feature/release-prep')
    ).toHaveLength(2);
  });

  test('can verify package.json and create a tag without pushing the branch', async () => {
    setupCoreInputs(
      { 'package-json-mode': 'verify' },
      { 'commit-changes': false }
    );
    setupFs({ packageJson: true, actionYml: true });

    utils.detectTriggerMode.mockReturnValue('pr-merge');
    utils.detectExecutionMode.mockReturnValue('release');
    utils.parseLabels.mockReturnValue({ releaseType: 'patch', isPrerelease: false });
    version.calculateVersion.mockReturnValue('v1.2.4');
    release.createRelease.mockResolvedValue({
      id: 102,
      html_url: 'https://example.com/releases/v1.2.4'
    });
    release.createMajorRelease.mockResolvedValue(null);

    await run();

    expect(version.verifyPackageJsonVersion).toHaveBeenCalledWith('package.json', 'v1.2.4');
    expect(version.updatePackageJson).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalledWith('git push origin HEAD');
    expect(execSync).toHaveBeenCalledWith('git push origin "v1.2.4"');
  });

  test('does not create major release for prereleases', async () => {
    utils.detectTriggerMode.mockReturnValue('pr-merge');
    utils.parseLabels.mockReturnValue({ releaseType: 'patch', isPrerelease: true });
    version.calculateVersion.mockReturnValue('v1.2.4-beta.1');
    release.createRelease.mockResolvedValue({
      id: 100,
      html_url: 'https://example.com/releases/v1.2.4-beta.1'
    });

    await run();

    expect(release.createRelease).toHaveBeenCalledWith(
      { rest: {} },
      github.context,
      expect.objectContaining({
        tagName: 'v1.2.4-beta.1',
        prerelease: true
      })
    );
    expect(release.createMajorRelease).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('is-prerelease', 'true');
  });

  test('uses plain release notes when auto-generate-notes is disabled', async () => {
    setupCoreInputs({}, { 'auto-generate-notes': false });
    utils.detectTriggerMode.mockReturnValue('pr-merge');
    utils.parseLabels.mockReturnValue({ releaseType: 'patch', isPrerelease: false });
    version.calculateVersion.mockReturnValue('v1.2.4');
    release.createRelease.mockResolvedValue({
      id: 101,
      html_url: 'https://example.com/releases/v1.2.4'
    });
    release.createMajorRelease.mockResolvedValue(null);

    await run();

    expect(release.createRelease).toHaveBeenCalledWith(
      { rest: {} },
      github.context,
      expect.objectContaining({
        body: 'Release v1.2.4'
      })
    );
  });

  test('falls back to v0.0.0 when tag discovery fails', async () => {
    setupExecSync({ throwOnFetch: true });
    utils.detectTriggerMode.mockReturnValue('pr-merge');
    utils.parseLabels.mockReturnValue({ releaseType: 'patch', isPrerelease: false });
    version.calculateVersion.mockReturnValue('v0.0.1');
    release.createRelease.mockResolvedValue({
      id: 1,
      html_url: 'https://example.com/releases/v0.0.1'
    });
    release.createMajorRelease.mockResolvedValue(null);

    await run();

    expect(core.setOutput).toHaveBeenCalledWith('previous-version', 'v0.0.0');
    expect(release.createRelease).toHaveBeenCalledWith(
      { rest: {} },
      github.context,
      expect.objectContaining({
        body: expect.not.stringContaining('Full Changelog')
      })
    );
  });

  test('auto-detects install, test and build commands from package.json scripts', async () => {
    setupCoreInputs({
      'install-command': '',
      'test-command': '',
      'build-command': ''
    });
    setupFs({
      packageJson: true,
      actionYml: false,
      packageJsonContent: JSON.stringify({
        scripts: {
          test: 'jest --coverage',
          build: 'ncc build src/main.js -o dist'
        }
      })
    });

    utils.detectTriggerMode.mockReturnValue('pr-merge');
    utils.parseLabels.mockReturnValue({ releaseType: 'patch', isPrerelease: false });
    version.calculateVersion.mockReturnValue('v1.2.4');
    release.createRelease.mockResolvedValue({
      id: 3,
      html_url: 'https://example.com/releases/v1.2.4'
    });
    release.createMajorRelease.mockResolvedValue(null);

    await run();

    expect(execSync).toHaveBeenCalledWith('npm ci', { stdio: 'inherit' });
    expect(execSync).toHaveBeenCalledWith('npm test', { stdio: 'inherit' });
    expect(execSync).toHaveBeenCalledWith('npm run build', { stdio: 'inherit' });
  });

  test('marks action failed when an error bubbles up', async () => {
    utils.detectTriggerMode.mockReturnValue('pr-merge');
    utils.parseLabels.mockReturnValue({ releaseType: 'major', isPrerelease: false });
    version.calculateVersion.mockImplementation(() => {
      throw new Error('invalid release type');
    });

    await run();

    expect(core.error).toHaveBeenCalledWith('❌ Action failed: invalid release type');
    expect(core.setFailed).toHaveBeenCalledWith('invalid release type');
  });
});
