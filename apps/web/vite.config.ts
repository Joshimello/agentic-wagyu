import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-bun';
export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      paths: { origin: 'http://localhost:5173' },
    }),
  ],
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
});
