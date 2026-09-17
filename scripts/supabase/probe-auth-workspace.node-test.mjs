import test from 'node:test'
import assert from 'node:assert/strict'
import {runProbe,validateConfig} from './probe-auth-workspace.mjs'
const base={baseUrl:'https://bx1.co.za',supabaseUrl:'https://oqkevkjbkpugjotihtda.supabase.co',key:'sb_publishable_fixture',mode:'anonymous'}
const jwt=(claims)=>`fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`
test('only named production or loopback origins and exact Supabase project',()=>{
  for(const baseUrl of ['https://evil.example','https://bx1.co.za.evil.example','http://bx1.co.za','https://bx1.co.za/path','https://u:p@bx1.co.za']) assert.throws(()=>validateConfig({...base,baseUrl}))
  assert.throws(()=>validateConfig({...base,supabaseUrl:'https://other.supabase.co'}))
  assert.throws(()=>validateConfig({...base,key:'sb_secret_never'}))
  assert.equal(validateConfig(base).mode,'anonymous')
})
test('session mode requires explicitly supplied unexpired identity and cookie',()=>{
  assert.throws(()=>validateConfig({...base,mode:'session-replay'}),/session_input/)
  assert.throws(()=>validateConfig({...base,mode:'session-replay',cookie:'private-cookie-fixture',jwt:jwt({sub:'id',email:'fixture@example.test',exp:1})}),/unexpired_subject/)
})
test('cannot pass missing login even if homepage is up; raw content stays out of errors',async()=>{
  await assert.rejects(runProbe(base,async url=>new Response('RAW_PRIVATE_FIXTURE',{status:url.endsWith('/login')?404:200})),error=>error.message==='PROBE_FAILED:real_login' && !error.message.includes('RAW_PRIVATE'))
})
test('cannot count an anonymous empty REST table with granted read as access denial',async()=>{
  await assert.rejects(runProbe(base,async url=>{
    if(url.includes('/rest/')) return Response.json([])
    if(url==='https://bx1.co.za/login') return new Response('Sign in to BlockXOne',{headers:{'cache-control':'private, no-store'}})
    if(url.endsWith('/workspace'))return new Response(null,{status:307,headers:{'cache-control':'private, no-store'}})
    if(url==='https://bx1.co.za/')return new Response('public')
    return new Response(null,{status:404})
  }),/anon_rest_denied/)
})
test('actual positive ownership must precede a replay success',async()=>{
  const input={...base,mode:'session-replay',cookie:'private-cookie-fixture',jwt:jwt({sub:'id',email:'fixture@example.test',exp:Math.floor(Date.now()/1000)+3600})}
  await assert.rejects(runProbe(input,async()=>new Response(null,{status:307})),/owned_workspace_before/)
})
