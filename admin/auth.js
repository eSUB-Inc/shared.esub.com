// MSAL (Microsoft Entra ID) auth wrapper. Requires msal-browser UMD loaded first.
// Exposes window.AdminAuth = { init, login, logout, getAccount, isConfigured }.
(function () {
  "use strict";
  var cfg = window.ADMIN_CONFIG.auth;
  var configured = cfg.clientId && cfg.clientId.indexOf("YOUR_") !== 0;
  var msalApp = null;

  async function init() {
    if (!configured) return null;
    msalApp = new msal.PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: "https://login.microsoftonline.com/" + cfg.tenantId,
        redirectUri: cfg.redirectUri,
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    await msalApp.initialize();
    // Distinguish a fresh interactive sign-in (redirect just completed) from a
    // cached-session page load, and surface redirect errors (e.g. a declined
    // consent) instead of letting them break boot — both feed the sign-in log.
    try {
      var result = await msalApp.handleRedirectPromise();
      if (result && result.account) {
        msalApp.setActiveAccount(result.account);
        window.AdminAuth.freshLogin = true;
      }
    } catch (e) {
      window.AdminAuth.lastError = (e && (e.errorCode || "auth_error")) + ": " + ((e && e.errorMessage) || e && e.message || "").slice(0, 200);
    }
    if (!msalApp.getActiveAccount()) {
      var accounts = msalApp.getAllAccounts();
      if (accounts.length) msalApp.setActiveAccount(accounts[0]);
    }
    return getAccount();
  }

  function getAccount() {
    if (!msalApp) return null;
    var a = msalApp.getActiveAccount();
    if (!a) return null;
    var given = (a.idTokenClaims && a.idTokenClaims.given_name) || (a.name || "").split(" ")[0];
    return { username: a.username, name: a.name || a.username, firstName: given || a.username };
  }

  function login() {
    return msalApp.loginRedirect({ scopes: ["openid", "profile", "email"] });
  }

  function tokenExpMs(jwt) {
    try {
      return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp * 1000;
    } catch (e) { return 0; }
  }

  // Fresh ID token for the auth proxy. MSAL can serve a cached ID token that is
  // about to lapse, so force a refresh when it has under two minutes left.
  async function getApiToken() {
    var account = msalApp && msalApp.getActiveAccount();
    if (!account) throw new Error("Not signed in");
    var request = { scopes: ["openid", "profile", "email"], account: account };
    try {
      var r = await msalApp.acquireTokenSilent(request);
      if (tokenExpMs(r.idToken) - Date.now() < 120000) {
        r = await msalApp.acquireTokenSilent(Object.assign({ forceRefresh: true }, request));
      }
      return r.idToken;
    } catch (e) {
      throw new Error("Your sign-in session expired — sign out and back in, then retry.");
    }
  }

  function logout() {
    try { sessionStorage.removeItem("shared-admin-pat"); } catch (e) {}
    return msalApp.logoutRedirect();
  }

  window.AdminAuth = { init: init, login: login, logout: logout, getAccount: getAccount, getApiToken: getApiToken, isConfigured: configured };
})();
