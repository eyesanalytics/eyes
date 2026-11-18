# eyes-next

The Next.js SDK for [Eyes](https://eyes.dev), a powerful, privacy-friendly web and product analytics suite. It is cookieless by default and tracks every route, in the App Router and the Pages Router.

`eyes-next` serves the tracker and its requests from your own domain, so your data still arrives when a visitor uses an ad blocker.

## Install

```bash
npm install eyes-next
```

It needs Next.js 14 or later and React 18 or later.

## Set up

Wrap your Next.js config with `withEyes`. It adds the rewrites that proxy the tracker under `/api/eyes`.

```ts
// next.config.ts
import { withEyes } from 'eyes-next/config';

const nextConfig = withEyes({
    // ...your existing config
});

export default nextConfig;
```

Add the provider to your root layout, with the 9-digit Site ID from your site's settings in Eyes.

```tsx
// app/layout.tsx
import { EyesNextProvider } from 'eyes-next';

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>
                <EyesNextProvider siteId="123456789">{children}</EyesNextProvider>
            </body>
        </html>
    );
}
```

Deploy and open your site. Eyes records pageviews, outbound link clicks, engagement and Core Web Vitals without extra code.

## Track custom events

List your events once, and every `track()` call is checked against them.

```ts
// lib/eyes.ts
import { createEyes } from 'eyes-next';

type Events = {
    'Signup Completed': { plan: 'free' | 'pro' };
    'Docs Opened': undefined;
};

export const { track, useEyes } = createEyes<Events>();
```

```tsx
'use client';

import { track } from '@/lib/eyes';

export function SignupButton() {
    return <button onClick={() => track('Signup Completed', { plan: 'pro' })}>Sign up</button>;
}
```

`useEyes()` also returns `consent()`, `revokeConsent()`, `identify()`, `optOut()` and `optIn()` for a consent banner or a signed-in user.

## Links

- [Next.js integration guide](https://eyes.dev/integrations/nextjs)
- [Documentation](https://docs.eyes.dev)
- [Custom events](https://docs.eyes.dev/docs/tracking/custom-events)
- [Consent and cookies](https://docs.eyes.dev/docs/tracking/consent-and-cookies)
- [eyes.dev](https://eyes.dev)

Questions or a bug to report? Email [support@eyes.dev](mailto:support@eyes.dev).

## License

MIT
