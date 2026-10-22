import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
OUT=Path('/tmp/browser/process-search')
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
DATA=[record('a','2026-09-20'),record('b','2026-09-30',step='2'),record('c','2026-10-01'),record('d','2026-09-01','Hiring','HR'),record('e','2026-09-05','Blood Bank El-Khair','Lab'),record('f','2026-10-02','Care-Clinic Branch','Lab')]
async def run(p,zone):
    browser=await p.chromium.launch(headless=True)
    ctx=await browser.new_context(viewport={'width':1280,'height':1800},timezone_id=zone,ignore_https_errors=True)
    page=await ctx.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    async def route_handler(route):
        u=route.request.url
        if u.startswith('http://localhost:8099/'):
            if u.split('?')[0].endswith('/firebase.js'):await route.fulfill(status=200,content_type='text/javascript',body=MOCK)
            else:await route.continue_()
        elif 'firebase' in u or 'googleapis' in u:await route.abort()
        else:await route.continue_()
    await ctx.route('**/*',route_handler)
    await page.goto('http://localhost:8099/',wait_until='networkidle')
    await page.locator('#loginEmail').fill('local-admin@example.test');await page.locator('#loginPassword').fill('local-test-only')
    await page.locator('#loginForm button[type=submit]').click()
    await page.wait_for_function("document.getElementById('loginOverlay').style.display==='none'")
    await page.evaluate('(rows)=>window.__testSeed(rows)',DATA)
    await page.get_by_role('tab',name='Review',exact=True).click();await page.locator('#audit [data-sub=records]').click()
    await page.wait_for_function("document.querySelectorAll('#recordsTable tbody tr').length>0")
    wrap=page.locator('#recFilterProcess').locator('..')
    btn=wrap.locator('.ms-btn'); search=wrap.locator('.ms-search input')
    await btn.click()
    await search.wait_for()
    # 1) search box present, initially empty
    assert await search.input_value()=='' ,'search should start empty'
    # 2) type to filter: "care" matches only Care-Clinic
    await search.fill('care')
    opts=await wrap.locator('.ms-opt span').all_text_contents()
    assert opts==['Care-Clinic Branch'],opts
    # 3) case-insensitive
    await search.fill('BLOOD')
    opts=await wrap.locator('.ms-opt span').all_text_contents()
    assert opts==['Blood Bank El-Khair'],opts
    # 3b) focus retained while typing (panel re-renders on each keystroke)
    focus=await page.evaluate("document.activeElement?.classList?.contains==='function' ? false : !!document.activeElement.closest('.ms-search')")
    assert focus,'search should keep focus after re-render'
    # 4) select via search, panel closes (existing behavior), filter applies
    await wrap.locator('.ms-opt input').click()
    await page.wait_for_function("document.getElementById('reviewedProcessesCount').textContent==='1'")
    label=await wrap.locator('.ms-label').text_content()
    assert label=='Blood Bank El-Khair',label
    rows=await page.locator('#recordsTable tbody [data-edit]').evaluate_all('(els)=>els.map(e=>e.dataset.edit)')
    assert rows==['e'],rows
    # 5) reopen: search reset, all options visible
    await btn.click()
    assert await search.input_value()=='' ,'search resets when reopened'
    assert await wrap.locator('.ms-opt').count()==4,'all options visible after reopen'
    # 6) no matches message
    await search.fill('zzz')
    empty=await wrap.locator('.ms-empty').text_content()
    assert empty=='No matches',empty
    # 7) typing again recovers matches
    await search.fill('clinic')
    opts=await wrap.locator('.ms-opt span').all_text_contents()
    assert opts==['Care-Clinic Branch'],opts
    # 8) Select all respects the active search (selects only visible matches)
    await wrap.locator('button[data-act=none]').click()
    await wrap.locator('button[data-act=all]').click()
    label=await wrap.locator('.ms-label').text_content()
    assert label=='Care-Clinic Branch',label
    rows=await page.locator('#recordsTable tbody [data-edit]').evaluate_all('(els)=>els.map(e=>e.dataset.edit)')
    assert rows==['f'],rows
    await wrap.locator('button[data-act=none]').click()
    await page.wait_for_function("document.getElementById('reviewedProcessesCount').textContent==='4'")
    await btn.click()  # close the panel so it no longer covers the buttons below
    await page.locator('#recClearFilters').click()
    # 9) Dashboard process multi-select also has search
    await page.get_by_role('tab',name='Dashboard',exact=True).click()
    await page.wait_for_function("document.querySelectorAll('.kpi').length>0",timeout=15000)
    dwrap=page.locator('#filterProcess').locator('..')
    await dwrap.locator('.ms-btn').click()
    dsearch=dwrap.locator('.ms-search input')
    await dsearch.fill('hiring')
    opts=await dwrap.locator('.ms-opt span').all_text_contents()
    assert opts==['Hiring'],opts
    assert not errors,errors
    print(zone,': PASS - search filters, focus retention, no-match, reset, select-all scoped to search, dashboard search, no console errors')
    await browser.close()
async def main():
    async with async_playwright() as p:
        for zone in ['UTC','America/Los_Angeles','Pacific/Auckland']:
            await run(p,zone)
asyncio.run(main())
