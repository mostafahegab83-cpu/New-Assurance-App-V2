import asyncio, json, csv, io
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
OUT=Path('/tmp/browser/records-month')
OUT.mkdir(parents=True, exist_ok=True)
MOCK='''
export const ADMIN_EMAILS=['local-admin@example.test']; export const VIEWER_EMAILS=[];
export const db={},storage={}; export const auth={currentUser:null};
const stores={compliance_records:new Map()}, listeners=[], authListeners=[];
window.__testWrites=[];
const snap=c=>({forEach:cb=>snap(c).docs.forEach(cb),docs:[...(stores[c]||new Map()).entries()].map(([id,data])=>({id,data:()=>structuredClone(data)}))});
const emit=c=>listeners.filter(x=>x.c===c).forEach(x=>x.cb(snap(c)));
export const collection=(db,c)=>({c}); export const doc=(db,c,id)=>({c,id});
export const query=r=>r; export const orderBy=(...a)=>a; export const limit=(...a)=>a;
export const serverTimestamp=()=> 'mock-timestamp';
export function onSnapshot(r,cb){const x={c:r.c,cb};listeners.push(x);queueMicrotask(()=>cb(snap(r.c)));return ()=>listeners.splice(listeners.indexOf(x),1);}
export const getDoc=async r=>({exists:()=>!!stores[r.c]?.has(r.id),data:()=>stores[r.c]?.get(r.id)});
export async function setDoc(r,v){if(!stores[r.c])stores[r.c]=new Map();stores[r.c].set(r.id,structuredClone(v));window.__testWrites.push({c:r.c,id:r.id,op:'set'});emit(r.c);}
export async function deleteDoc(r){stores[r.c]?.delete(r.id);window.__testWrites.push({c:r.c,id:r.id,op:'delete'});emit(r.c);}
let seq=0;export async function addDoc(r,v){const id='mock-added-'+(++seq);await setDoc({c:r.c,id},v);return {id};}
export function writeBatch(){const ops=[];return {set:(r,v)=>ops.push(()=>setDoc(r,v)),delete:r=>ops.push(()=>deleteDoc(r)),commit:async()=>{for(const f of ops)await f();}};}
export function onAuthStateChanged(a,cb){authListeners.push(cb);setTimeout(()=>cb(auth.currentUser),0);return ()=>{};}
export async function signInWithEmailAndPassword(a,email,p){auth.currentUser={email,uid:'local-test-admin'};for(const cb of authListeners)await cb(auth.currentUser);}
export async function signOut(){auth.currentUser=null;for(const cb of authListeners)await cb(null);}
export const sendPasswordResetEmail=async()=>{};
export const ref=(s,p)=>({path:p});export const uploadBytes=async()=>{};export const getDownloadURL=async()=> 'https://example.test/mock-file';export const deleteObject=async()=>{};
window.__testRead=()=>[...stores.compliance_records.values()].map(v=>structuredClone(v));
window.__testSeed=rows=>{stores.compliance_records=new Map(rows.map(r=>[r.id,structuredClone(r)]));emit('compliance_records');};
'''
def record(id,date,name='Billing',dept='Finance',step='1'):
    return dict(id=id,auditId=id,auditDate=date,processName=name,processOwner=dept,userName='Reviewer',processPhase='Prepare',riskExist='Yes',riskId='Risk-'+id,stepNumber=step,createdAt='2026-01-01T00:00:00.000Z',attachments=[],department='Owner One',ncResponsibleDept='Owner Two',actionOwner='Owner Three')
