// Reproducible browser suite: official playwright@1.62.1; no sandbox override.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {DEMOS} from '../src/demos.js';
import {verifyAssignments} from '../src/verify.js';
import {solve} from '../src/solver.js';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=new URL('../',import.meta.url),port=4189,url=`http://127.0.0.1:${port}/`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});
let browser,context,page;
const checks=[],errors=[],requests=[],csp=[],captures=[];
let navigationRecovery = null;
const check=async(name,fn)=>{await fn();checks.push(name);console.log(`PASS ${name}`);};
const load=async()=>{await page.goto(url);await page.locator('#solve:enabled').waitFor();};
const choose=async(index)=>{await page.locator('.demo-card').nth(index).click();};
const run=async()=>{await page.locator('#solve').click();await page.locator('#cancel').waitFor({state:'hidden'});};
const importText=async(data)=>{await page.locator('#open-import').click();await page.locator('#json-input').fill(typeof data==='string'?data:JSON.stringify(data));await page.locator('#import-form button[type=submit]').click();};
const importOk=async(data)=>{await importText(data);await page.locator('#import-dialog').waitFor({state:'hidden'});};
const exportJson=async(id)=>{const pending=page.waitForEvent('download');await page.locator(id).click();const download=await pending;return JSON.parse(await readFile(await download.path(),'utf8'));};
const captureStablePage=async(name)=>{
  await page.evaluate(async()=>{
    window.scrollTo({top:0,left:0,behavior:'instant'});
    await document.fonts.ready;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  const captureState=await page.evaluate(()=>{
    const link=document.querySelector('.skip-link'),rect=link.getBoundingClientRect(),style=getComputedStyle(link);
    return {scrollX,scrollY,viewportWidth:innerWidth,viewportHeight:innerHeight,skipLink:{top:rect.top,bottom:rect.bottom,opacity:style.opacity,transform:style.transform,focused:document.activeElement===link}};
  });
  assert.equal(captureState.scrollY,0);
  assert.equal(captureState.skipLink.focused,false);
  assert.equal(captureState.skipLink.opacity,'0');
  assert.ok(captureState.skipLink.bottom<0,JSON.stringify(captureState));
  captures.push({name,...captureState});
  await page.screenshot({path:new URL(`../artifacts/${name}.png`,import.meta.url).pathname,fullPage:true,animations:'disabled'});
};
const dense=()=>({version:1,title:'Synthetic cancellation workload',day:{start:540,end:720,step:15},rooms:[{id:'a',label:'A'},{id:'b',label:'B'}],resources:[{id:'kit',label:'Kit'}],sessions:Array.from({length:8},(_,i)=>({id:`s${i}`,title:`Synthetic ${i}`,duration:15,start:540,roomId:'a',earliestStart:540,latestStart:705,eligibleRoomIds:['a','b'],resourceIds:['kit'],pinned:false})),blackouts:[]});
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited ${code}`)));});
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.exposeFunction('recordCsp',event=>csp.push(event));
  await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>window.recordCsp({directive:e.violatedDirective,blocked:e.blockedURI})));
  await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
  await load();
  await check('synthetic baseline loads without an unsolicited proposal',async()=>{assert.match(await page.locator('#project-title').innerText(),/ものづくり/);assert.equal(await page.locator('#export-proposal').isDisabled(),true);assert.equal(await page.locator('.demo-card').count(),3);});
  await check('room blackout repair yields exact two-session minimum',async()=>{await run();assert.match(await page.locator('#proposal-badge').innerText(),/最適/);assert.match(await page.locator('#metric-count').innerText(),/^2/);assert.match(await page.locator('#metric-shift').innerText(),/^30/);assert.match(await page.locator('#metric-rooms').innerText(),/^2/);});
  await captureStablePage('desktop');
  await check('proposed JSON preserves original baseline and passes independent verification',async()=>{const out=await exportJson('#export-proposal');assert.equal(out.version,1);assert.equal(out.problem.sessions.find(s=>s.id==='photo').start,615);assert.equal(out.proposal.status,'optimal');assert.equal(verifyAssignments(out.problem,out.proposal.assignments).ok,true);assert.equal(out.proposal.objective.changedSessions,2);});
  await check('equipment blackout works across different rooms',async()=>{await choose(1);await run();assert.match(await page.locator('#metric-shift').innerText(),/^120/);assert.match(await page.locator('#metric-rooms').innerText(),/^0/);});
  await check('pinned obstruction reports proven infeasibility and disables export',async()=>{await choose(2);await run();assert.match(await page.locator('#proposal-badge').innerText(),/解なし|配置不可|修復不可|実行不可|実行不能/);assert.equal(await page.locator('#export-proposal').isDisabled(),true);});
  await check('unpinning an obstructed session invalidates results and allows repair',async()=>{const checkbox=page.locator('#session-list input[type=checkbox]').filter({visible:true});const inputs=await checkbox.count();assert.ok(inputs>0);const target=page.getByRole('checkbox',{name:/装置の実演/});await target.uncheck();assert.equal(await page.locator('#export-proposal').isDisabled(),true);await run();assert.match(await page.locator('#proposal-badge').innerText(),/最適/);});
  await check('removing blackout restores zero-change baseline',async()=>{await choose(0);await page.locator('.remove-blackout').first().click();await run();assert.match(await page.locator('#metric-count').innerText(),/^0/);assert.match(await page.locator('#metric-shift').innerText(),/^0/);});
  await check('blackout validation is nonmutating and valid edit invalidates proposal',async()=>{await page.locator('#blackout-start').fill('12:00');await page.locator('#blackout-end').fill('11:00');await page.locator('#add-blackout').click();assert.equal(await page.locator('#blackout-error').isVisible(),true);assert.equal(await page.locator('#export-proposal').isDisabled(),false);await page.locator('#blackout-type').selectOption('room');await page.locator('#blackout-target').selectOption('studio');await page.locator('#blackout-start').fill('10:00');await page.locator('#blackout-end').fill('11:00');await page.locator('#add-blackout').click();assert.equal(await page.locator('#export-proposal').isDisabled(),true);await run();assert.match(await page.locator('#metric-count').innerText(),/^2/);});
  await check('strict invalid JSON leaves current model and valid proposal intact',async()=>{const before=await page.locator('#project-title').innerText();await importText('{"__proto__":{"polluted":true}}');assert.equal(await page.locator('#import-errors').isVisible(),true);assert.equal(await page.locator('#project-title').innerText(),before);assert.equal(await page.locator('#export-proposal').isDisabled(),false);assert.equal(await page.evaluate(()=>({}).polluted),undefined);await page.locator('#import-cancel').click();});
  await check('keyboard Escape cancels import and restores focus',async()=>{await page.locator('#open-import').focus();await page.keyboard.press('Enter');await page.locator('#import-dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#import-dialog').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'open-import');});
  await check('HTML-shaped labels remain inert text',async()=>{const p=structuredClone(DEMOS[0].problem);p.title='<img src=x onerror=alert(1)>';p.sessions[0].title='<svg onload=alert(1)>';await importOk(p);assert.equal(await page.locator('#project-title').innerText(),p.title);assert.equal(await page.locator('img').count(),0);assert.equal(await page.locator('#session-list svg').count(),0);assert.match(await page.locator('#session-list').innerText(),/<svg onload=alert\(1\)>/);});
  await check('baseline download round-trips current normalized input',async()=>{const out=await exportJson('#export-baseline');assert.equal(out.title,'<img src=x onerror=alert(1)>');assert.equal(out.sessions.length,6);await importOk(out);});
  await check('cancelled asynchronous file read cannot alter a reopened dialog',async()=>{
    await page.evaluate(()=>{window.originalFileText=File.prototype.text;File.prototype.text=function(){return new Promise(resolve=>{window.releaseRead=()=>{window.finishedRead=window.originalFileText.call(this).then(resolve);};});};});
    try{await page.locator('#open-import').click();await page.locator('#json-file').setInputFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(DEMOS[1].problem))});await page.waitForFunction(()=>typeof window.releaseRead==='function');await page.locator('#import-cancel').click();await page.locator('#open-import').click();await page.evaluate(async()=>{window.releaseRead();await window.finishedRead;});assert.equal(await page.locator('#json-input').inputValue(),'');assert.equal(await page.locator('#project-title').innerText(),'<img src=x onerror=alert(1)>');await page.locator('#import-cancel').click();}finally{await page.evaluate(()=>{File.prototype.text=window.originalFileText;});}
  });
  await check('real browser worker can be cancelled without claiming an optimum',async()=>{await importOk(dense());await page.locator('#node-budget').selectOption('1000000');await page.locator('#solve').click();await page.locator('#cancel').click();await page.locator('#cancel').waitFor({state:'hidden'});assert.match(await page.locator('#solve-status-text').innerText(),/停止|中断/);assert.doesNotMatch(await page.locator('#proposal-badge').innerText(),/^最適解|^最適$/);});
  await check('stale worker result cannot overwrite a newer selected agenda',async()=>{
    const other=await context.newPage();
    try{await other.addInitScript(()=>{window.workerStubs=[];window.Worker=class{constructor(){this.listeners=[];window.workerStubs.push(this);}postMessage(m){if(m.type==='solve')this.message=m;}terminate(){}addEventListener(type,fn){if(type==='message')this.listeners.push(fn);}fire(result){const event={data:{type:'result',requestId:this.message.requestId,result}};this.onmessage?.(event);this.listeners.forEach(fn=>fn(event));}};});await other.goto(url);await other.locator('#solve:enabled').waitFor();await other.locator('#solve').click();await other.locator('.demo-card').nth(1).click();const result=await solve(DEMOS[0].problem);await other.evaluate(result=>window.workerStubs[0].fire(result),result);assert.match(await other.locator('#project-title').innerText(),/動画制作/);assert.equal(await other.locator('#export-proposal').isDisabled(),true);assert.match(await other.locator('#proposal-badge').innerText(),/未計算/);}finally{await other.close();}
  });
  await check('persisted page transitions clear interrupted work and permit retry',async()=>{
    const other=await context.newPage();
    try{
      await other.addInitScript(()=>{
        window.pendingWorkers=[];
        window.Worker=class {
          constructor(){this.listeners=[];this.terminated=false;window.pendingWorkers.push(this);}
          postMessage(message){if(message.type==='solve')this.message=message;}
          terminate(){this.terminated=true;}
          addEventListener(type,listener){if(type==='message')this.listeners.push(listener);}
          fire(result){this.listeners.forEach(listener=>listener({data:{type:'result',requestId:this.message.requestId,result}}));}
        };
      });
      await other.goto(url);await other.locator('#solve:enabled').waitFor();await other.locator('#solve').click();
      await other.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
      assert.equal(await other.locator('#cancel').isVisible(),false);
      assert.equal(await other.locator('#solve').isEnabled(),true);
      assert.equal(await other.locator('#export-proposal').isDisabled(),true);
      assert.equal(await other.locator('#proposal-badge').innerText(),'未計算');
      assert.equal(await other.locator('#progress').innerText(),'— nodes');
      assert.equal(await other.evaluate(()=>window.pendingWorkers[0].terminated),true);
      await other.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
      assert.match(await other.locator('#solve-status-text').innerText(),/中断.*もう一度/);
      assert.match(await other.locator('#notice').innerText(),/元の予定は保持/);
      await other.evaluate(result=>window.pendingWorkers[0].fire(result),await solve(DEMOS[0].problem));
      assert.equal(await other.locator('#export-proposal').isDisabled(),true);
      await other.locator('#solve').click();
      assert.equal(await other.locator('#cancel').isVisible(),true);
      assert.equal(await other.evaluate(()=>window.pendingWorkers.length),2);
    }finally{await other.close();}
  });
  await check('Back and Forward during a pending solve never restore a stuck exploring state',async()=>{
    const other=await context.newPage();
    try{
      await other.addInitScript(()=>{
        window.pageShowFlags=[];
        window.addEventListener('pageshow',event=>window.pageShowFlags.push(event.persisted));
        window.Worker=class {postMessage(){}terminate(){}addEventListener(){}};
      });
      await other.goto(url);await other.locator('#solve:enabled').waitFor();await other.locator('#solve').click();
      await other.goto('about:blank');
      await other.goBack({waitUntil:'domcontentloaded'});
      await other.locator('#solve:enabled').waitFor();
      const wasBfcache=await other.evaluate(()=>window.pageShowFlags.includes(true));
      const restoredStatus=await other.locator('#solve-status-text').innerText();
      assert.equal(await other.locator('#cancel').isVisible(),false);
      assert.equal(await other.locator('#export-proposal').isDisabled(),true);
      assert.equal(await other.locator('#proposal-badge').innerText(),'未計算');
      assert.doesNotMatch(restoredStatus,/探索しています/);
      if(wasBfcache)assert.match(restoredStatus,/中断/);
      await other.goForward({waitUntil:'domcontentloaded'});
      assert.equal(other.url(),'about:blank');
      await other.goBack({waitUntil:'domcontentloaded'});
      await other.locator('#solve:enabled').waitFor();
      assert.doesNotMatch(await other.locator('#solve-status-text').innerText(),/探索しています/);
      navigationRecovery={actualBackForward:true,bfcacheObserved:wasBfcache,restoredStatus,forcedPersistedEventTest:true};
    }finally{await other.close();}
  });
  await choose(0);await run();
  await check('mobile skip link is fully offscreen until keyboard-focused and activates workspace',async()=>{
    const other=await context.newPage();
    try{
      for(const width of [390,320]){
        await other.setViewportSize({width,height:844});await other.goto(`${url}?skip-width=${width}`);await other.locator('#solve:enabled').waitFor();
        const hiddenRect=await other.locator('.skip-link').evaluate(link=>{const r=link.getBoundingClientRect();return {top:r.top,bottom:r.bottom};});
        assert.ok(hiddenRect.bottom<0,JSON.stringify({width,hiddenRect}));
        assert.equal(await other.locator('.skip-link').evaluate(link=>getComputedStyle(link).opacity),'0');
        await other.keyboard.press('Tab');
        assert.equal(await other.evaluate(()=>document.activeElement.classList.contains('skip-link')),true);
        const focusedRect=await other.locator('.skip-link').boundingBox();
        assert.ok(focusedRect.y>=0 && focusedRect.y+focusedRect.height<=844,JSON.stringify(focusedRect));
        assert.equal(await other.locator('.skip-link').evaluate(link=>getComputedStyle(link).opacity),'1');
        await other.keyboard.press('Enter');
        assert.equal(new URL(other.url()).hash,'#workspace');
        await other.locator('#solve').focus();
        assert.ok(await other.locator('.skip-link').evaluate(link=>link.getBoundingClientRect().bottom<0));
      }
    }finally{await other.close();}
  });
  await check('390px and 320px layouts avoid page-level horizontal overflow',async()=>{for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('#solve').isVisible(),true);}await page.setViewportSize({width:390,height:844});await captureStablePage('mobile');});
  await check('maximum-length text stays contained at 320px',async()=>{const p=structuredClone(DEMOS[0].problem);p.title='T'.repeat(120);p.sessions.forEach(s=>s.title='S'.repeat(120));p.rooms.forEach(r=>r.label='R'.repeat(120));p.resources.forEach(r=>r.label='Q'.repeat(120));await importOk(p);await run();await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);});
  await check('no runtime errors, CSP violations or outbound application requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);assert.ok(requests.every(r=>r.startsWith(url)||r.startsWith('blob:')),JSON.stringify(requests));});
  const report={measuredAt:new Date().toISOString(),chromium:browser.version(),checks,errors,csp,captures,navigationRecovery,network:'No non-local requests observed during real UI flows',viewports:['1440x1100','390x844','320x740'],limitations:'Synthetic Chromium automation only; physical devices, screen readers, other browsers and demand unverified. Worker stale-result and pending-navigation flows use controlled mocks. Persisted page-transition events are also dispatched explicitly; actual Back/Forward BFCache use is recorded separately.'};
  await writeFile(new URL('../docs/browser-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){if(page)await page.screenshot({path:new URL('../artifacts/failure.png',import.meta.url).pathname,fullPage:true}).catch(()=>{});throw error;}
finally{server.kill();if(browser)await browser.close();}
