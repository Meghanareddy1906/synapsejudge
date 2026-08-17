import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certDir = path.resolve(repoRoot, process.env.CERT_DIR ?? './certs');
const keyPath = path.join(certDir, 'localhost-key.pem');
const certPath = path.join(certDir, 'localhost-cert.pem');

/**
 * Serve dev over HTTPS only when explicitly asked: `HTTPS=true npm run dev`.
 *
 * Plain HTTP is the default because a localhost certificate can only ever be
 * self-signed — no authority can vouch for a name that resolves to every
 * machine — so browsers show a full-page "Not secure" interstitial every time.
 * That cost buys nothing locally: the traffic never leaves the loopback
 * interface. Production TLS is a real certificate from certbot; see DEPLOY.md.
 */
function devHttps() {
  if (process.env.HTTPS !== 'true') return undefined;

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.warn('[vite] HTTPS=true but no certificate found. Run `npm run certs`. Falling back to HTTP.');
    return undefined;
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.CLIENT_PORT ?? 5173),
    // Fail loudly if the port is taken rather than silently binding a narrower
    // address than an existing listener and losing every request to it.
    strictPort: true,
    https: devHttps(),
    // Keeps the browser on one origin in dev, so no CORS preflight and the same
    // relative /api paths work in production behind Nginx.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
