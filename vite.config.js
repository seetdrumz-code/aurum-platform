import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:   ["react", "react-dom", "react-router-dom"],
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
          charts:   ["recharts"],
          utils:    ["tone", "papaparse", "lodash", "mathjs"],
        },
      },
    },
  },
  optimizeDeps: {
    include: ["tone", "mathjs", "papaparse", "lodash"],
  },
});
