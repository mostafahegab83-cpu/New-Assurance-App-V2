"""Actual app integration with local file interception and an isolated Firebase mock."""
import ast
import asyncio
import mimetypes
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path('/tmp/browser/process-count')
OUT.mkdir(parents=True, exist_ok=True)
tree = ast.parse((ROOT / 'tests/process-search-browser.py').read_text())
MOCK = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == 'MOCK' for t in n.targets))
DATA = [dict(id=f'review-{i}', auditId=f'R-{i}', auditDate='2026-09-30' if i < 57 else '2026-10-01',
             processName=f'Process {i % 17 + 1:02d}', processOwner=f'Department {i}',
             userName='Reviewer', processPhase='Prepare', stepNumber=str(i + 1),
             plannedStartDate='2026-09-01', actualStartDate='2026-09-01',
             plannedEndDate='2026-10-01', actualEndDate='2026-10-01',
             createdAt='original-timestamp', attachments=[{'name': 'evidence.pdf'}]) for i in range(114)]

async def run(p, zone):
    browser = await p.chromium.launch(headless=True)
    context = await browser.new_context(viewport={'width': 1280, 'height': 1800}, timezone_id=zone)
    page = await context.new_page()
    errors, live = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    async def intercept(route):
        url = route.request.url
        if url.startswith('http://localhost:8080/'):
            name = url.split('http://localhost:8080/', 1)[1].split('?')[0] or 'index.html'
            if name == 'firebase.js':
                await route.fulfill(status=200, content_type='text/javascript', body=MOCK)
            else:
                path = ROOT / name
                if path.is_file():
                    await route.fulfill(status=200, content_type=mimetypes.guess_type(str(path))[0] or 'application/octet-stream', body=path.read_bytes())
                else:
                    await route.fulfill(status=404, body='Not found')
        elif 'firebase' in url or 'googleapis' in url:
            live.append(url.split('?')[0])
            await route.abort()
        else:
            await route.continue_()
    await context.route('**/*', intercept)
    await page.goto('http://localhost:8080/', wait_until='networkidle')
    await page.locator('#loginEmail').fill('local-admin@example.test')
    await page.locator('#loginPassword').fill('local-test-only')
    await page.locator('#loginForm button[type=submit]').click()
    await page.wait_for_function("document.getElementById('loginOverlay').style.display==='none'")
    await page.evaluate('(rows) => window.__testSeed(rows)', DATA)
    await page.get_by_role('tab', name='Dashboard', exact=True).click()
    async def count(n):
        await page.wait_for_function('(n) => document.getElementById("dashReviewedProcessesCount").textContent === String(n)', arg=n)
    await count(17)
    assert await page.locator('#scheduleVarianceTable tbody tr').count() == 17
    await page.screenshot(path=str(OUT / f'{zone.replace("/", "-")}-dashboard.png'))
    await page.locator('#dashFilterMonth').select_option('2026-09')
    await count(17)
    await page.locator('#dashFilterMonth').select_option('2026-10')
    await count(17)
    await page.locator('#dashFilterMonth').select_option('')
    dept = page.locator('#filterDept').locator('..')
    await dept.locator('.ms-btn').click()
    await dept.locator('.ms-search input').fill('Department 0')
    await dept.locator('.ms-opt input').click()
    await count(1)
    await page.get_by_role('tab', name='Review', exact=True).click()
    await page.locator('#audit [data-sub=records]').click()
    await page.wait_for_function('document.getElementById("reviewedProcessesCount").textContent === "17"')
    assert await page.locator('#recordsTable tbody [data-edit]').count() == 114
    await page.locator('#recFilterDepartment').fill('not-present')
    await page.wait_for_function('document.getElementById("reviewedProcessesCount").textContent === "0"')
    await page.locator('#recClearFilters').click()
    await page.wait_for_function('document.getElementById("reviewedProcessesCount").textContent === "17"')
    assert await page.evaluate('window.__testRead()') == DATA
    assert await page.evaluate('window.__testWrites.length') == 0
    assert not live, live
    assert not errors, errors
    print(zone, 'PASS: 114 entries / 17 processes; timeline 17; both months 17; department 1; Records 17; empty 0; Clear 17; data unchanged; zero writes, live Firebase requests, or JS errors')
    await browser.close()

async def main():
    async with async_playwright() as p:
        for zone in ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']:
            await run(p, zone)

if __name__ == '__main__':
    asyncio.run(main())