# eyes-next

## 0.5.1

### Patch Changes

- b3aeeca: The source of the tracker and both SDKs is now public at [github.com/eyesanalytics/eyes](https://github.com/eyesanalytics/eyes), and the npm pages link to it. Every package also ships its MIT licence file, and `eyes-types` has a README.
- Updated dependencies [b3aeeca]
  - eyes-react@0.5.1

## 0.5.0

### Minor Changes

- 270cfe4: `useEyes()` and `createEyes()` now return `consent()`, `revokeConsent()` and `identify(traits)`, so a consent banner and a signed-in user can reach the tracker without `window.Eyes`. Calls made before the tracker script has loaded are queued and sent in order once it has, so a `consent()` followed by `identify()` is never dropped. `EyesProvider` and `EyesNextProvider` also take a `cookieDomain` prop, such as `.example.com`, to share the `eyes_id` cookie with your subdomains.

### Patch Changes

- ea266f5: Both packages now ship a README with install steps and a minimal example, and their `package.json` has a `homepage`, a `bugs` address and wider `keywords`, so the npm page explains the package and links to eyes.dev.
- Updated dependencies [ea266f5]
- Updated dependencies [270cfe4]
  - eyes-react@0.5.0

## 0.4.1

### Patch Changes

- eyes-react@0.4.1

## 0.4.0

### Minor Changes

- 2417ede: Add `optOut()` and `optIn()`, so a visitor can object to tracking. `useEyes()` returns both. While a browser is opted out, the tracker sends nothing.

### Patch Changes

- Updated dependencies [2417ede]
  - eyes-react@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [99d7ccb]
  - eyes-react@0.3.1

## 0.3.0

### Minor Changes

- a148a40: Forward the visitor's IP address through the `withEyes` proxy rewrites. Hosting platforms such as Cloudflare Tunnel or Caddy replace `x-forwarded-for` with their own hop before a request reaches Next.js, so every proxied visitor geolocated to the server's datacenter. The ingress rewrites now capture `cf-connecting-ip`, `x-real-ip`, or the first `x-forwarded-for` entry and pass it to the ingress as the `visitor_ip` query parameter.

### Patch Changes

- eyes-react@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [e62f787]
  - eyes-react@0.2.0

## 0.1.1

### Patch Changes

- 6ac5603: Default to Eyes ingress url
- Updated dependencies [6ac5603]
  - eyes-react@0.1.1
