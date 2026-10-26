import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createJobsClient, LaxJobsError } from '../dist/index.js'
const job = {id:'test',title:'test job'}
const submission = {id:'sub',job_id:'test',status:'received',created_at:'2026-10-26T00:00:00Z'}
const input = {builder:'Agent',contact:'contact',agent_did:'did:example:agent',payout_address:'0x'+'ab'.repeat(20),repo_or_patch_url:'https://example.com/repo',notes:'evidence'}
const json = (body,status=200,headers={}) => new Response(JSON.stringify(body),{status,headers})
const failure = (code,status) => error => error instanceof LaxJobsError && error.code===code && error.status===status

test('A1 methods, encoding, filters, envelopes and JSON body',async()=>{
 const calls=[]
 const answers=[json({jobs:[job],count:1}),json({job}),json({submission},201)]
 const client=createJobsClient({baseUrl:'https://example.com/api/',fetch:async(...args)=>{calls.push(args)
  return answers.shift()}})
 assert.deepEqual(await client.listJobs({track:'x y',offset:0,limit:1}),{jobs:[job],count:1})
 assert.deepEqual(await client.getJob('a/b ?#'),job)
 assert.deepEqual(await client.submit('a/b',input),submission)
 assert.equal(calls[0][0],'https://example.com/api/jobs?track=x+y&limit=1&offset=0')
 assert.equal(calls[1][0],'https://example.com/api/jobs/a%2Fb%20%3F%23')
 assert.equal(calls[2][0],'https://example.com/api/jobs/a%2Fb/submissions')
 assert.equal(calls[2][1].method,'POST')
 assert.equal(calls[2][1].headers['content-type'],'application/json')
 assert.deepEqual(JSON.parse(calls[2][1].body),input)
})
test('A1 no default query parameters and independent clients',async()=>{
 let url
 const c=createJobsClient({fetch:async u=>{url=u
  return json({jobs:[],count:0})}})
 await c.listJobs()
 assert.equal(url,'https://lax.kognai.ai/registry/jobs')
})
test('A2 status mappings preserve registry message and never retry',async()=>{
 for(const [status,code] of [[400,'bad_request'],[404,'not_found'],[409,'conflict'],[403,'bad_request']]) {
  for(const method of ['listJobs','getJob','submit']) {
   let calls=0
   const c=createJobsClient({fetch:async()=>{calls++
    return json({error:'registry detail'},status)},sleep:async()=>assert.fail('unexpected retry')})
   await assert.rejects(c[method](...(method==='submit'?['id',input]:method==='getJob'?['id']:[])),e=>failure(code,status)(e)&&e.message==='registry detail')
   assert.equal(calls,1)
  }
 }
})
test('A3 Retry-After seconds, cap, zero and fallback, including submit',async()=>{
 for(const method of ['getJob','submit']) {
  for(const [header,expected] of [['2',2000],['9999',30000],['0',0],['bad',500],['-2',500]]) {
   let count=0
   const sleeps=[]
   const c=createJobsClient({fetch:async()=>count++===0?json({error:'busy'},429,{'Retry-After':header}):json(method==='getJob'?{job}:{submission}),sleep:async ms=>sleeps.push(ms)})
   await c[method](...(method==='getJob'?['id']:['id',input]))
   assert.deepEqual(sleeps,[expected])
   assert.equal(count,2)
  }
 }
})
test('A3 exhaustion counts extra attempts and doubles backoff',async()=>{
 let count=0
 const sleeps=[]
 const c=createJobsClient({fetch:async()=>{count++
  return json({error:'still limited'},429)},sleep:async ms=>sleeps.push(ms)})
 await assert.rejects(c.getJob('id'),failure('rate_limited',429))
 assert.equal(count,3)
 assert.deepEqual(sleeps,[500,1000])
})
test('A4 reads retry 5xx and network failures, submits never do',async()=>{
 for(const status of [500,503,599,0]) {
  for(const method of ['getJob','listJobs','submit']) {
   let count=0
   const c=createJobsClient({fetch:async()=>{count++
    if(!status) throw new Error('private network URL must not leak')
    return json({error:'server'},status)},sleep:async()=>{}})
   await assert.rejects(c[method](...(method==='submit'?['id',input]:method==='getJob'?['id']:[])),failure(status?'server':'network',status))
   assert.equal(count,method==='submit'?1:3)
  }
 }
})
test('A4 timeout covers uncooperative fetch and slow body without hanging',async()=>{
 for(const [fetch,status] of [[()=>new Promise(()=>{}),0],[async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}),200]]) {
  const c=createJobsClient({fetch,timeoutMs:10,retries:0})
  await assert.rejects(c.getJob('id'),failure('network',status))
 }
})

