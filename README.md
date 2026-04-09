# Semantic Release Action 🚀

A powerful GitHub Action that automates semantic versioning and release creation based on PR labels. No more manual version bumps or release notes!

## ✨ Features

- 🏷️ **Label-based releases** - Control versions with simple PR labels
- 📦 **Semantic versioning** - Automatic major/minor/patch version calculation
- 🔒 **Protected-branch friendly** - Validate `package.json` in PRs and release on merge without pushing back to `main`
- 🔀 **Optional PR preparation** - Update `package.json`, run checks, and push generated changes back to the PR branch before merge
- 🚀 **Prerelease support** - Create beta/alpha/rc releases
- 🔄 **Major version tracking** - Automatic v1, v2, etc. release management
- 📝 **Auto-generated notes** - Release notes from commit history
- 🛠️ **Multi-language support** - Works with Node.js, Python, Go, and more
- ⚡ **Zero configuration** - Works out of the box with sensible defaults

## 🎯 Quick Start

### 1. Basic Setup

Create `.github/workflows/release.yml`:

```yaml
name: Release
on:
  pull_request:
    types: [closed]
    branches: [main]

jobs:
  release:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: dnogu/semantic-release-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### 2. With Base Release (Recommended)

For actions that need major version tags (`v1`, `v2`, etc.):

```yaml
name: Release
on:
  pull_request:
    types: [closed]
    branches: [main]

jobs:
  release:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: dnogu/semantic-release-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          base_release: true
```

### 3. Add Labels to Your PR

- `major` - Breaking changes (1.0.0 → 2.0.0)
- `minor` - New features (1.0.0 → 1.1.0)
- `patch` - Bug fixes (1.0.0 → 1.0.1)
- `prerelease` - Beta versions (1.0.0 → 1.1.0-beta.1)

### 4. Merge and Release! 🎉

When you merge a PR with labels, the action automatically:
- Calculates the new version
- Updates `package.json` if configured to do so
- Runs tests and builds your project
- Creates a git tag and GitHub release
- Generates release notes from commits
- With `base_release: true`, updates major version tags (`v1`, `v2`, etc.) to the latest release without creating a second major-tag release entry

## 🔒 Protected Branches

If `main` is protected, the safest pattern is:

1. Validate the expected version on every PR.
2. Require `package.json` to already contain that version before merge.
3. Create the tag and GitHub release after merge without pushing a new commit back to `main`.

This avoids branch-protection conflicts and prevents accidental double bumps. The version is always recalculated from the latest real tag plus the current PR labels, so changing labels ten times on the same PR does not increment ten times.

### PR Validation Workflow

If you want a read-only PR check that calculates the planned version without changing the branch, use explicit `validate` mode.

```yaml
name: Version Check
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]
    branches: [main]

jobs:
  version-check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: dnogu/semantic-release-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          execution-mode: validate
          package-json-mode: verify
```

### Merge Release Workflow

```yaml
name: Release
on:
  pull_request:
    types: [closed]
    branches: [main]

jobs:
  release:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: dnogu/semantic-release-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          execution-mode: release
          package-json-mode: verify
          commit-changes: false
          base_release: true
```

With this setup, the merged `package.json` version must already match the tag that gets created by the release job.

### PR Preparation Workflow

For same-repository pull requests, `execution-mode: auto-detect` now defaults to `prepare`. This mode updates files, runs install/test/build, commits the results, and pushes them back to the PR branch without creating a tag or release. Fork PRs automatically fall back to `validate` because the action cannot push back to fork branches.

```yaml
name: Prepare Release PR
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]
    branches: [main]

jobs:
  prepare:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.ref }}
          fetch-depth: 0

      - uses: dnogu/semantic-release-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          execution-mode: prepare
          package-json-mode: update
          commit-changes: true
