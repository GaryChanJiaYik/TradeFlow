/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@tradeflow/types", "@tradeflow/validation"],
};

export default nextConfig;
