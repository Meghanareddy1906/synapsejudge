/**
 * Generates a self-signed certificate for local HTTPS development.
 *
 *   npm run certs
 *
 * The pair lands in ./certs, which is gitignored — the private key is a secret
 * and the certificate is machine-local, so neither belongs in the repository.
 * `client/vite.config.js` picks them up on the next start automatically.
 *
 * This certificate is for localhost only. Production TLS is a real Let's
 * Encrypt certificate issued by certbot; see DEPLOY.md.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certDir = path.join(repoRoot, 'certs');
const keyPath = path.join(certDir, 'localhost-key.pem');
const certPath = path.join(certDir, 'localhost-cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath) && !process.argv.includes('--force')) {
  console.log(`Certificate already present in ${certDir}. Re-run with --force to replace it.`);
  process.exit(0);
}

fs.mkdirSync(certDir, { recursive: true });

try {
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath,
      '-out', certPath,
      '-days', '825',
      '-subj', '/CN=localhost/O=SynapseJudge Local Dev',
      '-addext', 'subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1,IP:::1',
      '-addext', 'keyUsage=digitalSignature,keyEncipherment',
      '-addext', 'extendedKeyUsage=serverAuth',
    ],
    // execFileSync passes argv directly, so Git Bash's path mangling of
    // "/CN=..." into a Windows path never happens here.
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
} catch (err) {
  console.error('Could not generate a certificate. Is openssl installed and on PATH?');
  console.error(String(err.stderr ?? err.message).trim().split('\n').slice(-3).join('\n'));
  process.exit(1);
}

// The key is readable only by its owner where the platform honours file modes.
fs.chmodSync(keyPath, 0o600);

console.log(`Wrote ${path.relative(repoRoot, keyPath)} and ${path.relative(repoRoot, certPath)}`);
console.log('Start the app and it will serve over HTTPS. Set HTTPS=false to opt out.');
