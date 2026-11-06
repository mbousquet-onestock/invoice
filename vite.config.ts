import { defineConfig, loadEnv, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * The OneStock design system (@onestock-public/design-system) lives in a private Google Artifact Registry.
 * When it is installed it is used; otherwise a local look-alike of the same components is used so the app
 * still builds (CI without registry access, first Vercel deployment...).
 */
function designSystemEntry(): string {
  try {
    createRequire(import.meta.url).resolve('@onestock-public/design-system');
    return path.join(root, 'src/ds/real.ts');
  } catch {
    return path.join(root, 'src/ds/fallback/index.ts');
  }
}

/**
 * Writes the extension manifest as a static file, dist/.well-known/onestock-extension.json: Vercel serves it at
 * https://<host>/.well-known/onestock-extension.json, before any rewrite. Without a known origin (local build), the
 * file is not written and the rewrite to /api/manifest serves it.
 */
function extensionManifest(): Plugin {
  return {
    name: 'onestock-extension-manifest',
    apply: 'build',
    async generateBundle() {
      const { buildManifest, deploymentOrigin, MANIFEST_PATH } = await import('./lib/manifest.js');
      const origin = deploymentOrigin();
      if (!origin) {
        this.warn('EXTENSION_URL / VERCEL_PROJECT_PRODUCTION_URL inconnus : manifeste servi par /api/manifest');
        return;
      }
      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_PATH.slice(1),
        source: `${JSON.stringify(buildManifest(origin), null, 2)}\n`,
      });
    },
  };
}

/** Serves the Vercel functions of /api during `vite dev`, so no Vercel CLI is needed locally. */
function vercelApiDev(): Plugin {
  return {
    name: 'vercel-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Same routes as vercel.json: extension manifest, and Hub callbacks POSTed to the root.
        if (req.url?.startsWith('/.well-known/onestock-extension.json')) req.url = '/api/manifest';
        if (req.method === 'POST' && (req.url === '/' || req.url?.startsWith('/?'))) req.url = '/api/hub';
        const match = req.url?.match(/^\/api\/([\w-]+)\/?(?:\?.*)?$/);
        const file = match && path.join(root, 'api', `${match[1]}.js`);
        if (!file || !fs.existsSync(file)) return next();
        let raw = '';
        for await (const chunk of req) raw += chunk;
        try {
          (req as typeof req & { body: unknown }).body = raw ? JSON.parse(raw) : {};
          const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
          await mod.default(req, res);
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Server-side variables (SETTINGS_API_KEY…) from .env / .env.local for the local /api functions.
  for (const [key, value] of Object.entries(loadEnv(mode, root, ''))) process.env[key] ??= value;
  return {
    plugins: [vue(), vercelApiDev(), extensionManifest()],
    resolve: {
      alias: {
        '#ds': designSystemEntry(),
        '#lib': path.join(root, 'lib'),
      },
    },
  };
});