```

This workflow is intended for same-repository PR branches. Fork PRs cannot be pushed back to by the action.

## 📚 Full Configuration

```yaml
- uses: dnogu/semantic-release-action@v1
  with:
    # Required
    github-token: ${{ secrets.GITHUB_TOKEN }}

    # Version labels (customize as needed)
    major-label: 'major'
    minor-label: 'minor'
    patch-label: 'patch'
    prerelease-label: 'prerelease'

    # Prerelease configuration
    prerelease-suffix: 'beta'  # beta, alpha, rc
    prerelease-number: '1'

    # Build configuration
    node-version: '24'
    package-manager: 'npm'  # npm, yarn, pnpm
    working-directory: '.'

    # Custom commands (auto-detected if not specified)
    install-command: 'npm ci'
    test-command: 'npm test'
    build-command: 'npm run build'

    # Release options
    create-major-release: true  # Create full version releases (v1.2.3)
    base_release: true          # Update major version tags (v1, v2, etc.) to point to the latest stable release
    copy-assets: true
    auto-generate-notes: true

    # Package.json handling
    update-package-json: true      # legacy toggle
    package-json-mode: 'update'    # update, verify, ignore
    package-json-path: 'package.json'

    # Git configuration
    git-user-name: 'github-actions[bot]'
    git-user-email: 'github-actions[bot]@users.noreply.github.com'

    # Release execution
    commit-changes: true           # also controls branch commits in prepare mode
    execution-mode: 'auto-detect'  # prepare for same-repo PRs, validate for fork PRs, release after merge
```

## 📤 Outputs

The action provides useful outputs for downstream jobs:

```yaml
- uses: dnogu/semantic-release-action@v1
  id: release
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Use release info
  run: |
    echo "Released: ${{ steps.release.outputs.released }}"
    echo "Version: ${{ steps.release.outputs.version }}"
    echo "Release URL: ${{ steps.release.outputs.release-url }}"
```

### Available Outputs

| Output | Description | Example |
|--------|-------------|---------|
| `released` | Whether a release was created | `true` |
| `version` | The new version number | `v1.2.3` |
| `previous-version` | The previous version | `v1.2.2` |
| `release-type` | Type of release | `minor` |
| `is-prerelease` | Whether this is a prerelease | `false` |
| `release-url` | URL of the created release | `https://github.com/...` |
| `release-id` | ID of the created release | `12345` |
| `major-version` | Major version tag | `v1` |
| `major-release-url` | URL of the release currently targeted by the major version tag | `https://github.com/...` |
| `tag-name` | Git tag that was created | `v1.2.3` |

## 🎭 Usage Scenarios

### Scenario 1: Node.js Project

```yaml
- uses: dnogu/semantic-release-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    package-manager: 'npm'
    build-command: 'npm run build'
```

### Scenario 2: Python Project

```yaml
- uses: dnogu/semantic-release-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    package-json-mode: ignore
    test-command: 'python -m pytest'
    build-command: 'python setup.py build'
```

### Scenario 3: Custom Labels

```yaml
- uses: dnogu/semantic-release-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    major-label: 'breaking'
    minor-label: 'feature'
    patch-label: 'bugfix'
    prerelease-label: 'beta'
```

### Scenario 4: Manual Releases

```yaml
name: Manual Release
on:
  workflow_dispatch:
    inputs:
      release-type:
        type: choice
        options: [major, minor, patch]
      is-prerelease:
        type: boolean

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: dnogu/semantic-release-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          release-type: ${{ github.event.inputs.release-type }}
          is-prerelease: ${{ github.event.inputs.is-prerelease }}
```

### Scenario 5: Protected Branches

```yaml
- uses: dnogu/semantic-release-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    execution-mode: release
    package-json-mode: verify
    commit-changes: false
```

### Scenario 6: PR Preparation

```yaml
- uses: dnogu/semantic-release-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    execution-mode: prepare
    package-json-mode: update
    commit-changes: true
```

## 🔧 Advanced Features

### Major Version Tags

The action automatically creates and maintains major version tags:

- When you release `v1.2.3`, it updates `v1` to point at that release commit
- Any existing `v1` release entry is removed so there is no duplicate major-tag release
- Great for action consumers who want `uses: your-action@v1`
- Prerelease versions don't update major version tags

### Smart Command Detection

The action intelligently detects your project type and commands:

- **Package Manager**: Detects from lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`)
- **Test Command**: Looks for a `test` script in `package.json`
- **Build Command**: Looks for a `build` script in `package.json`

### Error Handling

- ✅ Graceful failure if no labels found
- ✅ Detailed logging for debugging
- ✅ Validates version format and git state
- ✅ Warns instead of failing when `package.json` verification is requested but no `package.json` exists

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

Inspired by the need for simple, powerful release automation in the GitHub Actions ecosystem.

---

**Made by [dnogu](https://github.com/dnogu)**

*If this action helped you, please consider giving it a ⭐ star!*
