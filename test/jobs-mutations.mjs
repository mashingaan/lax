import { readFileSync,writeFileSync,mkdtempSync,cpSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
const mutants=[
 ['submit retries 5xx','body === undefined && response.status >= 500','response.status >= 500'],
 ['ignore DID','!/^did:[a-z0-9]+:\\S+$/.test(input.agent_did)','false'],
 ['wrong retry cap','Math.min(30000, seconds * 1000)','Math.min(300000, seconds * 1000)'],
 ['wrong attempt limit','index < retries','index < 0'],
 ['wrong HTTP mapping',"status === 404 ? 'not_found'","status === 404 ? 'server'"],
 ['wrong query limit','filter.limit > 100','filter.limit > 1000'],
 ['wrong endpoint','/submissions','/bids'],
 ['lose received status','received?.status ?? 0','0']
]
const source=readFileSync('dist/jobs.js','utf8')
for(const [name,before,after] of mutants) {
 assert.ok(source.includes(before),'Missing mutation target '+name)
 const dir=mkdtempSync(join(tmpdir(),'lax-jobs-mutant-'))
 try {
  for(const path of ['dist','src','test','package.json']) cpSync(path,join(dir,path),{recursive:true})
  writeFileSync(join(dir,'dist/jobs.js'),source.replace(before,after))
  const syntax=spawnSync(process.execPath,['--check',join(dir,'dist/jobs.js')],{encoding:'utf8'})
  assert.equal(syntax.status,0,syntax.stderr)
  const env={...process.env,LAX_LIVE:'0'}
  const result=spawnSync(process.execPath,['--test','test/jobs.test.mjs'],{cwd:dir,encoding:'utf8',env,timeout:15000})
  assert.equal(result.error,undefined,name)
  assert.ok(result.status>0,name+' survived')
  assert.ok(/AssertionError|ERR_ASSERTION/.test(result.stdout),name+' must reach an assertion')
  assert.ok(!/SyntaxError|ERR_MODULE_NOT_FOUND/.test(result.stdout+result.stderr),name+' failed to execute')
  console.log('Killed: '+name)
 } finally {rmSync(dir,{recursive:true,force:true})}
}
