import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Next's own default is 1MB — comfortably too small for a real
      // scanned ID/document photo, and exceeding it makes Next reject the
      // Server Action request before the action function ever runs (the
      // original Phase 5 crash). This is strictly a transport ceiling, not
      // a user-facing allowance: the approved application/business limit
      // for a student document is 10 MB (MAX_DOCUMENT_FILE_SIZE_BYTES in
      // lib/domain/students.ts), enforced independently on both the client
      // and the server. 12mb here just leaves that 10 MB limit enough
      // headroom for multipart/form-data overhead and the action's other
      // bound arguments — a real user is never meant to reach anywhere
      // close to this number, since the 10 MB application check always
      // rejects first.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
