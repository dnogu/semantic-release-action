jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
}));

jest.mock('child_process', () => ({
  execSync: jest.fn()
}));

const core = require('@actions/core');
const { execSync } = require('child_process');
const {
  createRelease,
  createMajorRelease,
  updateMajorVersionTag,
  deleteMajorReleaseIfExists,
  createMajorReleaseNotes,
  copyReleaseAssets,
  getReleaseByTag,
  updateRelease
} = require('../src/release');

describe('release', () => {
  const context = {
    repo: {
      owner: 'octocat',
      repo: 'demo-repo'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createRelease', () => {
    test('creates a release and returns response data', async () => {
      const octokit = {
        rest: {
          repos: {
            createRelease: jest.fn().mockResolvedValue({
              data: { id: 42, html_url: 'https://example.com/release/42' }
            })
          }
        }
      };

      const release = await createRelease(octokit, context, {
        tagName: 'v1.2.3',
        name: 'v1.2.3',
        body: 'notes',
        prerelease: false
      });

      expect(octokit.rest.repos.createRelease).toHaveBeenCalledWith({
        owner: 'octocat',
        repo: 'demo-repo',
        tag_name: 'v1.2.3',
        name: 'v1.2.3',
        body: 'notes',
        draft: false,
        prerelease: false
      });
      expect(release).toEqual({ id: 42, html_url: 'https://example.com/release/42' });
    });

    test('logs and rethrows create release errors', async () => {
      const octokit = {
        rest: {
          repos: {
            createRelease: jest.fn().mockRejectedValue(new Error('API unavailable'))
          }
        }
      };

      await expect(
        createRelease(octokit, context, {
          tagName: 'v1.2.3',
          name: 'v1.2.3',
          body: 'notes'
        })
      ).rejects.toThrow('API unavailable');

      expect(core.error).toHaveBeenCalledWith('Failed to create release: API unavailable');
    });
  });

  describe('createMajorRelease', () => {
    test('updates major tag and removes old major release if present', async () => {
      const octokit = {
        rest: {
          repos: {
            getReleaseByTag: jest.fn().mockResolvedValue({ data: { id: 222 } }),
            deleteRelease: jest.fn().mockResolvedValue({})
          }
        }
      };

      const result = await createMajorRelease(octokit, context, {
        majorVersion: 'v1',
        fullVersion: 'v1.2.3',
        originalRelease: { name: 'v1.2.3', body: 'Original notes', assets: [] },
        copyAssets: true
      });

      expect(execSync).toHaveBeenCalledWith('git tag -a "v1" -m "Major version tag pointing to v1.2.3"');
      expect(execSync).toHaveBeenCalledWith('git push origin "v1"');
      expect(octokit.rest.repos.deleteRelease).toHaveBeenCalledWith({
        owner: 'octocat',
        repo: 'demo-repo',
        release_id: 222
      });
      expect(result).toEqual({ tag: 'v1', version: 'v1.2.3' });
    });

    test('returns success when no major release exists yet', async () => {
      const octokit = {
        rest: {
          repos: {
            getReleaseByTag: jest.fn().mockRejectedValue({ status: 404 }),
            deleteRelease: jest.fn()
          }
        }
      };

      const result = await createMajorRelease(octokit, context, {
        majorVersion: 'v2',
        fullVersion: 'v2.0.0',
        originalRelease: { name: 'v2.0.0', body: 'notes', assets: [] },
        copyAssets: false
      });

      expect(octokit.rest.repos.deleteRelease).not.toHaveBeenCalled();
      expect(result).toEqual({ tag: 'v2', version: 'v2.0.0' });
    });

    test('returns null when major release flow fails', async () => {
      execSync.mockImplementation((command) => {
        if (command.startsWith('git tag -a')) {
          throw new Error('Cannot create tag');
        }
        return '';
      });

      const octokit = {
        rest: {
          repos: {
            createRelease: jest.fn()
          }
        }
      };

      const result = await createMajorRelease(octokit, context, {
        majorVersion: 'v3',
        fullVersion: 'v3.0.0',
        originalRelease: { name: 'v3.0.0', body: 'notes', assets: [] },
        copyAssets: false
      });

      expect(result).toBeNull();
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to sync major version tag: Cannot create tag')
      );
    });
  });

  describe('updateMajorVersionTag', () => {
    test('handles missing old tags and pushes new major tag', async () => {
      execSync.mockImplementation((command) => {
        if (command.startsWith('git tag -d')) {
          throw new Error('local tag missing');
        }
        if (command.startsWith('git push origin ":refs/tags/')) {
          throw new Error('remote tag missing');
        }
        return '';
      });

      await expect(updateMajorVersionTag('v1', 'v1.2.3')).resolves.toBeUndefined();

      expect(execSync).toHaveBeenCalledWith('git tag -a "v1" -m "Major version tag pointing to v1.2.3"');
      expect(execSync).toHaveBeenCalledWith('git push origin "v1"');
    });

    test('throws when creating new major tag fails', async () => {
      execSync.mockImplementation((command) => {
        if (command.startsWith('git tag -a')) {
          throw new Error('tag creation failed');
        }
        return '';
      });

      await expect(updateMajorVersionTag('v9', 'v9.0.0')).rejects.toThrow('tag creation failed');
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update major version tag: tag creation failed')
      );
    });
  });

  describe('deleteMajorReleaseIfExists', () => {
    test('deletes existing major release', async () => {
      const octokit = {
        rest: {
          repos: {
            getReleaseByTag: jest.fn().mockResolvedValue({ data: { id: 321 } }),
            deleteRelease: jest.fn().mockResolvedValue({})
          }
        }
      };

      await deleteMajorReleaseIfExists(octokit, context, 'v1');

      expect(octokit.rest.repos.deleteRelease).toHaveBeenCalledWith({
        owner: 'octocat',
        repo: 'demo-repo',
        release_id: 321
      });
    });

    test('logs info when major release does not exist', async () => {
      const octokit = {
        rest: {
          repos: {
            getReleaseByTag: jest.fn().mockRejectedValue({ status: 404 })
          }
        }
      };

      await deleteMajorReleaseIfExists(octokit, context, 'v1');

      expect(core.info).toHaveBeenCalledWith("Major release v1 doesn't exist, nothing to delete");
    });

    test('logs warning on non-404 errors', async () => {
      const octokit = {
        rest: {
          repos: {
            getReleaseByTag: jest.fn().mockRejectedValue({ status: 500, message: 'Internal API error' })
          }
        }
      };

      await deleteMajorReleaseIfExists(octokit, context, 'v1');

      expect(core.warning).toHaveBeenCalledWith(
        'Error checking for existing major release: Internal API error'
      );
    });
  });

  describe('createMajorReleaseNotes', () => {
    test('builds a major release note body from original release', () => {
      const notes = createMajorReleaseNotes('v4', 'v4.5.6', {
        name: 'v4.5.6',
        body: 'Original release notes'
      });

      expect(notes).toContain('# v4');
      expect(notes).toContain('**v4.5.6**');
      expect(notes).toContain('## Latest Release: v4.5.6');
      expect(notes).toContain('Original release notes');
    });
  });

  describe('copyReleaseAssets', () => {
    test('returns early when there are no assets', async () => {
      const octokit = {
        rest: { repos: {} }
      };

      await copyReleaseAssets(
        octokit,
        context,
        { assets: [] },
        { id: 100 }
      );

      expect(core.info).toHaveBeenCalledWith('No assets to copy from source release');
    });

    test('copies assets and continues when one asset fails', async () => {
      const octokit = {
        rest: {
          repos: {
            getReleaseAsset: jest
              .fn()
              .mockResolvedValueOnce({ data: Buffer.from('asset1') })
              .mockRejectedValueOnce(new Error('download failed')),
            uploadReleaseAsset: jest.fn().mockResolvedValue({})
          }
        }
      };

      const sourceRelease = {
        assets: [
          { id: 1, name: 'ok.txt', content_type: 'text/plain', size: 3 },
          { id: 2, name: 'broken.txt', content_type: 'text/plain', size: 5 }
        ]
      };

      await copyReleaseAssets(octokit, context, sourceRelease, { id: 77 });

      expect(octokit.rest.repos.uploadReleaseAsset).toHaveBeenCalledTimes(1);
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to copy asset broken.txt: download failed')
      );
    });

    test('logs warning on top-level copy errors', async () => {
      const octokit = { rest: { repos: {} } };
      await copyReleaseAssets(octokit, context, null, { id: 1 });

      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to copy release assets:'));
    });
  });

  describe('getReleaseByTag', () => {
    test('returns release data when found', async () => {
      const octokit = {
        rest: {
          repos: {
            getReleaseByTag: jest.fn().mockResolvedValue({ data: { id: 1, tag_name: 'v1.0.0' } })
          }
        }
      };

      await expect(getReleaseByTag(octokit, context, 'v1.0.0')).resolves.toEqual({
        id: 1,
        tag_name: 'v1.0.0'
      });
    });

    test('returns null when release is not found', async () => {
      const octokit = {
        rest: {
          repos: {
            getReleaseByTag: jest.fn().mockRejectedValue({ status: 404 })
          }
        }
      };

      await expect(getReleaseByTag(octokit, context, 'v1.0.0')).resolves.toBeNull();
    });

    test('rethrows non-404 errors', async () => {
      const octokit = {
        rest: {
          repos: {
            getReleaseByTag: jest.fn().mockRejectedValue(new Error('network down'))
          }
        }
      };

      await expect(getReleaseByTag(octokit, context, 'v1.0.0')).rejects.toThrow('network down');
    });
  });

  describe('updateRelease', () => {
    test('updates release and returns response data', async () => {
      const octokit = {
        rest: {
          repos: {
            updateRelease: jest.fn().mockResolvedValue({ data: { id: 2, name: 'v1' } })
          }
        }
      };

      const updated = await updateRelease(octokit, context, 2, {
        name: 'v1',
        body: 'updated',
        prerelease: false
      });

      expect(octokit.rest.repos.updateRelease).toHaveBeenCalledWith({
        owner: 'octocat',
        repo: 'demo-repo',
        release_id: 2,
        name: 'v1',
        body: 'updated',
        prerelease: false
      });
      expect(updated).toEqual({ id: 2, name: 'v1' });
    });

    test('logs and rethrows update errors', async () => {
      const octokit = {
        rest: {
          repos: {
            updateRelease: jest.fn().mockRejectedValue(new Error('cannot update'))
          }
        }
      };

      await expect(
        updateRelease(octokit, context, 2, {
          name: 'v1',
          body: 'updated',
          prerelease: false
        })
      ).rejects.toThrow('cannot update');

      expect(core.error).toHaveBeenCalledWith('Failed to update release: cannot update');
    });
  });
});
