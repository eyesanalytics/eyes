# eyes-react

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
