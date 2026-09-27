const nextConfig = {
  async rewrites() {
    const configuredTarget = process.env.API_PROXY_TARGET?.trim();
    if (!configuredTarget) return [];
    const target = new URL(configuredTarget);
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('API_PROXY_TARGET must be an HTTP or HTTPS origin.');
    return [{ source: '/api/:path*', destination: `${target.origin}/api/:path*` }];
  },
};

export default nextConfig;
