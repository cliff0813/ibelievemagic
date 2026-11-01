/** @type {import('next').NextConfig} */
const basePath = process.env.GITHUB_ACTIONS ? "/ibelievemagic" : "";

const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
