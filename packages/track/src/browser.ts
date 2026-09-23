import { autoInit } from '~/auto-init';

export * from '~/index';

// Entry for the IIFE build served at /v1/eyes.js: same API as index,
// plus auto-init from the snippet's data attributes.
autoInit();
