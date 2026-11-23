# Track

The browser tracker for [Eyes](https://eyes.dev), a powerful, privacy-friendly web and product analytics suite. It is served as `https://cdn.eyes.dev/v1/eyes.js`, and [`eyes-react`](https://www.npmjs.com/package/eyes-react) and [`eyes-next`](https://www.npmjs.com/package/eyes-next) load the same script.

```html
<script src="https://cdn.eyes.dev/v1/eyes.js" data-site="123456789" defer></script>
```

The tag carries your 9-digit Site ID in `data-site`, and the tracker starts on its own when the script loads. See [Automatic tracking](https://docs.eyes.dev/docs/tracking/automatic-tracking) for what it records and [Consent and cookies](https://docs.eyes.dev/docs/tracking/consent-and-cookies) for what it stores.

## License

MIT