test('A2 received error status survives a body timeout and never retries 400',async()=>{
 let calls=0
 const c=createJobsClient({timeoutMs:5,fetch:async()=>{calls++
  return {ok:false,status:400,headers:new Headers(),json:()=>new Promise(()=>{})}},sleep:async()=>assert.fail('400 cannot retry')})
 await assert.rejects(c.getJob('id'),failure('bad_request',400))
 assert.equal(calls,1)
})
test('A3 Retry-After and status survive an unreadable 429 response body',async()=>{
 let calls=0
 const delays=[]
 const c=createJobsClient({timeoutMs:5,fetch:async()=>{
  calls++
  return calls===1?{ok:false,status:429,headers:new Headers({'Retry-After':'0.25'}),json:()=>new Promise(()=>{})}:json({submission})
 },sleep:async ms=>delays.push(ms)})
 assert.deepEqual(await c.submit('id',input),submission)
 assert.equal(calls,2)
 assert.deepEqual(delays,[250])
})
test('A4 concurrent calls keep retries, bodies and response errors independent',async()=>{
 const counts=new Map()
 const c=createJobsClient({fetch:async url=>{
  const id=url.split('/').pop()
  counts.set(id,(counts.get(id)??0)+1)
  if(id==='slow'&&counts.get(id)===1) return json({error:'temporary'},503)
  return json({job:{id}})
 },sleep:async()=>{}})
 assert.deepEqual((await Promise.all(['slow','fast'].map(id=>c.getJob(id)))).map(job=>job.id),['slow','fast'])
 assert.equal(counts.get('slow'),2)
 assert.equal(counts.get('fast'),1)
})
test('A5 invalid submit values are rejected without I/O',async()=>{
 for(const bad of [undefined,null,{...input,agent_did:''},{...input,agent_did:'did::x'},{...input,agent_did:'did:example:'},{...input,payout_address:'0xabc'},{...input,repo_or_patch_url:'http://example.com'},{...input,repo_or_patch_url:'not a url'}]) {
  const c=createJobsClient({fetch:async()=>assert.fail('must validate first')})
  await assert.rejects(c.submit('id',bad),failure('invalid_input',0))
 }
})
test('A5 filter bounds and bad IDs rejected before fetch',async()=>{
 const c=createJobsClient({fetch:async()=>assert.fail('unexpected request')})
 for(const f of [{limit:0},{limit:101},{limit:1.5},{offset:-1},{offset:Infinity},null]) await assert.rejects(c.listJobs(f),failure('invalid_input',0))
 for(const id of ['',null,undefined,'\ud800']) await assert.rejects(c.getJob(id),failure('invalid_input',0))
})
test('A6 zero new runtime dependencies and no console output',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
 assert.deepEqual(pkg.dependencies,{})
 const source=await readFile(new URL('../src/jobs.ts',import.meta.url),'utf8')
 assert.doesNotMatch(source,/console\s*\./)
 const c=createJobsClient({fetch:async()=>json({job})})
 await c.getJob('id')
})
test('A7 live GET jobs is explicit opt-in', {skip:process.env.LAX_LIVE!=='1'},async()=>{
 const result=await createJobsClient().listJobs({limit:1})
 assert.ok(Array.isArray(result.jobs))
 assert.ok(Number.isInteger(result.count))
})
test('Malformed success envelopes and JSON are typed errors with no retries',async()=>{
 for(const [method,payload] of [['listJobs',{jobs:null,count:0}],['listJobs',{jobs:[],count:-1}],['getJob',{job:null}],['submit',{submission:{id:1}}]]) {
  const c=createJobsClient({fetch:async()=>json(payload)})
  await assert.rejects(c[method](...(method==='submit'?['id',input]:method==='getJob'?['id']:[])),failure('invalid_response',200))
 }
 const c=createJobsClient({fetch:async()=>new Response('{broken')})
 await assert.rejects(c.getJob('id'),failure('invalid_response',200))
})
