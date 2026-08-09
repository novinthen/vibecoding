import { appEnv } from '../src/config/env';

/**
 * Standalone environment validation entrypoint.
 *
 * Importing `appEnv` triggers validation as a side effect. Run this in CI and
 * locally (`npm run env:check`) to fail fast on misconfiguration before a build
 * or deploy.
 */
console.log('Environment OK');
console.log(`  NODE_ENV = ${appEnv.NODE_ENV}`);
console.log(`  APP_ENV  = ${appEnv.APP_ENV}`);
