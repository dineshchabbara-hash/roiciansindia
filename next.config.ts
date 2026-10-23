import type { NextConfig } from "next";

// Self-hosting behind a reverse proxy (e.g. Hostinger): when the proxy does
// not pass the public host on to Next.js, Server Actions refuse every form
// because the browser's Origin no longer matches. List the public host(s)
// here, comma-separated, only for such deployments. Empty means Next.js's
// default same-origin check, unchanged.
const serverActionsAllowedOrigins = (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

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
      ...(serverActionsAllowedOrigins.length > 0
        ? { allowedOrigins: serverActionsAllowedOrigins }
        : {}),
    },
    // proxy.ts runs on every page request, and Next.js buffers a request
    // body for proxy only up to this size (default 10MB), passing a cut-off
    // body on beyond it. A 10 MB upload plus multipart overhead is just over
    // 10MB, so the default made files at the advertised 10 MB limit fail.
    // Kept equal to bodySizeLimit above.
    proxyClientMaxBodySize: "12mb",
  },
};

export default nextConfig;
