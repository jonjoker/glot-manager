/** @type {import('next').NextConfig} */
const nextConfig = {
  // The @glot-manager/* packages are workspace dependencies; let Next transpile them.
  transpilePackages: [
    '@glot-manager/core',
    '@glot-manager/react',
    '@glot-manager/server',
    '@glot-manager/anthropic',
    '@glot-manager/openai',
  ],
};

export default nextConfig;
