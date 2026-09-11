import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@shared": path.resolve(import.meta.dirname, "../shared") } },
  server: {
    port: 5173,
    // Lets phones on the same wifi scan the QR code and reach the dev server.
    host: true,
  },
});
