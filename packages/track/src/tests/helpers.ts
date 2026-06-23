import type { EyesConfig } from 'eyes-types';

export const TEST_SITE_ID = '482910300';

export const testEyesConfig = (overrides: Partial<EyesConfig> = {}): EyesConfig => ({
    siteId: TEST_SITE_ID,
    endpoint: 'https://example.com',
    ...overrides,
});
