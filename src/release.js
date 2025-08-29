const core = require('@actions/core');
const { execSync } = require('child_process');
const { sleep } = require('./utils');

async function createRelease(octokit, context, options) {
  const { tagName, name, body, prerelease = false } = options;
  
  try {
    core.info(`Creating release: ${name}`);
    
    const release = await octokit.rest.repos.createRelease({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tag_name: tagName,
      name: name,
      body: body,
      draft: false,
      prerelease: prerelease
    });
    
    return release.data;
  } catch (error) {
    core.error(`Failed to create release: ${error.message}`);
    throw error;
  }
}

async function createMajorRelease(octokit, context, options) {
  const { majorVersion, fullVersion, originalRelease, copyAssets } = options;
  
  try {
    core.info(`Creating major version release: ${majorVersion}`);
    
    // Update major version tag
    await updateMajorVersionTag(majorVersion, fullVersion);
    
    // Check if major release already exists and delete it
    await deleteMajorReleaseIfExists(octokit, context, majorVersion);
    
    // Create release notes for major version
    const releaseNotes = createMajorReleaseNotes(majorVersion, fullVersion, originalRelease);
    
    // Create the major version release
    const majorRelease = await octokit.rest.repos.createRelease({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tag_name: majorVersion,
      name: majorVersion,
      body: releaseNotes,
      draft: false,
      prerelease: false
    });
    
    // Copy assets if requested
    if (copyAssets && originalRelease) {
      await copyReleaseAssets(octokit, context, originalRelease, majorRelease.data);
    }
    
    return majorRelease.data;
  } catch (error) {
    core.warning(`Failed to create major version release: ${error.message}`);
    return null;
  }
}

async function updateMajorVersionTag(majorVersion, fullVersion) {
  try {
    core.info(`Updating major version tag ${majorVersion} to point to ${fullVersion}`);
    
    // Delete existing major version tag if it exists (locally and remote)
    try {
      execSync(`git tag -d "${majorVersion}"`, { stdio: 'pipe' });
    } catch (e) {
      // Tag doesn't exist locally, that's fine
    }
    
    try {
      execSync(`git push origin ":refs/tags/${majorVersion}"`, { stdio: 'pipe' });
    } catch (e) {
      // Tag doesn't exist remotely, that's fine
    }
    
    // Create new major version tag pointing to the full version
    execSync(`git tag -a "${majorVersion}" -m "Major version tag pointing to ${fullVersion}"`);
    execSync(`git push origin "${majorVersion}"`);
    
    core.info(`✅ Updated major version tag: ${majorVersion} → ${fullVersion}`);
  } catch (error) {
    core.warning(`Failed to update major version tag: ${error.message}`);
    throw error;
  }
}

async function deleteMajorReleaseIfExists(octokit, context, majorVersion) {
  try {
    // Check if release exists
    const existingRelease = await octokit.rest.repos.getReleaseByTag({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tag: majorVersion
    });
    
    if (existingRelease.data) {
      core.info(`Deleting existing major release: ${majorVersion}`);
      await octokit.rest.repos.deleteRelease({
        owner: context.repo.owner,
        repo: context.repo.repo,
        release_id: existingRelease.data.id
      });
    }
  } catch (error) {
    if (error.status === 404) {
      // Release doesn't exist, that's fine
      core.info(`Major release ${majorVersion} doesn't exist, creating new one`);
    } else {
      core.warning(`Error checking for existing major release: ${error.message}`);
    }
  }
}

function createMajorReleaseNotes(majorVersion, fullVersion, originalRelease) {
  const notes = `# ${majorVersion}

This major version tag points to the latest stable release: **${fullVersion}**

## Latest Release: ${originalRelease.name}

${originalRelease.body}

---
*This is an automatically generated major version release that tracks the latest stable release in the ${majorVersion}.x series.*`;

  return notes;
}

async function copyReleaseAssets(octokit, context, sourceRelease, targetRelease) {
  try {
    if (!sourceRelease.assets || sourceRelease.assets.length === 0) {
      core.info('No assets to copy from source release');
      return;
    }
    
    core.info(`Copying ${sourceRelease.assets.length} assets to major release`);
    
    for (const asset of sourceRelease.assets) {
      try {
        // Download asset
        const assetData = await octokit.rest.repos.getReleaseAsset({
          owner: context.repo.owner,
          repo: context.repo.repo,
          asset_id: asset.id,
          headers: {
            accept: 'application/octet-stream'
          }
        });
        
        // Upload to target release
        await octokit.rest.repos.uploadReleaseAsset({
          owner: context.repo.owner,
          repo: context.repo.repo,
          release_id: targetRelease.id,
          name: asset.name,
          data: assetData.data,
          headers: {
            'content-type': asset.content_type,
            'content-length': asset.size
          }
        });
        
        core.info(`✅ Copied asset: ${asset.name}`);
      } catch (error) {
        core.warning(`Failed to copy asset ${asset.name}: ${error.message}`);
      }
    }
  } catch (error) {
    core.warning(`Failed to copy release assets: ${error.message}`);
  }
}

async function getReleaseByTag(octokit, context, tag) {
  try {
    const response = await octokit.rest.repos.getReleaseByTag({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tag: tag
    });
    return response.data;
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function updateRelease(octokit, context, releaseId, options) {
  const { name, body, prerelease } = options;
  
  try {
    const response = await octokit.rest.repos.updateRelease({
      owner: context.repo.owner,
      repo: context.repo.repo,
      release_id: releaseId,
      name: name,
      body: body,
      prerelease: prerelease
    });
    
    return response.data;
  } catch (error) {
    core.error(`Failed to update release: ${error.message}`);
    throw error;
  }
}

module.exports = {
  createRelease,
  createMajorRelease,
  updateMajorVersionTag,
  deleteMajorReleaseIfExists,
  createMajorReleaseNotes,
  copyReleaseAssets,
  getReleaseByTag,
  updateRelease
};
