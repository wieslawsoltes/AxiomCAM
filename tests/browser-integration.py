"""Playwright integration checks for the built single-file distribution.

Normal mode serves/opens http://localhost:8080. In-memory mode (--in-memory)
allows testing the real UI/worker in an opaque origin where network navigation
is disabled. Only localStorage is substituted; the CAM/worker/render algorithms
are unchanged. That mode exercises the explicitly labeled Canvas fallback.

Usage: pip install playwright; playwright install chromium
       python tests/browser-integration.py [--in-memory] [--chromium /path/to/chromium]
"""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--in-memory',action='store_true')
parser.add_argument('--chromium',default=None)
parser.add_argument('--url',default='http://localhost:8080')
args=parser.parse_args()
checks=[]
def check(name,condition):
    assert condition,name
    checks.append(name)
    print('PASS',name,flush=True)
with sync_playwright() as pw:
    options={'headless':True,'args':['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader']}
    if args.chromium: options['executable_path']=args.chromium
    browser=pw.chromium.launch(**options)
    context=browser.new_context(viewport={'width':1600,'height':1040},device_scale_factor=1,accept_downloads=True)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    def load(page,stored=None):
        if args.in_memory:
            page.evaluate('''initial=>{const map=new Map(Object.entries(initial||{}));Object.defineProperty(window,'localStorage',{value:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)},configurable:true});}''',stored)
            page.set_content((ROOT/'AxiomCAM.html').read_text(),wait_until='domcontentloaded')
        else: page.goto(args.url,wait_until='networkidle')
        page.wait_for_function('window.axiomcam?.ready()',timeout=20000)
    def snap(): return page.evaluate('window.axiomcam.snapshot()')
    def wait_edit(old):
        page.wait_for_function('(rev)=>window.axiomcam.snapshot().revision>rev && window.axiomcam.ready()',arg=old,timeout=20000)
    def act(action): page.locator(f'[data-action="{action}"]').first.click()
    load(page)
    s=snap()
    check('Initial computed program: four operations, 2123 motion states',s['result']['operations']==4 and s['result']['moves']==2123)
    check('Demo passes modeled verification',s['verification']['errors']==0)
    check('Demo stock removal is computed',abs(s['verification']['removed']-54400)<1)
    page.screenshot(path=str(ROOT.parent/'axiomcam-preview.png'))
    # Trigger generation and an edit in the SAME main-thread turn so the old
    # worker cannot respond until the edit has invalidated its request token.
    page.locator('#auto-regenerate').uncheck()
    page.evaluate('''()=>{document.querySelector('[data-action="generate"]').click();const input=document.querySelector('[data-op-field="depth"]');input.value='-6';input.dispatchEvent(new Event('change',{bubbles:true}));}''')
    page.wait_for_timeout(750)
    stale=snap()
    check('In-flight stale worker replies cannot authorize a changed project',stale['result'] is None and stale['generatedRevision']==-1 and not stale['busy'])
    page.locator('#auto-regenerate').check()
    page.wait_for_function('window.axiomcam.ready()')
    check('Current revision regenerates after stale result rejection',snap()['project']['operations'][1]['depth']==-6 and snap()['generatedRevision']==snap()['revision'])
    rev=snap()['revision'];act('undo');wait_edit(rev)
    s=snap()
    rev=s['revision']
    page.locator('[data-op-field="depth"]').fill('-6')
    page.locator('[data-op-field="depth"]').press('Tab')
    wait_edit(rev)
    check('Operation depth edits regenerate',snap()['project']['operations'][1]['depth']==-6 and snap()['verification']['errors']==0)
    rev=snap()['revision'];act('undo');wait_edit(rev)
    check('Undo restores original depth',snap()['project']['operations'][1]['depth']==-7)
    rev=snap()['revision'];act('redo');wait_edit(rev)
    check('Redo reapplies parameter edit',snap()['project']['operations'][1]['depth']==-6)
    rev=snap()['revision'];act('undo');wait_edit(rev)
    page.locator('[data-geometry="pocket"]').click()
    rev=snap()['revision'];page.locator('[data-geo-field="width"]').fill('70');page.locator('[data-geo-field="width"]').press('Tab');wait_edit(rev)
    check('Geometry property edit changes computed model',next(g for g in snap()['project']['geometry'] if g['id']=='pocket')['width']==70)
    rev=snap()['revision'];act('undo');wait_edit(rev)
    page.locator('[data-op]').nth(1).click()
    page.locator('[data-geometry="pocket"]').click()
    act('toggle-inspector')
    rev=snap()['revision'];act('assign-chains');wait_edit(rev)
    check('Existing operation chains can be reassigned without losing the new selection',snap()['project']['operations'][1]['geometryIds']==['pocket'] and snap()['verification']['errors']==0)
    rev=snap()['revision'];act('undo');wait_edit(rev)
    page.locator('[data-tab="wireframe"]').click();act('draw-rect')
    box=page.locator('#overlay-canvas').bounding_box()
    page.mouse.click(box['x']+box['width']*.35,box['y']+box['height']*.38)
    page.mouse.click(box['x']+box['width']*.43,box['y']+box['height']*.46)
    page.wait_for_function('window.axiomcam.snapshot().project.geometry.length===8 && window.axiomcam.ready()')
    check('Two-click rectangle creates editable CAD geometry',snap()['project']['geometry'][-1]['type']=='rect')
    act('select');page.locator('#overlay-canvas').focus();page.keyboard.press('Delete');page.wait_for_function('window.axiomcam.snapshot().project.geometry.length===7 && window.axiomcam.ready()')
    check('Delete geometry is functional',len(snap()['project']['geometry'])==7)
    page.locator('[data-tab="toolpaths"]').click();page.locator('[data-op]').nth(1).click()
    rev=snap()['revision'];act('op-down');wait_edit(rev)
    check('Operation ordering affects execution order',snap()['project']['operations'][1]['type']=='drill')
    rev=snap()['revision'];act('undo');wait_edit(rev)
    act('tools');page.locator('[data-edit-tool="t2"]').click();page.locator('[name="diameter"]').fill('8');rev=snap()['revision'];page.locator('#tool-form button[type="submit"], #tool-form button.primary').click();wait_edit(rev)
    check('Tool library edits regenerate compensation',next(t for t in snap()['project']['tools'] if t['id']=='t2')['diameter']==8 and snap()['verification']['errors']==0)
    page.locator('#dialog-close').click();rev=snap()['revision'];act('undo');wait_edit(rev)
    act('fixtures');page.locator('[data-edit-fixture="f2"]').click()
    for k,v in [('x','50'),('y','40'),('width','10'),('height','10')]:page.locator(f'#fixture-form [name="{k}"]').fill(v)
    rev=snap()['revision'];page.locator('#fixture-form button.primary').click();wait_edit(rev)
    check('A placed obstruction produces collision diagnostics',snap()['verification']['errors']>0)
    page.locator('#dialog-close').click();act('post')
    check('Collision errors block postprocessor dialog',not page.locator('#dialog').evaluate('(d)=>d.open'))
    rev=snap()['revision'];act('undo');wait_edit(rev)
    check('Undo obstruction returns to zero modeled errors',snap()['verification']['errors']==0)
    page.locator('[data-bottom="simulation"]').click();act('sim-reset');check('Reset simulation restores original stock',snap()['fieldRemoved']==0)
    act('play');page.wait_for_timeout(500);act('play')
    check('Playback removes stock from real toolpath segments',snap()['fieldRemoved']>0 and snap()['simTime']>0 and not snap()['playing'])
    page.locator('#timeline-slider').fill('0');page.wait_for_timeout(100)
    check('Backward scrubbing reconstructs stock',snap()['fieldRemoved']==0)
    act('sim-end');check('End simulation reconstructs final volume',abs(snap()['fieldRemoved']-54400)<1)
    act('post');check('Post requires explicit acknowledgement',page.locator('#post-generate').is_disabled())
    page.locator('#post-ack').check();page.locator('#post-generate').click();nc=page.locator('#nc-preview').input_value()
    check('G-code preview is generated from program','G43 H2' in nc and 'G17 G21 G40 G49 G80 G90 G94' in nc and 'NaN' not in nc)
    with page.expect_download() as info:page.locator('#download-nc').click()
    check('NC export creates a file',info.value.suggested_filename.endswith('.nc'))
    page.locator('#dialog-close').click()
    with page.expect_download() as info:act('save')
    check('Project JSON export creates a file',info.value.suggested_filename.endswith('.axiomcam.json'))
    stored=page.evaluate('localStorage.getItem("axiomcam.project.v1")')
    check('Persistence contains geometry, tools, fixtures, and operations',len(json.loads(stored)['operations'])==4)
    imported=json.loads(stored);imported['name']='Imported mounting plate'
    rev=snap()['revision']
    page.locator('#file-input').set_input_files({'name':'imported.axiomcam.json','mimeType':'application/json','buffer':json.dumps(imported).encode()})
    wait_edit(rev)
    check('Project file import validates and restores the complete editable model',snap()['project']==imported)
    stored=page.evaluate('localStorage.getItem("axiomcam.project.v1")')
    second=page.context.new_page()
    load(second,{'axiomcam.project.v1':stored})
    check('Project restoration preserves identities and regenerates deterministic paths',second.evaluate('window.axiomcam.snapshot().result.moves')==2123 and second.evaluate('window.axiomcam.snapshot().project')==json.loads(stored))
    check('No unhandled browser exceptions',not errors)
    page.locator('[data-bottom="simulation"]').click();act('iso');act('fit');page.wait_for_timeout(100)
    # Leave the initial, tool-hidden screenshot as the distributable overview.
    print(json.dumps({'checks':len(checks),'renderer':snap()['renderer'],'pageErrors':errors},indent=2),flush=True)
    (ROOT/'tests'/'browser-results.json').write_text(json.dumps({'checks':checks,'renderer':snap()['renderer'],'mode':'in-memory' if args.in_memory else 'served','pageErrors':errors},indent=2))
    browser.close()
