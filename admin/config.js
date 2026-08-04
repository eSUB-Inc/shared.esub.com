// Deployment configuration for the eSUB Shared Admin SPA (shared.esub.com).
// Ported from the designs.esub.com Publishing Admin (reference architecture
// docs live in designs-internal/design_handoff_admin_publishing_layer/).
window.ADMIN_CONFIG = {
  // Microsoft Entra ID app registration "eSUB Shared Publishing Admin"
  // (esub.com tenant). Access is restricted via "Assignment required" on the
  // Enterprise Application + the "SSO Shared" security group.
  auth: {
    clientId: "4b8b0a12-11bd-4c74-aa1a-35afaa49c0c2",
    tenantId: "9f90601e-35f6-4142-aacf-53f1218356e2",
    // Normalized so /admin/index.html and /admin/ both resolve to the single
    // registered redirect URI (https://shared.esub.com/admin/).
    redirectUri: window.location.origin + window.location.pathname.replace(/index\.html$/, ""),
  },
  // GitHub repositories.
  github: {
    owner: "eSUB-Inc",
    publicRepo: "shared.esub.com",           // GitHub Pages site (ciphertext + gate)
    privateRepo: "shared.esub.com-internal", // plaintext sources + access-codes.xlsx
    branch: "main",
  },
  site: {
    baseUrl: "https://shared.esub.com",
  },
  // Auth proxy (Cloudflare Worker; source in shared.esub.com-internal under
  // admin/proxy/). When baseUrl is set the app never asks for a GitHub token:
  // it sends the signed Entra ID token from login and the proxy makes the
  // GitHub calls with a server-held PAT. Leave "" to fall back to the
  // per-session PAT gate.
  proxy: {
    baseUrl: "https://shared-admin-proxy.esub-designs.workers.dev",
  },
  publishing: {
    pollIntervalMs: 15000,   // how often to check a pending page
    pollTimeoutMs: 600000,   // 10 min without success -> error state
    pageSize: 12,            // rows per page before pagination appears
    // Upload cap. Large files are supported (reads over 1 MB go through the
    // git blobs API), so this is a sanity bound, not an API limit — the gate
    // decrypts the whole page in the browser, so keep pages lean.
    maxUploadBytes: 26214400, // 25 MB
  },
  helpDesk: {
    // Service-desk portal for access requests and failed-publish investigations.
    // Rendered as "Contact Help Desk" with the label as the clickable link.
    url: "https://esubdev.atlassian.net/servicedesk/customer/portal/3",
    label: "Help Desk",
  },
};
