import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Next's own default is 1MB — comfortably too small for a real
      // scanned ID/document photo. Exceeding it makes Next reject the
      // Server Action request before the action function ever runs,
      // which is what crashed the Student Profile page to its error
      // boundary for an ordinary document upload (Phase 5 bug). Raised to
      // a conservative, commonly-used ceiling for document uploads; the
      // app's own MAX_DOCUMENT_FILE_SIZE_BYTES (lib/domain/students.ts)
      // validates comfortably under this, so an oversized file is always
      // caught as a normal in-app error before it can hit this transport
      // limit.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
