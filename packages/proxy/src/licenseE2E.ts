/**
 * Bundle entry used only by tests/integration/license-e2e.test.ts (built to dist/licenseE2E.js).
 *
 * The test needs the app's real licensing and telemetry code, a database it controls, and the
 * public-key test hook, all inside ONE bundle so they share module state (tsup copies modules into
 * each entry). Nothing imports this file and it is not part of the published CLI: the CLI package
 * copies only dist/server.js and the dashboard/migrations folders from this build.
 */
export { activateLicense, getLicenseInfo, revalidateLicense, getMachineId, licenseServerUrl } from './licenseManager';
export { sendPingIfDue, buildPing } from './telemetry';
export { __setLicensePublicKeyForTests } from './licenseKeys';
export { initDb, closeDb, getSetting, updateSetting } from '@llm-observer/database';
