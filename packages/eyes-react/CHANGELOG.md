# eyes-react

## 0.5.0

### Minor Changes

- 270cfe4: `useEyes()` and `createEyes()` now return `consent()`, `revokeConsent()` and `identify(traits)`, so a consent banner and a signed-in user can reach the tracker without `window.Eyes`. Calls made before the tracker script has loaded are queued and sent in order once it has, so a `consent()` followed by `identify()` is never dropped. `EyesProvider` and `EyesNextProvider` also take a `cookieDomain` prop, such as `.example.com`, to share the `eyes_id` cookie with your subdomains.

### Patch Changes

- ea266f5: Both packages now ship a README with install steps and a minimal example, and their `package.json` has a `homepage`, a `bugs` address and wider `keywords`, so the npm page explains the package and links to eyes.dev.
  - eyes-types@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies [13c3517]
  - eyes-types@0.4.1

## 0.4.0

### Minor Changes

- 2417ede: Add `optOut()` and `optIn()`, so a visitor can object to tracking. `useEyes()` returns both. While a browser is opted out, the tracker sends nothing.

### Patch Changes

- Updated dependencies [9d204f0]
- Updated dependencies [69dacad]
- Updated dependencies [2417ede]
  - eyes-types@0.4.0

## 0.3.1

### Patch Changes

- 99d7ccb: Queue `track()` and `page()` calls made before the tracker script has loaded and send them once `EyesProvider` has initialised it. A call from a page's mount effect on a full page load, such as a `Signup Completed` event on a thank-you page, used to be dropped without a warning, because React runs the page's effects before the provider adds the script tag. The queue keeps at most 100 calls, so a page where the script never loads (ad blocker) does not grow it forever.
  - eyes-types@0.3.1

## 0.3.0

### Patch Changes

- eyes-types@0.3.0

## 0.2.0

### Minor Changes

- e62f787: Add `siteId` support: `EyesConfig` (eyes-types) and the `EyesProvider` props (eyes-react) now accept a `siteId`, which seeds the tracker config. The provider no longer reinitializes the config ref on every render, and `endpoint` is applied only when explicitly set.

### Patch Changes

- Updated dependencies [e62f787]
  - eyes-types@0.2.0

## 0.1.1

### Patch Changes

- 6ac5603: Default to Eyes ingress url
- Updated dependencies [6ac5603]
  - eyes-types@0.1.1
