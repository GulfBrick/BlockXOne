import { pathToFileURL } from 'node:url'

function requireCheck(condition, name) {
  if (!condition) throw new Error(`PROBE_FAILED:${name}`)
}
export function validateConfig({baseUrl, supabaseUrl, key, mode, cookie, jwt}, now = Date.now()) {
  const base = new URL(baseUrl)
  requireCheck(base.origin === baseUrl && !base.username && !base.password, 'base_origin')
  requireCheck((base.hostname === 'bx1.co.za' && base.protocol === 'https:') || (['localhost','127.0.0.1'].includes(base.hostname) && base.protocol === 'http:'), 'base_allowlist')
  requireCheck(supabaseUrl === 'https://oqkevkjbkpugjotihtda.supabase.co', 'supabase_project')
  requireCheck(typeof key === 'string' && key.startsWith('sb_publishable_'), 'publishable_key')
  requireCheck(['anonymous','session-replay'].includes(mode), 'mode')
  let claims
  if(mode === 'session-replay') {
    requireCheck(typeof cookie==='string' && cookie.length>10 && !/[\r\n]/.test(cookie) && typeof jwt==='string', 'session_input')
    try { claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) } catch { throw new Error('PROBE_FAILED:jwt_format') }
    requireCheck(Number(claims.exp)*1000 > now+60_000 && typeof claims.sub==='string' && typeof claims.email==='string' && claims.email.length>0, 'unexpired_subject')
  }
  return {baseUrl,supabaseUrl,key,mode,cookie,jwt,claims}
}
export async function runProbe(input, fetcher = fetch) {
  const cfg = validateConfig(input)
  const results=[]
  const record = (name, condition, status) => { requireCheck(condition,name);results.push({name,status,passed:true}) }
  const request = async (url,options={}) => fetcher(url,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15_000),...options})
  const app = (path,options) => request(`${cfg.baseUrl}${path}`,options)
  const rest = (table,token) => request(`${cfg.supabaseUrl}/rest/v1/${table}?select=id&limit=2`,{headers:{apikey:cfg.key,...(token?{Authorization:`Bearer ${token}`}:{})}})
  const privateResponse = response => /private/i.test(response.headers.get('cache-control')||'') && /no-store/i.test(response.headers.get('cache-control')||'')
  if(cfg.mode==='anonymous') {
    const home=await app('/');record('public_home',home.status===200,home.status)
    const login=await app('/login');record('real_login',login.status===200 && (await login.text()).includes('Sign in to BlockXOne'),login.status)
    record('login_cache',privateResponse(login),login.status)
    const workspace=await app('/workspace');record('anonymous_workspace', [303,307,401,403].includes(workspace.status),workspace.status)
    record('workspace_cache',privateResponse(workspace),workspace.status)
    for(const path of ['/api/login','/api/auth/login','/api/auth/signup','/api/auth/user','/api/logout','/register','/admin','/investor']) {
      const response=await app(path);record(`legacy_denied:${path}`,response.status===404,response.status)
    }
    for(const table of ['bx1_profiles','bx1_organisations','bx1_memberships']) {
      const response=await rest(table);record(`anon_rest_denied:${table}`,[401,403].includes(response.status),response.status)
    }
    const enquiry=await app('/request-demo');const body=await enquiry.text()
    record('enquiry_disabled',enquiry.status===200 && /disabled|temporarily unavailable|not currently accepting|not yet enabled/i.test(body),enquiry.status)
  } else {
    const headers={Cookie:cfg.cookie}
    const before=await app('/workspace',{headers});const beforeBody=await before.text()
    record('owned_workspace_before',before.status===200 && beforeBody.includes('Your workspace') && beforeBody.includes(cfg.claims.email),before.status)
    const owned=await rest('bx1_profiles',cfg.jwt);const ownedRows=await owned.json()
    record('owned_rest_before',owned.status===200 && Array.isArray(ownedRows) && ownedRows.length===1 && ownedRows[0].id===cfg.claims.sub,owned.status)
    const logout=await app('/auth/logout',{method:'POST',headers:{...headers,Origin:cfg.baseUrl,'Content-Type':'application/x-www-form-urlencoded'},body:''})
    record('server_logout',logout.status===303 && privateResponse(logout),logout.status)
    requireCheck(Number(cfg.claims.exp)*1000>Date.now(),'replay_still_unexpired')
    const replay=await app('/workspace',{headers});const replayBody=await replay.text()
    record('old_cookie_denied',[303,307,401,403].includes(replay.status) && !replayBody.includes(cfg.claims.email),replay.status)
    for(const table of ['bx1_profiles','bx1_organisations','bx1_memberships']) {
      const response=await rest(table,cfg.jwt)
      const data=await response.json()
      record(`old_jwt_denied:${table}`,[401,403].includes(response.status) || (response.status===200 && Array.isArray(data) && data.length===0),response.status)
    }
  }
  requireCheck(results.length>0,'nonzero_checks')
  return results
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const args=process.argv.slice(2)
    requireCheck(args.length===3 && ['--anonymous','--session-replay'].includes(args[0]) && args[1]==='--base-url','arguments')
    const results=await runProbe({mode:args[0].slice(2),baseUrl:args[2],supabaseUrl:process.env.SUPABASE_URL,key:process.env.SUPABASE_PUBLISHABLE_KEY,cookie:process.env.BX1_AUTH_PROBE_COOKIE,jwt:process.env.BX1_AUTH_PROBE_JWT})
    console.log(JSON.stringify({result:'BX1_HOSTED_AUTH_PROBE_PASS',checks:results.length,results}))
  } catch(error) {
    // Never print upstream response bodies, requests, cookies, JWTs or raw errors.
    console.error(/^PROBE_FAILED:[a-z0-9_:/-]+$/i.test(error.message)?error.message:'PROBE_FAILED:transport_or_response')
    process.exitCode=1
  }
}
