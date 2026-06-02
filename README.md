# Eyes

The browser tracker and JavaScript SDKs for [Eyes](https://eyes.dev), a powerful, privacy-friendly web and product analytics suite. Eyes is cookieless by default.

This is the source of the code that runs on your visitors' devices, so you can check what it collects and sends.

| Package | What it is |
| --- | --- |
| [`packages/track`](packages/track) | The browser tracker, served as `https://cdn.eyes.dev/v1/eyes.js` and loaded by both SDKs |
| [`packages/eyes-react`](packages/eyes-react) | [`eyes-react`](https://www.npmjs.com/package/eyes-react), the React provider and hook |
| [`packages/eyes-next`](packages/eyes-next) | [`eyes-next`](https://www.npmjs.com/package/eyes-next), the Next.js SDK that serves the tracker from your own domain |
| [`packages/types`](packages/types) | [`eyes-types`](https://www.npmjs.com/package/eyes-types), the shared TypeScript types |

## Install

With Next.js:

```bash
npm install eyes-next
```

With React:

```bash
npm install eyes-react
```

On any other site, add the script tag to your page head, with the 9-digit Site ID from your site's settings in Eyes:

```html
<script src="https://cdn.eyes.dev/v1/eyes.js" data-site="123456789" defer></script>
```

The [install guide](https://docs.eyes.dev/docs/tracking/install) covers every option.

## What the tracker collects

See [Automatic tracking](https://docs.eyes.dev/docs/tracking/automatic-tracking) and [Consent and cookies](https://docs.eyes.dev/docs/tracking/consent-and-cookies) in the docs, and [`packages/track/src`](packages/track/src) for the code itself.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

This repository is a read-only mirror, updated on every release. Questions, bugs and ideas are welcome at [support@eyes.dev](mailto:support@eyes.dev).

## License

[MIT](LICENSE)
