# eyes-react

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
