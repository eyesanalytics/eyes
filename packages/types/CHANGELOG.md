# eyes-types

## 0.5.1

### Patch Changes

- b3aeeca: The source of the tracker and both SDKs is now public at [github.com/eyesanalytics/eyes](https://github.com/eyesanalytics/eyes), and the npm pages link to it. Every package also ships its MIT licence file, and `eyes-types` has a README.

## 0.5.0

## 0.4.1

### Patch Changes

- 13c3517: Add the `SentEvent` type: a tracker event as it goes over the wire, with the `sentAt` browser time the tracker stamps on every event when its batch is sent, so the server can correct event timestamps for a browser clock that runs wrong.

## 0.4.0

### Minor Changes

- 2417ede: Add `optOut()` and `optIn()`, so a visitor can object to tracking. `useEyes()` returns both. While a browser is opted out, the tracker sends nothing.

### Patch Changes

- 9d204f0: Add the `consent_granted` event type, which the tracker sends when a visitor gives consent, so a `beforeSend` hook can see it alongside `consent_revoked`.
- 69dacad: Add an optional `pageLoadId` to tracker events: a random id per page load, the same for every event the document sends. The server uses it to file engagement and vitals on the visit their pageview joined, now that sessions are derived on the server instead of per browser tab.

## 0.3.1

## 0.3.0

## 0.2.0

### Minor Changes

- e62f787: Add `siteId` support: `EyesConfig` (eyes-types) and the `EyesProvider` props (eyes-react) now accept a `siteId`, which seeds the tracker config. The provider no longer reinitializes the config ref on every render, and `endpoint` is applied only when explicitly set.

## 0.1.1

### Patch Changes

- 6ac5603: Default to Eyes ingress url
