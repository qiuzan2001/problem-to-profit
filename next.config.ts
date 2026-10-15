import type { NextConfig } from 'next';

const basePath = process.env.NODE_ENV === 'production' ? '/problem-to-profit' : '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
