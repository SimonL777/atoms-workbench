import { defineConfig } from 'vite';
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: '/output',
    emptyOutDir: true,
    lib: {
      entry: 'src/main.tsx',
      name: 'AtomsApp',
      formats: ['iife'],
      fileName: () => 'app.js',
      cssFileName: 'app',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
