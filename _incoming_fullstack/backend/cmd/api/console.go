package main

import (
	"net/http"

	"blockxone/internal/app"

	"github.com/gin-gonic/gin"
)

// registerDevConsole serves a lightweight in-browser API console.
//
// It is intended for local/dev use only. It is registered only when APP_ENV=dev.
func registerDevConsole(r *gin.Engine, a *app.App) {
	if a == nil || a.Cfg.AppEnv != "dev" {
		return
	}

	r.GET("/console", func(c *gin.Context) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(http.StatusOK, devConsoleHTML)
	})
}

const devConsoleHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BlockXOne Dev Console</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 24px; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
    .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin: 12px 0; }
    label { display:block; font-size: 12px; color: #374151; margin-bottom: 6px; }
    input, select, textarea { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid #d1d5db; font-size: 14px; }
    textarea { min-height: 140px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    button { padding: 10px 14px; border-radius: 10px; border: 1px solid #111827; background:#111827; color: white; cursor: pointer; }
    button.secondary { background: white; color: #111827; }
    pre { background: #0b1020; color: #e5e7eb; padding: 12px; border-radius: 12px; overflow:auto; }
    .hint { font-size: 12px; color: #6b7280; }
    .title { display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .title h1 { margin: 0; }
    .pill { font-size:12px; padding: 4px 10px; border-radius: 999px; background:#f3f4f6; border:1px solid #e5e7eb; color:#111827; }
  </style>
</head>
<body>
  <div class="title">
    <h1>BlockXOne Dev Console</h1>
    <div class="pill">APP_ENV=dev only</div>
  </div>
  <p class="hint">This page helps you test the API quickly using <code>X-Dev-*</code> headers. Use it only in local/dev environments.</p>

  <div class="card">
    <h3 style="margin-top:0">Headers</h3>
    <div class="row">
      <div style="flex:1; min-width: 260px;">
        <label>API Base URL</label>
        <input id="baseUrl" />
        <div class="hint">Defaults to the same origin (e.g., http://localhost:8080)</div>
      </div>
      <div style="flex:1; min-width: 260px;">
        <label>X-Dev-User-Id</label>
        <input id="userId" placeholder="11111111-1111-1111-1111-111111111111" />
      </div>
      <div style="flex:1; min-width: 260px;">
        <label>X-Dev-Email</label>
        <input id="email" placeholder="investor@blockxone.local" />
      </div>
      <div style="flex:1; min-width: 260px;">
        <label>X-Dev-Org-Id (optional)</label>
        <input id="orgId" placeholder="eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" />
      </div>
      <div style="flex:1; min-width: 260px;">
        <label>X-Dev-Roles (optional override)</label>
        <input id="roles" placeholder="Investor,OfferingManager" />
      </div>
    </div>
    <div class="hint" style="margin-top:10px;">
      Seeded demo IDs: Investor <code>1111…</code>, Offering Manager <code>2222…</code>, Compliance <code>3333…</code>, Issuer <code>4444…</code>, Transfer Agent <code>5555…</code>, Token Agent <code>6666…</code>, Admin <code>9999…</code>.
    </div>
  </div>

  <div class="card">
    <h3 style="margin-top:0">Request</h3>
    <div class="row">
      <div style="width: 140px;">
        <label>Method</label>
        <select id="method">
          <option>GET</option>
          <option>POST</option>
          <option>PUT</option>
          <option>DELETE</option>
        </select>
      </div>
      <div style="flex:1; min-width: 260px;">
        <label>Path</label>
        <input id="path" placeholder="/v1/me" />
      </div>
    </div>
    <div style="margin-top:12px;">
      <label>JSON Body (for POST/PUT)</label>
      <textarea id="body">{}</textarea>
    </div>
    <div class="row" style="margin-top: 12px;">
      <button id="sendBtn">Send</button>
      <button class="secondary" id="exMe">Example: /v1/me</button>
      <button class="secondary" id="exOfferings">Example: Create offering</button>
      <button class="secondary" id="exKyc">Example: Create KYC case</button>
      <button class="secondary" id="exWallet">Example: Wallet connect</button>
    </div>
    <div class="hint" style="margin-top:10px;">Tip: use <code>signature: "devskip"</code> in dev for wallet connect.</div>
  </div>

  <div class="card">
    <h3 style="margin-top:0">Response</h3>
    <pre id="out">(no request yet)</pre>
  </div>

<script>
  const $ = (id) => document.getElementById(id);
  const out = (s) => { $("out").textContent = s; };

  function headers() {
    const h = {};
    const uid = $("userId").value.trim();
    const email = $("email").value.trim();
    const org = $("orgId").value.trim();
    const roles = $("roles").value.trim();
    if (uid) h["X-Dev-User-Id"] = uid;
    if (email) h["X-Dev-Email"] = email;
    if (org) h["X-Dev-Org-Id"] = org;
    if (roles) h["X-Dev-Roles"] = roles;
    return h;
  }

  async function send() {
    const base = $("baseUrl").value.trim().replace(/\/$/, "");
    const method = $("method").value;
    const path = $("path").value.trim();
    const url = base + path;
    const h = headers();

    const opts = { method, headers: { ...h } };
    if (method !== "GET") {
      opts.headers["Content-Type"] = "application/json";
      try {
        JSON.parse($("body").value);
      } catch (e) {
        out("Body is not valid JSON: " + e.message);
        return;
      }
      opts.body = $("body").value;
    }

    out("Requesting " + url + " …");
    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch (_) {}
      out("HTTP " + res.status + "\n\n" + pretty);
    } catch (e) {
      out("Request failed: " + e.message);
    }
  }

  function setExample(method, path, body, uid, email, org, roles) {
    $("method").value = method;
    $("path").value = path;
    $("body").value = body;
    if (uid) $("userId").value = uid;
    if (email) $("email").value = email;
    if (org !== undefined) $("orgId").value = org;
    if (roles !== undefined) $("roles").value = roles;
  }

  // defaults
  $("baseUrl").value = window.location.origin;
  setExample("GET", "/v1/me", "{}", "11111111-1111-1111-1111-111111111111", "investor@blockxone.local", "", "");

  $("sendBtn").addEventListener("click", send);
  $("exMe").addEventListener("click", () => setExample(
    "GET", "/v1/me", "{}",
    "11111111-1111-1111-1111-111111111111", "investor@blockxone.local", "", ""
  ));
  $("exOfferings").addEventListener("click", () => setExample(
    "POST", "/v1/offerings",
    JSON.stringify({
      asset_type: "FUND",
      name: "BlockXOne Demo Fund",
      description: "Demo offering",
      chain_id: 137,
      price: "100.00",
      currency: "USD",
      transfer_agent_org_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      tokenisation_agent_org_id: "dddddddd-dddd-dddd-dddd-dddddddddddd"
    }, null, 2),
    "22222222-2222-2222-2222-222222222222", "offering.manager@blockxone.local", "", ""
  ));
  $("exKyc").addEventListener("click", () => setExample(
    "POST", "/v1/kyc/cases",
    JSON.stringify({ type: "KYC" }, null, 2),
    "11111111-1111-1111-1111-111111111111", "investor@blockxone.local", "", ""
  ));
  $("exWallet").addEventListener("click", () => setExample(
    "POST", "/v1/wallets/connect",
    JSON.stringify({
      address: "0x1111111111111111111111111111111111111111",
      chain_id: 137,
      message: "BlockXOne wallet connect (dev)",
      signature: "devskip"
    }, null, 2),
    "11111111-1111-1111-1111-111111111111", "investor@blockxone.local", "", ""
  ));
</script>
</body>
</html>`
