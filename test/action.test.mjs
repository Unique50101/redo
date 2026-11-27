import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
const execute = promisify(execFile);
const fixture = JSON.parse(readFileSync(new URL('vscode.json',import.meta.url)));
test('Action maintains one PR comment through signing, pushing and retrying', async t => {
  const dir = await mkdtemp(join(tmpdir(),'redo-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const eventPath = join(dir,'event.json');
  await writeFile(eventPath,JSON.stringify({pull_request:{number:17}}));
  let head = fixture.base;
  const comments = [];
  let writes = 0;
  const server = createServer(async (req,res)=>{
    const path = req.url.split('?')[0].replace('/repos/demo/redo','');
    let result;
    if (req.method === 'GET') {
      if(path === '/pulls/17') result = {head:{sha:head},state:'open'};
      else if(path === '/issues/17/comments') result = comments;
      else if(path.startsWith('/compare/')) result = fixture;
      else if(path.startsWith('/collaborators/')) result = {permission:path.includes('/tester/')?'write':'read'};
    } else {
      const chunks = [];
      for await(const chunk of req) chunks.push(chunk);
      const {body} = JSON.parse(Buffer.concat(chunks));
      writes++;
      if(req.method==='POST' && path==='/issues/17/comments') comments.push({body,id:1,user:{login:'github-actions[bot]'}});
      else if(req.method==='PATCH' && path==='/issues/comments/1') comments[0].body=body;
      else throw Error('Unexpected write');
      result={};
    }
    res.writeHead(result?200:404);res.end(JSON.stringify(result));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const checks = ['sessions','terminal'].map(id=>({id,label:id,paths:['src/vs/workbench/contrib/'+id+'/**']}));
  const env = {...process.env,GITHUB_API_URL:'http://127.0.0.1:'+server.address().port,GITHUB_REPOSITORY:'demo/redo',
    GITHUB_EVENT_PATH:eventPath,INPUT_CHECKS:JSON.stringify(checks),INPUT_TOKEN:'mock'};
  const run = ()=>execute(process.execPath,['action.mjs'],{env});
  await run();
  const commands=comments[0].body.split('\n').filter(s=>s.startsWith('/redo'));
  assert.equal(commands.length,2);
  const sign=(body,login)=>comments.push({body,user:{login},html_url:'https://github.com/demo/redo/pull/17#issuecomment-'+comments.length});
  sign(commands[0],'guest');
  await run();
  assert.equal(writes,1);
  for(const body of commands) sign(body,'tester');
  await run();
  assert.equal(comments[0].body.match(/\*\*Passed\*\*/g).length,2);
  head=fixture.head;
  await run();
  assert.match(comments[0].body,/sessions \| \*\*Redo\*\*/);
  assert.match(comments[0].body,/terminal \| \*\*Passed\*\*/);
  await run();
  assert.equal(writes,3);
});
