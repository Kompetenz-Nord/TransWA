import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGitHubReleaseUpdate, isNewerVersion } from '../src/shared/update-checker';
import { detectVoiceMessageDirection } from '../src/content/dom-observer';

test('Semver version comparison detects newer GitHub releases accurately', () => {
  assert.equal(isNewerVersion('1.0.0', 'v1.0.1'), true);
  assert.equal(isNewerVersion('1.0.0', '1.1.0'), true);
  assert.equal(isNewerVersion('1.2.0', 'v1.2.0'), false);
  assert.equal(isNewerVersion('1.2.1', 'v1.2.0'), false);
});

test('GitHub update checker never throws when offline or network fails', async () => {
  const offlineResult = await checkGitHubReleaseUpdate({
    currentVersion: '1.0.0',
    githubRepo: 'Kompetenz-Nord/TransWA',
    fetchImpl: async () => {
      throw new Error('Network unreachable');
    },
  });

  assert.equal(offlineResult.updateAvailable, false);
  assert.equal(offlineResult.error, 'Network unreachable');

  const updateAvailableResult = await checkGitHubReleaseUpdate({
    currentVersion: '1.0.0',
    githubRepo: 'Kompetenz-Nord/TransWA',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          tag_name: 'v1.2.0',
          html_url: 'https://github.com/Kompetenz-Nord/TransWA/releases/tag/v1.2.0',
        }),
        { status: 200 }
      ),
  });

  assert.equal(updateAvailableResult.updateAvailable, true);
  assert.equal(updateAvailableResult.latestVersion, '1.2.0');
  assert.equal(updateAvailableResult.error, null);
});

test('Voice message direction detection handles incoming and outgoing IDs & classes', () => {
  const fakeInEl = {
    classList: { contains: (c: string) => c === 'message-in' },
    closest: () => null,
  } as unknown as Element;

  const fakeOutEl = {
    classList: { contains: (c: string) => c === 'message-out' },
    closest: () => null,
  } as unknown as Element;

  assert.equal(detectVoiceMessageDirection(fakeInEl, 'false_49170@c.us_1'), 'incoming');
  assert.equal(detectVoiceMessageDirection(fakeOutEl, 'true_49170@c.us_2'), 'outgoing');
});
