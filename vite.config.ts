import { defineConfig, loadEnv } from 'vite';
import { createApi } from './server/foundry';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const settings: Record<string, string> = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  return {
    server: { host: '127.0.0.1' },
    preview: { host: '127.0.0.1' },
    plugins: [{
      name: 'local-foundry-adapter',
      configureServer(server) { server.middlewares.use(createApi(settings)); },
      configurePreviewServer(server) { server.middlewares.use(createApi(settings)); },
    }],
  };
});
