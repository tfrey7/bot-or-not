// The api.github.com host permission is optional (manifest.json:
// `optional_host_permissions`). Automatic sync can't reach the gist until
// the user has explicitly granted it. These helpers wrap the
// browser.permissions calls so the rest of the codebase doesn't have to
// know the origin pattern.
//
// IMPORTANT: `request()` must be called directly from a user gesture inside
// an extension page (the settings sync controls). Don't route it through the
// background — Firefox rejects permission requests originating from a
// service worker.

const GITHUB_ORIGIN = "https://api.github.com/*";

function permissionRequest(): browser.permissions.Permissions {
  return { origins: [GITHUB_ORIGIN] };
}

export function githubSyncRequest(): Promise<boolean> {
  return browser.permissions.request(permissionRequest());
}
