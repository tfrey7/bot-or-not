// The google.com host permission is optional (manifest.json:
// `optional_host_permissions`). Firefox will not fire the google-harvest
// content script — even though it's declared in `content_scripts` — until
// the user has explicitly granted permission. These helpers wrap the
// browser.permissions calls so the rest of the codebase doesn't have to
// know the origin pattern.
//
// IMPORTANT: `request()` must be called directly from a user gesture
// inside an extension page (the settings toggle click handler). Don't
// route it through the background — Firefox rejects permission requests
// originating from a service worker.

const GOOGLE_ORIGIN = "https://www.google.com/*";

function permissionRequest(): browser.permissions.Permissions {
  return { origins: [GOOGLE_ORIGIN] };
}

export function bonGoogleHarvestIsGranted(): Promise<boolean> {
  return browser.permissions.contains(permissionRequest());
}

export function bonGoogleHarvestRequest(): Promise<boolean> {
  return browser.permissions.request(permissionRequest());
}

export function bonGoogleHarvestRevoke(): Promise<boolean> {
  return browser.permissions.remove(permissionRequest());
}

export function bonGoogleHarvestMatches(
  permissions: browser.permissions.Permissions
): boolean {
  return (permissions.origins ?? []).includes(GOOGLE_ORIGIN);
}
