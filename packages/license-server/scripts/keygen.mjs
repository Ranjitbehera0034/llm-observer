// Generates the Ed25519 keypair used to sign license keys.
//
//   npm run keygen --workspace=@llm-observer/license-server
//
// - Put the PRIVATE key in the license server's Vercel env as LICENSE_PRIVATE_KEY.
//   Never commit it.
// - Put the PUBLIC key in packages/proxy/src/licenseKeys.ts (LICENSE_PUBLIC_KEY_PEM)
//   and publish a new app release, so the app can verify keys offline.
//
// Rotating the keypair invalidates every key signed with the old one.
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();

console.log('LICENSE_PRIVATE_KEY (Vercel env, keep secret):\n');
console.log(priv);
console.log('Single-line form for env UIs:\n');
console.log(priv.trim().replace(/\n/g, '\\n'));
console.log('\nLICENSE_PUBLIC_KEY_PEM (packages/proxy/src/licenseKeys.ts):\n');
console.log(pub);
