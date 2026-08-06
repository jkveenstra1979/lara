import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Zonder deze regel zoekt Turbopack de projectwortel op via de dichtstbijzijnde
  // lockfile en komt dan buiten de repository uit (~/package-lock.json).
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
