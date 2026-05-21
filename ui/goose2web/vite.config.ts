import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  clearScreen: false,
  server: {
    port: parseInt(process.env.VITE_PORT || "1520", 10),
    strictPort: true,
    host: false,
  },
}));
