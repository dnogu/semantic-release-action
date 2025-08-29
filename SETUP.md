# Setup Guide for Publishing Semantic Release Action

## 🚀 Quick Setup Steps

### 1. Create GitHub Repository

1. Go to [GitHub](https://github.com) and create a new repository
2. Name: `semantic-release-action`
3. Description: `Automated semantic versioning and release creation based on PR labels`
4. Make it **Public** (required for GitHub Actions Marketplace)
5. **Don't** initialize with README, .gitignore, or license (we already have them)

### 2. Push Your Code

```bash
# Add your GitHub repository as origin
git remote add origin https://github.com/dnogu/semantic-release-action.git

# Push to GitHub
git push -u origin main
```

### 3. Configure Repository Settings

1. Go to your repository → **Settings** → **General**
2. Under **Features**, enable:
   - ✅ Issues
   - ✅ Wiki
   - ✅ Discussions (optional)

3. Under **Pull Requests**, enable:
   - ✅ Allow merge commits
   - ✅ Allow squash merging
   - ✅ Allow rebase merging
   - ✅ Automatically delete head branches

### 4. Add Repository Topics

Go to **Settings** → **General** → **Topics** and add:
- `github-actions`
- `semantic-versioning`
- `release-automation`
- `ci-cd`
- `versioning`
- `actions`
- `marketplace`

### 5. Create First Release (Self-Release!)

1. Create a new branch: `git checkout -b feat/initial-release`
2. Make a small change (e.g., update README)
3. Commit: `git commit -am "docs: prepare for initial release"`
4. Push: `git push origin feat/initial-release`
5. Create a Pull Request with the label `major`
6. Merge the PR → The action will release itself! 🎉

### 6. Publish to Marketplace

1. Go to your repository on GitHub
2. Click **Releases** (should now have v1.0.0)
3. Click on the v1.0.0 release
4. Click **"Publish this Action to the GitHub Marketplace"**
5. Add marketplace details:
   - **Primary Category**: Continuous Integration
   - **Another Category**: Utilities
   - **Logo**: Choose the "tag" icon
   - **Color**: Blue
6. Review and publish!

## 🎯 What Happens Next

- Your action will be available as `dnogu/semantic-release-action@v1`
- The v1 tag will always point to the latest v1.x.x release
- You can use it in any repository with just a few lines!

## 🔄 Using in Your tofu-init Project

Replace your 224-line workflow with:

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
    steps:
      - uses: dnogu/semantic-release-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          build-command: 'npm run build'
```

## 🎉 Success!

You now have a professional, reusable GitHub Action that can benefit the entire community!
