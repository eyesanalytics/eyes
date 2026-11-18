# eyes-react

The React SDK for [Eyes](https://eyes.dev), a powerful, privacy-friendly web and product analytics suite. It is cookieless by default and tracks every client-side navigation in your single-page app.

Building with Next.js? Use [`eyes-next`](https://www.npmjs.com/package/eyes-next), which also serves the tracker from your own domain.

## Install

```bash
npm install eyes-react
```

It needs React 18 or later.

## Set up

Wrap your app root with `EyesProvider`, with the 9-digit Site ID from your site's settings in Eyes.

```tsx
// main.tsx
import { EyesProvider } from 'eyes-react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
    <EyesProvider siteId="123456789">
        <App />
    </EyesProvider>,
);
```

Deploy and open your site. Eyes records pageviews, outbound link clicks, engagement and Core Web Vitals without extra code.

## Track custom events

List your events once, and every `track()` call is checked against them.

```ts
// eyes.ts
import { createEyes } from 'eyes-react';

type Events = {
    'Signup Completed': { plan: 'free' | 'pro' };
    'Docs Opened': undefined;
};

export const { track, useEyes } = createEyes<Events>();
```

```tsx
import { track } from './eyes';

export function SignupButton() {
    return <button onClick={() => track('Signup Completed', { plan: 'pro' })}>Sign up</button>;
}
```

`useEyes()` also returns `consent()`, `revokeConsent()`, `identify()`, `optOut()` and `optIn()` for a consent banner or a signed-in user.

## Links

- [React integration guide](https://eyes.dev/integrations/react)
- [Documentation](https://docs.eyes.dev)
- [Custom events](https://docs.eyes.dev/docs/tracking/custom-events)
- [Consent and cookies](https://docs.eyes.dev/docs/tracking/consent-and-cookies)
- [eyes.dev](https://eyes.dev)

Questions or a bug to report? Email [support@eyes.dev](mailto:support@eyes.dev).

## License

MIT
