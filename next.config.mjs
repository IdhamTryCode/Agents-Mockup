/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle so the Docker image can run with just
  // `node server.js` (no node_modules copy needed).
  output: "standalone",
};

export default nextConfig;
