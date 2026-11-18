# eyes-next

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
