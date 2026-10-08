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

/** Serves the Vercel functions of /api during `vite dev`, so no Vercel CLI is needed locally. */
function vercelApiDev(): Plugin {
  return {
    name: 'vercel-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
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
    plugins: [vue(), vercelApiDev()],
    resolve: {
      alias: {
        '#ds': designSystemEntry(),
        '#lib': path.join(root, 'lib'),
      },
    },
  };
});
