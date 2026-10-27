import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Plugin para ejecutar las Serverless Functions de /api localmente en Vite
 * exactamente igual que en Vercel.
 */
function vercelApiPlugin() {
  return {
    name: 'vercel-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) {
          return next();
        }

        try {
          const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          const routeName = urlObj.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
          const filePath = path.join(__dirname, 'api', `${routeName}.js`);

          // Leer body si es POST/PUT
          let rawBody = '';
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            await new Promise((resolve, reject) => {
              req.on('data', (chunk) => {
                rawBody += chunk;
              });
              req.on('end', resolve);
              req.on('error', reject);
            });
          }

          if (rawBody) {
            try {
              req.body = JSON.parse(rawBody);
            } catch {
              req.body = rawBody;
            }
          } else {
            req.body = {};
          }

          req.query = Object.fromEntries(urlObj.searchParams.entries());

          // Helpers estilo Express/Vercel en res
          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (data) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(data));
            return res;
          };

          const moduleUrl = `${pathToFileURL(filePath).href}?t=${Date.now()}`;
          const mod = await import(moduleUrl);
          if (typeof mod.default === 'function') {
            await mod.default(req, res);
          } else {
            res.status(404).json({ error: `Ruta API /api/${routeName} no encontrada` });
          }
        } catch (err) {
          console.error('[API Dev Error]:', err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                ok: false,
                error: err.message || 'Error interno en el servidor local',
              })
            );
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), vercelApiPlugin()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
  },
});