DATA=[record('a','2026-09-20'),record('b','2026-09-30',step='2'),record('c','2026-10-01'),record('d','2026-09-01','Hiring','HR'),record('e','N/A','Legacy'),record('f','2026-02-30','Invalid')]
DATA[0]['attachments']=[dict(name='evidence.pdf',url='https://example.test/evidence.pdf',size=123)]
async def run(p,zone,mobile=False):
    browser=await p.chromium.launch(headless=True)
    ctx=await browser.new_context(viewport={'width':390,'height':844} if mobile else {'width':1280,'height':1800},timezone_id=zone,ignore_https_errors=True,accept_downloads=True)
    page=await ctx.new_page();errors=[];failed=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    async def route_handler(route):
        u=route.request.url
        if u.startswith('http://localhost:8099/'):
            if u.split('?')[0].endswith('/firebase.js'):await route.fulfill(status=200,content_type='text/javascript',body=MOCK)
            else:await route.continue_()
        elif any(x in u for x in ['firebase','googleapis','gstatic']):
            failed.append('blocked Firebase network');await route.abort()
        else:await route.continue_()
    await ctx.route('**/*',route_handler)
    await page.goto('http://localhost:8099/',wait_until='networkidle')
    await page.locator('#loginEmail').fill('local-admin@example.test');await page.locator('#loginPassword').fill('local-test-only')
    await page.locator('#loginForm button[type=submit]').click()
    await page.wait_for_function("document.getElementById('loginOverlay').style.display==='none'")
    await page.evaluate('(rows)=>window.__testSeed(rows)',DATA)
    await page.get_by_role('tab',name='Review',exact=True).click();await page.locator('#audit [data-sub=records]').click()
    async def count(n):await page.wait_for_function('(n)=>document.getElementById("reviewedProcessesCount").textContent===String(n)',arg=n)
    async def ids():return await page.locator('#recordsTable tbody [data-edit]').evaluate_all('(els)=>els.map(e=>e.dataset.edit)')
    await count(4);assert await ids()==['a','b','c','d','e','f']
    opts=await page.locator('#recFilterMonth option').evaluate_all('(els)=>els.map(e=>[e.value,e.textContent])')
    assert opts==[['','All Months'],['2026-10','October 2026'],['2026-09','September 2026']],opts
    initial=await page.evaluate('window.__testRead()')
    await page.locator('#recFilterMonth').select_option('2026-09');await count(2);assert await ids()==['a','b','d']
    assert '2026-09-30' in await page.locator('#recordsTable tbody').inner_text()
    await page.locator('#records .filters').screenshot(path=str(OUT/('mobile-filters.png' if mobile else zone.replace('/','-')+'-filters.png')))
    await page.locator('#recFilterDepartment').fill('Finance');await count(1);assert await ids()==['a','b']
    await page.locator('#recFilterDepartment').fill('')
    await page.locator('#recFilterProcess').evaluate("el=>{Array.from(el.options).forEach(o=>o.selected=o.value==='Billing');el.dispatchEvent(new Event('change',{bubbles:true}));el._msRefresh?.();}")
    await count(1);assert await ids()==['a','b']
    await page.locator('#recFilterDepartment').fill('HR');await count(0);assert await ids()==[]
    await page.locator('#recClearFilters').click();await count(4);assert await ids()==['a','b','c','d','e','f']
    assert await page.locator('#recFilterMonth').input_value()==''
    assert await page.evaluate('window.__testRead()')==initial
    assert await page.evaluate('window.__testWrites.length')==0
    if mobile:
        box=await page.locator('#records .reviewed-processes').bounding_box();assert box['x']>=0 and box['x']+box['width']<=390
        assert not errors,errors
        print(zone,'mobile: controls fit; filtering, counter and clear passed');await browser.close();return
    # Actual CSV parser -> mapping -> normalization -> batch writes -> snapshot -> UI
    text='id,Review Date,Process Name,Department,Action Owner,Action Owner,Action Owner\nnew,30/09/2026,Procurement,Operations,Task Owner,Nc Owner,Capa Owner\na,21/09/2026,Billing,Finance,Owner One,Owner Two,Owner Three\n'
    await page.locator('#recFilterMonth').select_option('2026-09')
    await page.locator('#fileImport').set_input_files({'name':'controlled.csv','mimeType':'text/csv','buffer':text.encode()})
    await page.get_by_role('button',name='Create 1 · Update 1',exact=True).click()
    await page.get_by_role('heading',name='Import complete',exact=True).wait_for();await page.get_by_role('button',name='OK',exact=True).click()
    await count(3);assert await ids()==['a','b','d','new']
    current=await page.evaluate('window.__testRead()');a=next(r for r in current if r['id']=='a');new=next(r for r in current if r['id']=='new')
    assert a['auditDate']=='2026-09-21' and a['createdAt']==DATA[0]['createdAt'] and a['attachments']==DATA[0]['attachments']
    assert new['auditDate']=='2026-09-30';assert [new[k] for k in ['department','ncResponsibleDept','actionOwner']]==['Task Owner','Nc Owner','Capa Owner']
    # Unchanged export scope; parse actual browser download and reimport existing IDs.
    await page.locator('#recClearFilters').click()
    async with page.expect_download() as dl:await page.locator('#btnExport').click()
    download=await dl.value;path=OUT/(zone.replace('/','-')+'-export.csv');await download.save_as(path)
    exported=list(csv.reader(io.StringIO(path.read_text(encoding='utf-8-sig'))))
    owners=[i for i,h in enumerate(exported[0]) if h=='Action Owner'];assert len(owners)==3
    exportednew=next(r for r in exported[1:] if r[0]=='new');assert [exportednew[i] for i in owners]==['Task Owner','Nc Owner','Capa Owner']
    await page.locator('#fileImport').set_input_files(str(path))
    await page.get_by_role('heading',name='Import stopped — please fix these values').wait_for() # source legacy invalid date remains invalid
    assert '2026-02-30' in await page.locator('body').inner_text();await page.get_by_role('button',name='Close',exact=True).click()
    # A controlled valid export subset roundtrip.
    valid=[r for r in exported[1:] if r[0] not in ['e','f']];out=io.StringIO();writer=csv.writer(out);writer.writerow(exported[0]);writer.writerows(valid)
    await page.locator('#fileImport').set_input_files({'name':'valid-export.csv','mimeType':'text/csv','buffer':out.getvalue().encode()})
    await page.get_by_role('button',name='Keep existing values',exact=True).click()
    await page.get_by_role('button',name='Create 0 · Update 5',exact=True).click()
    await page.get_by_role('heading',name='Import complete',exact=True).wait_for();await page.get_by_role('button',name='OK',exact=True).click()
    assert len(await page.evaluate('window.__testRead()'))==7
    # Invalid incoming date prevents even the valid row from saving.
    before=await page.evaluate('window.__testRead()');wc=await page.evaluate('window.__testWrites.length')
    await page.locator('#fileImport').set_input_files({'name':'invalid.csv','mimeType':'text/csv','buffer':b'id,Review Date,Process Name\nbad,2026-09-31,Invalid\ngood,2026-09-22,Valid\n'})
    await page.get_by_role('heading',name='Import stopped — please fix these values').wait_for()
    report=await page.locator('body').inner_text();assert '2026-09-31' in report and 'Review Date' in report
    assert await page.evaluate('window.__testWrites.length')==wc and await page.evaluate('window.__testRead()')==before
    await page.get_by_role('button',name='Close',exact=True).click()
    # Edit through the real review form and save; moves process to October.
    await page.locator('#recFilterMonth').select_option('2026-09');await count(3)
    await page.locator('[data-edit=new]').click();assert await page.locator('#auditDate').input_value()=='2026-09-30'
    await page.locator('#auditDate').fill('2026-10-01');await page.get_by_role('button',name='Save Record',exact=True).click()
    await count(2);assert 'new' not in await ids()
    await page.locator('#recFilterMonth').select_option('2026-10');await count(2);assert await ids()==['c','new']
    page.once('dialog',lambda dialog:dialog.accept());await page.locator('[data-del=new]').click();await count(1);assert await ids()==['c']
    # Add via form then delete the last record in a selected month. Never clears silently.
    await page.locator('#audit [data-sub=form]').click();await page.locator('#auditDate').fill('2026-11-01');await page.locator('#processName').fill('New Process');await page.locator('#processOwner').fill('Operations')
    await page.get_by_role('button',name='Save Record',exact=True).click()
    await page.locator('#recFilterMonth option[value="2026-11"]').wait_for(state='attached')
    await page.locator('#recFilterMonth').select_option('2026-11');await count(1)
    added=(await ids())[0];page.once('dialog',lambda dialog:dialog.accept());await page.locator(f'[data-del="{added}"]').click();await count(0)
    assert await page.locator('#recFilterMonth').input_value()=='2026-11'
    await page.locator('#recClearFilters').click();await count(4)
    # Backup/restore against the isolated mock only; restores exact record objects.
    backup_before=await page.evaluate('window.__testRead()')
    page.on('dialog',lambda dialog:dialog.accept('YES') if dialog.type=='prompt' else dialog.accept())
    await page.locator('#btnClearAll').click();await count(0)
    await page.locator('#btnRestoreBackup').wait_for(state='visible')
    await page.wait_for_function("!document.getElementById('btnRestoreBackup').disabled")
    await page.locator('#btnRestoreBackup').click();await count(4)
    restored=await page.evaluate('window.__testRead()')
    assert sorted(restored,key=lambda r:r['id'])==sorted(backup_before,key=lambda r:r['id'])
    # Existing exact Review Date filter in NC/Risk.
    await page.get_by_role('tab',name='NC/Risk & CAPA',exact=True).click()
    await page.locator('#ncrc [data-sub=\"sub-risk\"]').click()
    await page.locator('#ncrcRiskAuditDate').fill('2026-09-21')
    assert await page.locator('#ncrcRiskAuditDate').input_value()=='2026-09-21'
    assert await page.locator('#ncrcRiskTable tbody tr').count()==1
    assert '2026-09-21' in await page.locator('#ncrcRiskTable tbody').inner_text()
    # Existing module navigation remains functional.
    for name in ['NC/Risk & CAPA','Dashboard','Document Control','Process Inventory','Gap Analysis','Process Map']:
        await page.get_by_role('tab',name=name,exact=True).click()
    await page.get_by_role('tab',name='Review',exact=True).click();await page.locator('#audit [data-sub=records]').click()
    await page.screenshot(path=str(OUT/(zone.replace('/','-')+'-records.png')))
    assert not errors,errors
    assert not failed,failed
    print(zone,'desktop: month boundaries, all filters AND, distinct count, clear, no mutation, actual import/update/export/valid roundtrip/invalid blocking/edit/add/delete/live snapshot refresh, backup/restore exact roundtrip, existing NC/Risk date input and module navigation passed; no JS console errors; zero live Firebase requests')
    await browser.close()
async def main():
    async with async_playwright() as p:
        for zone in ['America/Los_Angeles','Pacific/Auckland']:await run(p,zone)
        await run(p,'America/Los_Angeles',True)
asyncio.run(main())
