/* Process Map Generator v4 — vertical swimlane engine
 *
 * Primary input (unified schema, single worksheet):
 *   Process ID, Process Name, Process No, Version, Step ID, Step Name,
 *   Step Type, Swimlane, Sequence, Parent Step, Next Step(s), Branch Label,
 *   Annotation, Shape, [Previous Step(s)]
 *
 * Features:
 *  - Top-to-bottom flow with horizontal swimlane columns (Visio / Bizagi style).
 *  - Layout mode selector: IDH Standard (vertical), Horizontal, Auto.
 *  - Auto-detects swimlanes; grows canvas DOWNWARD, keeps within browser width.
 *  - Sequence used INTERNALLY only for ordering — not rendered as a header.
 *  - Annotations float beside the step (dashed), no extra columns.
 *  - Multi-process file with selector, validation, drag/pan/zoom, PNG/SVG/PDF export.
 *  - Legacy 3-sheet workbooks + TSV paste still work as fallbacks.
 */
(function(){
  // ---------- Constants ----------
  const DEFAULT_LANE_COLORS = ['#B6CDEA','#E9B4CD','#B9D5A7','#C6BADF','#F6CB92','#A9D3CB','#EBCA84','#BFBFBF'];
  const STATUS_COLORS = {
    blue:'#DEEAF6', green:'#DCEBD4', yellow:'#FFF2CC',
    red:'#F8CBAD',  orange:'#FCD5B4', gray:'#E7E6E6', grey:'#E7E6E6'
  };
  const VALID_TYPES = ['start','end','process','approval','decision','document','note','delay'];

  // ---------- State ----------
  const state = {
    processes: {},
    processOrder: [],
    currentPid: null,
    steps: [],
    departments: [],
    sequences: [],
    positions: {},
    collapsed: {},
    view: { scale:1, tx:0, ty:0 },
    title: '', pno: '', ver: '',
    validation: [],
    layoutMode: 'vertical' // 'vertical' | 'horizontal' | 'auto'
  };
  let lastExcelUploadToken = 0;

  function resetAll(){
    state.processes = {};
    state.processOrder = [];
    state.currentPid = null;
    state.steps = [];
    state.departments = [];
    state.sequences = [];
    state.positions = {};
    state.collapsed = {};
    state.validation = [];
  }

  // ---------- Utilities ----------
  function esc(t){ return String(t==null?'':t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function wrap(text, max){
    const words = String(text||'').split(/\s+/); const lines=[]; let cur='';
    words.forEach(w=>{ if ((cur+' '+w).trim().length>max){ if(cur) lines.push(cur); cur=w;} else cur=(cur+' '+w).trim();});
    if(cur) lines.push(cur); return lines;
  }
  function normHeader(h){ return String(h||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
  function resolveColor(v){
    if (!v) return '#DEEAF6';
    const s = String(v).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
    return STATUS_COLORS[s.toLowerCase()] || s;
  }
  function normType(t, shape){
    const s = String(t||shape||'process').toLowerCase().trim();
    if (VALID_TYPES.includes(s)) return s;
    if (/diamond|decision/.test(s)) return 'decision';
    if (/document|doc/.test(s)) return 'document';
    if (/start/.test(s)) return 'start';
    if (/end|stop/.test(s)) return 'end';
    if (/approv/.test(s)) return 'approval';
    if (/note|annot/.test(s)) return 'note';
    return 'process';
  }
  function splitList(v){
    return String(v==null?'':v).split(/[,;\/|]+/).map(x=>x.trim()).filter(Boolean);
  }

  // ---------- Sheet → rows ----------
  function sheetToObjects(ws){
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:false });
    if (!rows.length) return { headers:[], rows:[] };
    let hi = 0;
    for (let i=0; i<Math.min(rows.length,5); i++){
      const nonEmpty = rows[i].filter(c => String(c).trim() !== '');
      if (nonEmpty.length >= 2){ hi = i; break; }
    }
    const headers = rows[hi].map(normHeader);
    const out = [];
    for (let i=hi+1; i<rows.length; i++){
      const r = rows[i];
      if (!r.some(c => String(c).trim() !== '')) continue;
      const obj = {}; headers.forEach((h,idx) => { if (h) obj[h] = r[idx]; });
      out.push(obj);
    }
    return { headers, rows: out };
  }

  function findSheet(wb, ...names){
    const map = {};
    (wb.SheetNames||[]).forEach(n => { map[n.toLowerCase().replace(/\s+/g,'')] = n; });
    for (const n of names){
      const key = n.toLowerCase().replace(/\s+/g,'');
      if (map[key]) return wb.Sheets[map[key]];
    }
    return null;
  }

  // ---------- New unified schema ----------
  function isUnifiedHeader(headers){
    const set = new Set(headers);
    return set.has('processid') && set.has('stepid') && (set.has('swimlane') || set.has('department'));
  }

  function findUnifiedSheet(wb){
    const preferred = findSheet(wb, 'ProcessMap','Processes','ProcessSteps','Steps','Sheet1');
    const candidates = preferred ? [preferred] : [];
    (wb.SheetNames || []).forEach(n => { if (wb.Sheets[n] && !candidates.includes(wb.Sheets[n])) candidates.push(wb.Sheets[n]); });
    for (const ws of candidates){
      const { headers, rows } = sheetToObjects(ws);
      if (isUnifiedHeader(headers) && rows.length) return { ws, headers, rows };
    }
    return null;
  }

  function loadUnified(rows){
    const groups = {};
    const order = [];
    rows.forEach(r => {
      const pid = String(r.processid ?? '').trim() || '__default__';
      if (!groups[pid]){
        groups[pid] = {
          pid,
          title: String(r.processname ?? '').trim(),
          no:    String(r.processno   ?? '').trim(),
          ver:   String(r.version     ?? '').trim(),
          rows: []
        };
        order.push(pid);
      }
      groups[pid].rows.push(r);
    });

    state.processes = {};
    state.processOrder = order;
    order.forEach(pid => {
      const g = groups[pid];
      state.processes[pid] = buildProcess(g);
    });
    state.currentPid = order[0];
    activateProcess(state.currentPid);
    return order.length > 0;
  }

  function buildProcess(g){
    const steps = g.rows.map(r => {
      const stepId = String(r.stepid ?? '').trim();
      const shape  = String(r.shape ?? '').trim();
      return {
        id: stepId,
        name: String(r.stepname ?? '').trim(),
        type: normType(r.steptype, shape),
        department: String(r.swimlane ?? r.department ?? 'General').trim() || 'General',
        seq: parseSeq(r.sequence),
        parent: splitList(r.parentstep),
        prev: splitList(r.previousstep ?? r.previoussteps),
        nexts: splitList(r.nextsteps ?? r.nextstep),
        branchLabels: splitList(r.branchlabel),
        annotation: String(r.annotation ?? '').trim(),
        owner: '', sla:'', document:'', color:'#DEEAF6', notes:''
      };
    }).filter(s => s.id);

    const byId = {}; steps.forEach(s => byId[s.id] = s);
    steps.forEach(s => {
      s.nexts.forEach(n => {
        const t = byId[n]; if (t && !t.prev.includes(s.id)) t.prev.push(s.id);
      });
    });

    const seen = new Set(); const departments = [];
    steps.forEach(s => {
      const d = s.department;
      if (!seen.has(d.toLowerCase())){
        departments.push({ name:d, color: DEFAULT_LANE_COLORS[departments.length % DEFAULT_LANE_COLORS.length], order: departments.length });
        seen.add(d.toLowerCase());
      }
    });

    const seqSet = new Set();
    steps.forEach(s => { if (s.seq != null) seqSet.add(s.seq); });
    const seqSorted = [...seqSet].sort((a,b)=>a-b);
    steps.forEach(s => {
      if (s.seq == null){
        const p = s.parent[0] && byId[s.parent[0]];
        if (p && p.seq != null) s.seq = p.seq;
      }
    });
    const sequences = seqSorted.map(n => ({ key:n, label:'Step '+n }));

    return { pid:g.pid, title:g.title, no:g.no, ver:g.ver, steps, departments, sequences, byId };
  }

  function parseSeq(v){
    if (v == null || String(v).trim()==='') return null;
    const n = parseInt(String(v).match(/-?\d+/)?.[0]);
    return isNaN(n) ? null : n;
  }

  function activateProcess(pid){
    const p = state.processes[pid]; if (!p) return;
    state.currentPid = pid;
    state.steps = p.steps;
    state.departments = p.departments;
    state.sequences = p.sequences;
    state.positions = {};
    state.collapsed = {};
    state.title = p.title;
    state.pno   = p.no;
    state.ver   = p.ver;
    const t = document.getElementById('pmTitle'); if (t) t.value = p.title;
    const no = document.getElementById('pmNo'); if (no) no.value = p.no;
    const ve = document.getElementById('pmVer'); if (ve) ve.value = p.ver;
    validate();
  }

  // ---------- Validation ----------
  function validate(){
    const errs = [];
    const seen = {};
    state.steps.forEach(s => {
      seen[s.id] = (seen[s.id]||0) + 1;
      if (!VALID_TYPES.includes(s.type)) errs.push(`Step ${s.id}: invalid Step Type "${s.type}".`);
    });
    Object.keys(seen).forEach(id => { if (seen[id] > 1) errs.push(`Duplicate Step ID: ${id} (${seen[id]}×).`); });
    const byId = {}; state.steps.forEach(s => byId[s.id] = s);
    state.steps.forEach(s => {
      s.parent.forEach(p => { if (!byId[p]) errs.push(`Step ${s.id}: Parent Step "${p}" not found.`); });
      s.nexts.forEach(n => { if (!byId[n]) errs.push(`Step ${s.id}: Next Step "${n}" not found.`); });
    });
    const starts = state.steps.filter(s => s.type==='start').length;
    const ends   = state.steps.filter(s => s.type==='end').length;
    if (starts === 0) errs.push('No Start step found.');
    if (starts > 1)   errs.push(`Multiple Start steps found (${starts}).`);
    if (ends === 0)   errs.push('No End step found.');
    const laneSeq = {};
    state.steps.forEach(s => {
      if (s.type==='note' || s.seq==null) return;
      const k = s.department+'|'+s.seq;
      laneSeq[k] = (laneSeq[k]||0)+1;
    });
    Object.entries(laneSeq).forEach(([k,c]) => { if (c>1) errs.push(`Duplicate Sequence in lane: ${k.replace('|',' @ Step ')} (${c}×).`); });
    state.validation = errs;
  }

  // ---------- Legacy fallbacks ----------
  function loadFromWorkbookLegacy(wb){
    const psSheet = findSheet(wb,'ProcessSteps','Process Steps','Steps');
    if (!psSheet) return false;
    const { rows } = sheetToObjects(psSheet);
    if (!rows.length) return false;
    const steps = rows.map(r => {
      const idNum = parseInt(String(r.stepid ?? r.id ?? r.seq ?? '').match(/-?\d+/)?.[0]);
      if (isNaN(idNum)) return null;
      return {
        id: String(idNum),
        name: String(r.stepname ?? r.activity ?? r.name ?? '').trim(),
        type: normType(r.steptype ?? r.type),
        department: String(r.department ?? r.swimlane ?? 'General').trim() || 'General',
        seq: idNum,
        parent: r.previousstep!=null && String(r.previousstep).trim() ? [String(r.previousstep).trim()] : [],
        prev: [], nexts: [], branchLabels: [], annotation: String(r.notes ?? '').trim(),
        owner: String(r.owner ?? '').trim(),
        sla: String(r.sladays ?? r.sla ?? '').trim(),
        document: String(r.document ?? '').trim(),
        color: resolveColor(r.statuscolor ?? r.color),
        notes: String(r.notes ?? '').trim()
      };
    }).filter(Boolean);
    const byId = {}; steps.forEach(s=>byId[s.id]=s);
    steps.forEach(s => s.parent.forEach(p => { if (byId[p]) byId[p].nexts.push(s.id); }));

    const p = { pid:'legacy', title:'', no:'', ver:'', steps, departments: [], sequences: [], byId };
    const seen = new Set();
    steps.forEach(s => { if (!seen.has(s.department.toLowerCase())){ p.departments.push({name:s.department, color:DEFAULT_LANE_COLORS[p.departments.length%DEFAULT_LANE_COLORS.length], order:p.departments.length}); seen.add(s.department.toLowerCase()); }});
    const seqSet = new Set(); steps.forEach(s => seqSet.add(s.seq));
    p.sequences = [...seqSet].sort((a,b)=>a-b).map(n => ({ key:n, label:'Step '+n }));

    state.processes = { legacy:p };
    state.processOrder = ['legacy'];
    activateProcess('legacy');
    return true;
  }

  function parseLegacyText(text){
    const lines = text.trim().split(/\r?\n/).filter(l=>l.trim());
    if (!lines.length) return false;
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const rows = lines.map(l => l.split(sep).map(c=>c.trim()));
    if (isNaN(parseInt(rows[0][0]))) rows.shift();
    const steps = rows.map((r,i) => ({
      id: String(parseInt(r[0])||(i+1)),
      name: r[1]||'', type:'process',
      department: r[2]||'General',
      seq: parseInt(r[0])||(i+1),
      parent: i===0 ? [] : [String(parseInt(rows[i-1][0])||i)],
      prev: [], nexts: [], branchLabels: [], annotation:'',
      owner:r[3]||'', sla:r[4]||'', document:'', color:'#DEEAF6', notes:''
    })).filter(s=>s.name);
    if (!steps.length) return false;
    const byId={}; steps.forEach(s=>byId[s.id]=s);
    steps.forEach(s => s.parent.forEach(p => byId[p] && byId[p].nexts.push(s.id)));
    const p = { pid:'legacy', title:'', no:'', ver:'', steps, departments:[], sequences:[], byId };
    const seen = new Set();
    steps.forEach(s => { if (!seen.has(s.department.toLowerCase())){ p.departments.push({name:s.department,color:DEFAULT_LANE_COLORS[p.departments.length%DEFAULT_LANE_COLORS.length],order:p.departments.length}); seen.add(s.department.toLowerCase()); }});
    const seqSet=new Set(); steps.forEach(s=>seqSet.add(s.seq));
    p.sequences = [...seqSet].sort((a,b)=>a-b).map(n=>({key:n,label:'Step '+n}));
    state.processes = { legacy:p };
    state.processOrder = ['legacy'];
    activateProcess('legacy');
    return true;
  }

  // ---------- Layout ----------
  // Vertical mode = swimlanes are COLUMNS (headers on top). Flow goes DOWN.
  // Horizontal mode = swimlanes are ROWS (headers on left). Flow goes RIGHT.
  const LAYOUT_V = { headerH: 56, laneHeaderH: 42, rowH: 110, padL: 12, padR: 12, padB: 40, boxW: 190, boxH: 78, minLaneW: 200 };
  const LAYOUT_H = { laneHeaderW: 160, headerH: 60, laneH: 150, colW: 220, padL: 12, padR: 60, boxW: 180, boxH: 78 };

  function pickAutoMode(){
    const nLanes = state.departments.length || 1;
    const nSeq   = state.sequences.length || 1;
    // Prefer vertical unless there are many parallel branches per row
    let maxPerCell = 0;
    const cellCount = {};
    state.steps.forEach(s => {
      if (s.type==='note') return;
      const k = s.department+'|'+s.seq;
      cellCount[k] = (cellCount[k]||0)+1;
      if (cellCount[k] > maxPerCell) maxPerCell = cellCount[k];
    });
    if (nLanes >= nSeq && maxPerCell <= 1) return 'horizontal';
    return 'vertical';
  }

  function effectiveMode(){
    if (state.layoutMode === 'auto') return pickAutoMode();
    return state.layoutMode || 'vertical';
  }

  function containerWidth(){
    const wrap = document.getElementById('pmMapWrap');
    const w = wrap ? wrap.clientWidth : 1000;
    return Math.max(600, w - 4);
  }

  function computeLayoutVertical(){
    const L = LAYOUT_V;
    const nLanes = Math.max(1, state.departments.length);
    // Fit width to browser, but respect min lane width
    const availW = containerWidth();
    let laneW = Math.max(L.minLaneW, Math.floor((availW - L.padL - L.padR) / nLanes));
    const totalW = L.padL + laneW * nLanes + L.padR;

    // Row per sequence
    const seqRow = {};
    state.sequences.forEach((sq, i) => { seqRow[sq.key] = i; });
    const nRows = Math.max(1, state.sequences.length);

    const laneX = {};
    state.departments.forEach((d, i) => { laneX[d.name] = L.padL + i * laneW; });

    const bodyTop = L.headerH + L.laneHeaderH;
    const totalH  = bodyTop + nRows * L.rowH + L.padB;

    // Cell placement (support multi steps in same lane+seq side-by-side)
    const cellCount = {};
    state.steps.forEach(s => {
      if (s.type==='note') return;
      const k = s.department+'|'+s.seq;
      cellCount[k] = (cellCount[k]||0)+1;
    });
    const cellIdx = {};
    const stepPos = {};
    state.steps.forEach(s => {
      if (s.type==='note') return;
      const row = seqRow[s.seq] ?? 0;
      const k = s.department+'|'+s.seq;
      const idx = (cellIdx[k] = (cellIdx[k]||0) + 1) - 1;
      const total = cellCount[k];
      const lx = laneX[s.department] != null ? laneX[s.department] : L.padL;
      const slot = laneW / total;
      const cx = lx + slot*(idx + 0.5);
      const cy = bodyTop + row*L.rowH + L.rowH/2;
      const p = state.positions[s.id];
      stepPos[s.id] = { x: p?.x ?? (cx - L.boxW/2), y: p?.y ?? (cy - L.boxH/2), hidden:false };
    });

    return { mode:'vertical', totalW, totalH, laneW, laneX, bodyTop, stepPos, nRows };
  }

  function computeLayoutHorizontal(){
    const L = LAYOUT_H;
    const laneY = {}; let y = L.headerH;
    state.departments.forEach(d => {
      laneY[d.name] = { y, h: L.laneH };
      y += L.laneH;
    });
    const slotW = L.boxW + 22;
    const cellCount = {};
    state.steps.forEach(s => {
      if (s.type==='note') return;
      const key = s.department + '|' + (s.seq ?? 'x');
      cellCount[key] = (cellCount[key]||0) + 1;
    });
    const seqW = {}; const seqX = {};
    state.sequences.forEach(sq => {
      let maxC = 1;
      state.departments.forEach(d => {
        const c = cellCount[d.name+'|'+sq.key] || 0;
        if (c > maxC) maxC = c;
      });
      seqW[sq.key] = Math.max(L.colW, maxC * slotW + 40);
    });
    let x = L.laneHeaderW + L.padL;
    state.sequences.forEach(sq => { seqX[sq.key] = x; x += seqW[sq.key]; });
    const totalW = x + L.padR;
    const totalH = y + 20;

    const cellIndex = {}; const stepPos = {};
    state.steps.forEach(s => {
      if (s.type==='note') return;
      const lane = laneY[s.department] || { y:L.headerH, h:L.laneH };
      const key = s.department+'|'+s.seq;
      const idx = (cellIndex[key] = (cellIndex[key]||0) + 1) - 1;
      const baseX = seqX[s.seq] != null ? seqX[s.seq] : L.laneHeaderW+L.padL;
      const cellX = baseX + 20 + idx * slotW;
      const cellY = lane.y + (lane.h - L.boxH)/2;
      const p = state.positions[s.id];
      stepPos[s.id] = { x: p?.x ?? cellX, y: p?.y ?? cellY, lane, hidden:false };
    });
    return { mode:'horizontal', totalW, totalH, laneY, seqX, seqW, stepPos };
  }

  // ---------- Shapes ----------
  function shapePath(type, x, y, w, h){
    const r = 14;
    switch(type){
      case 'start': case 'end':
        return { tag:'rect', attrs:{ x, y, width:w, height:h, rx:h/2, ry:h/2 } };
      case 'decision':
        return { tag:'polygon', attrs:{ points:`${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}` } };
      case 'document':
        return { tag:'path', attrs:{ d:`M${x},${y} L${x+w},${y} L${x+w},${y+h-10} Q${x+w*0.75},${y+h+6} ${x+w/2},${y+h-6} Q${x+w*0.25},${y+h-14} ${x},${y+h-6} Z` } };
      case 'delay':
        return { tag:'polygon', attrs:{ points:`${x},${y} ${x+w},${y} ${x+w/2},${y+h/2} ${x+w},${y+h} ${x},${y+h} ${x+w/2},${y+h/2}` } };
      case 'approval':
      case 'process':
      default:
        return { tag:'rect', attrs:{ x, y, width:w, height:h, rx:r, ry:r } };
    }
  }
  function shapeAnchor(type, x, y, w, h, side){
    const cx=x+w/2, cy=y+h/2;
    if (side==='r') return { x:x+w, y:cy };
    if (side==='l') return { x, y:cy };
    if (side==='t') return { x:cx, y };
    if (side==='b') return { x:cx, y:y+h };
    return { x:cx, y:cy };
  }
  function sideForConnectorVertical(from, to){
    // Prefer top/bottom in vertical mode
    if (to.y > from.y + 5) return { a:'b', b:'t' };
    if (to.y < from.y - 5) return { a:'t', b:'b' };
    if (to.x > from.x)     return { a:'r', b:'l' };
    return { a:'l', b:'r' };
  }
  function sideForConnectorHorizontal(from, to){
    if (to.x > from.x + 5) return { a:'r', b:'l' };
    if (to.x < from.x - 5) return { a:'l', b:'r' };
    if (to.y > from.y)     return { a:'b', b:'t' };
    return { a:'t', b:'b' };
  }
  function connectorPath(ax, ay, bx, by, aSide){
    if (aSide==='r' || aSide==='l'){
      const midX = (ax+bx)/2;
      return `M ${ax} ${ay} L ${midX} ${ay} L ${midX} ${by} L ${bx} ${by}`;
    } else {
      const midY = (ay+by)/2;
      return `M ${ax} ${ay} L ${ax} ${midY} L ${bx} ${midY} L ${bx} ${by}`;
    }
  }

  // ---------- Render ----------
  function render(){
    const svg = document.getElementById('pmMap'); if (!svg) return;
    renderValidation();
    if (!state.steps.length){ svg.innerHTML=''; svg.removeAttribute('viewBox'); return; }

    state.title = document.getElementById('pmTitle')?.value ?? state.title;
    state.pno   = document.getElementById('pmNo')?.value   ?? state.pno;
    state.ver   = document.getElementById('pmVer')?.value  ?? state.ver;

    const mode = effectiveMode();
    const layout = mode === 'horizontal' ? computeLayoutHorizontal() : computeLayoutVertical();
    const { totalW, totalH, stepPos } = layout;

    svg.setAttribute('width', totalW);
    svg.setAttribute('height', totalH);
    svg.setAttribute('viewBox', `${state.view.tx} ${state.view.ty} ${totalW/state.view.scale} ${totalH/state.view.scale}`);
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg');

    let s = '';
    s += `<defs>
      <marker id="pmArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1f4e79"/></marker>
      <marker id="pmArrYes" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2e7d32"/></marker>
      <marker id="pmArrNo"  viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#c62828"/></marker>
      <filter id="pmShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="1" dy="1.5" stdDeviation="1" flood-opacity="0.18"/></filter>
    </defs>`;

    // Header bar (title)
    const L = mode==='vertical' ? LAYOUT_V : LAYOUT_H;
    s += `<rect x="0" y="0" width="${totalW}" height="${L.headerH}" fill="#f4f7fb" stroke="#1f4e79"/>`;
    s += `<text x="14" y="22" font-size="14" font-weight="bold" fill="#1f3a8a">${esc(state.title||'Process Map')}</text>`;
    s += `<text x="14" y="42" font-size="11" fill="#374151">Process no. ${esc(state.pno)}   ·   Version ${esc(state.ver)}   ·   ${state.steps.length} activities</text>`;

    if (mode === 'vertical'){
      // Lane header row (dept names across the top) + vertical lane columns
      const { laneW, laneX, bodyTop } = layout;
      state.departments.forEach(d => {
        const x = laneX[d.name];
        // Lane header pill
        s += `<rect x="${x}" y="${L.headerH}" width="${laneW}" height="${L.laneHeaderH}" fill="${d.color}" stroke="#1f4e79"/>`;
        s += `<text x="${x+laneW/2}" y="${L.headerH+L.laneHeaderH/2+4}" text-anchor="middle" font-size="12" font-weight="bold" fill="#1f3a8a">${esc(d.name)}</text>`;
        // Column body
        s += `<rect x="${x}" y="${bodyTop}" width="${laneW}" height="${totalH-bodyTop-8}" fill="#ffffff" stroke="#1f4e79"/>`;
      });
    } else {
      // Horizontal: lane rows on the left, no sequence header (removed per spec)
      const { laneY } = layout;
      state.departments.forEach(d => {
        const lane = laneY[d.name];
        s += `<rect x="0" y="${lane.y}" width="${L.laneHeaderW}" height="${lane.h}" fill="${d.color}" stroke="#1f4e79"/>`;
        s += `<rect x="${L.laneHeaderW}" y="${lane.y}" width="${totalW-L.laneHeaderW}" height="${lane.h}" fill="#ffffff" stroke="#1f4e79"/>`;
        const cx = L.laneHeaderW/2, cy = lane.y+lane.h/2;
        s += `<text x="${cx}" y="${cy}" font-size="12" font-weight="bold" text-anchor="middle" transform="rotate(-90 ${cx} ${cy})" style="pointer-events:none">${esc(d.name)}</text>`;
      });
    }

    // Connectors
    const byId = {}; state.steps.forEach(st => byId[st.id]=st);
    const sideFn = mode==='vertical' ? sideForConnectorVertical : sideForConnectorHorizontal;
    const boxW = mode==='vertical' ? LAYOUT_V.boxW : LAYOUT_H.boxW;
    const boxH = mode==='vertical' ? LAYOUT_V.boxH : LAYOUT_H.boxH;
    const drawConn = (fromId, toId, kind, label) => {
      const from = byId[fromId], to = byId[toId];
      if (!from || !to) return '';
      const pf = stepPos[fromId], pt = stepPos[toId];
      if (!pf || !pt) return '';
      const sides = sideFn({x:pf.x+boxW/2, y:pf.y+boxH/2},{x:pt.x+boxW/2, y:pt.y+boxH/2});
      const a = shapeAnchor(from.type, pf.x, pf.y, boxW, boxH, sides.a);
      const b = shapeAnchor(to.type,   pt.x, pt.y, boxW, boxH, sides.b);
      const path = connectorPath(a.x, a.y, b.x, b.y, sides.a);
      const marker = kind==='yes' ? 'pmArrYes' : kind==='no' ? 'pmArrNo' : 'pmArr';
      const color  = kind==='yes' ? '#2e7d32' : kind==='no' ? '#c62828' : '#1f4e79';
      let out = `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.6" marker-end="url(#${marker})"/>`;
      if (label){
        const mx = (a.x+b.x)/2, my = (a.y+b.y)/2 - 6;
        const w = Math.max(48, label.length*6+12);
        out += `<rect x="${mx-w/2}" y="${my-11}" width="${w}" height="15" rx="3" fill="#fff" stroke="${color}" stroke-width="0.6"/>`;
        out += `<text x="${mx}" y="${my}" text-anchor="middle" font-size="10" fill="${color}">${esc(label)}</text>`;
      }
      return out;
    };

    state.steps.forEach(st => {
      if (st.type==='note') return;
      st.nexts.forEach((n, i) => {
        let label = st.branchLabels[i] || '';
        let kind = 'plain';
        if (st.type==='decision'){
          const low = label.toLowerCase();
          if (/^(yes|approved|approve|accept|ok|true)$/.test(low)) kind='yes';
          else if (/^(no|rejected|reject|deny|false)$/.test(low)) kind='no';
        }
        s += drawConn(st.id, n, kind, label);
      });
    });

    // Annotations (floating dashed) — placed beside the step; doesn't affect layout width
    state.steps.forEach(st => {
      if (!st.annotation) return;
      const p = stepPos[st.id]; if (!p) return;
      const noteW = 150, noteH = 40;
      // Place to the right of the shape; if that overflows, place to the left
      let nx = p.x + boxW + 24;
      const ny = p.y + (boxH-noteH)/2;
      if (nx + noteW > totalW - 4) nx = p.x - noteW - 24;
      const ax = nx <= p.x ? p.x : p.x + boxW;
      const bx = nx <= p.x ? nx + noteW : nx;
      s += `<line x1="${ax}" y1="${p.y+boxH/2}" x2="${bx}" y2="${ny+noteH/2}" stroke="#b45309" stroke-width="1" stroke-dasharray="4 3"/>`;
      s += `<rect x="${nx}" y="${ny}" width="${noteW}" height="${noteH}" rx="4" fill="#fffbe6" stroke="#b45309"/>`;
      const lines = wrap(st.annotation, 22).slice(0,3);
      lines.forEach((ln,i) => {
        s += `<text x="${nx+6}" y="${ny+14+i*12}" font-size="10" fill="#78350f">${esc(ln)}</text>`;
      });
    });

    // Shapes
    state.steps.forEach(st => {
      if (st.type==='note') return;
      const p = stepPos[st.id]; if (!p) return;
      const sh = shapePath(st.type, p.x, p.y, boxW, boxH);
      const fill = st.color || defaultFillForType(st.type);
      const attrStr = Object.entries(sh.attrs).map(([k,v])=>`${k}="${v}"`).join(' ');
      s += `<g class="pm-node" data-id="${esc(st.id)}" style="cursor:move">`;
      s += `<${sh.tag} ${attrStr} fill="${fill}" stroke="#1f4e79" stroke-width="1.5" filter="url(#pmShadow)"/>`;
      const isDec = st.type==='decision';
      const label = st.name || st.id;
      const lines = wrap(label, isDec?16:26).slice(0,3);
      s += `<text x="${p.x+boxW/2}" y="${p.y+14}" text-anchor="middle" font-size="10" font-weight="bold" fill="#0f172a" style="pointer-events:none">${esc(st.id)}${isDec?' ?':''}</text>`;
      lines.forEach((ln,li) => {
        s += `<text x="${p.x+boxW/2}" y="${p.y+30+li*13}" text-anchor="middle" font-size="10.5" fill="#0f172a" style="pointer-events:none">${esc(ln)}</text>`;
      });
      s += `</g>`;
    });

    svg.innerHTML = s;
    attachInteractions(svg, layout);
  }

  function defaultFillForType(t){
    switch(t){
      case 'start': return '#DCEBD4';
      case 'end':   return '#F8CBAD';
      case 'decision': return '#FFF2CC';
      case 'document': return '#FCE4EC';
      case 'approval': return '#E1E7F5';
      default: return '#DEEAF6';
    }
  }

  function renderValidation(){
    let box = document.getElementById('pmValidation');
    if (!box){
      const wrap = document.getElementById('pmMapWrap');
      if (!wrap) return;
      box = document.createElement('div');
      box.id = 'pmValidation';
      box.style.cssText = 'margin:0 0 10px;padding:10px 12px;border-radius:6px;font-size:12px;';
      wrap.parentNode.insertBefore(box, wrap);
    }
    if (!state.validation.length){
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    box.style.display = 'block';
    box.style.background = '#fff4f4';
    box.style.border = '1px solid #c62828';
    box.style.color = '#7f1d1d';
    box.innerHTML = '<strong>Validation issues (' + state.validation.length + '):</strong><ul style="margin:6px 0 0 18px;padding:0;">'
      + state.validation.map(e => `<li>${esc(e)}</li>`).join('') + '</ul>';
  }

  // ---------- Interactions ----------
  function attachInteractions(svg, layout){
    let drag = null;
    svg.querySelectorAll('.pm-node').forEach(g => {
      g.addEventListener('mousedown', ev => {
        ev.stopPropagation();
        const id = g.getAttribute('data-id');
        const pt = svgPoint(svg, ev); const pos = layout.stepPos[id];
        drag = { id, dx: pt.x-pos.x, dy: pt.y-pos.y };
      });
    });
    let pan = null;
    svg.addEventListener('mousedown', ev => {
      if (drag) return;
      if (ev.target === svg || ev.target.tagName==='rect'){
        pan = { x:ev.clientX, y:ev.clientY, tx:state.view.tx, ty:state.view.ty };
      }
    });
    window.addEventListener('mousemove', ev => {
      if (drag){
        const pt = svgPoint(svg, ev);
        state.positions[drag.id] = { x: pt.x-drag.dx, y: pt.y-drag.dy };
        render();
      } else if (pan){
        const dx = (ev.clientX-pan.x)/state.view.scale;
        const dy = (ev.clientY-pan.y)/state.view.scale;
        state.view.tx = pan.tx - dx; state.view.ty = pan.ty - dy;
        applyView(svg);
      }
    });
    window.addEventListener('mouseup', () => { drag=null; pan=null; });
    svg.addEventListener('wheel', ev => {
      ev.preventDefault();
      const f = ev.deltaY<0 ? 1.1 : 1/1.1;
      state.view.scale = Math.max(0.3, Math.min(3, state.view.scale*f));
      applyView(svg);
    }, { passive:false });
  }
  function applyView(svg){
    const w=+svg.getAttribute('width'), h=+svg.getAttribute('height');
    svg.setAttribute('viewBox', `${state.view.tx} ${state.view.ty} ${w/state.view.scale} ${h/state.view.scale}`);
  }
  function svgPoint(svg, ev){
    const pt = svg.createSVGPoint(); pt.x=ev.clientX; pt.y=ev.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  // ---------- Exports ----------
  function svgToPngDataUrl(scale){
    return new Promise((resolve,reject) => {
      const svg = document.getElementById('pmMap');
      const w=+svg.getAttribute('width'), h=+svg.getAttribute('height');
      const clone = svg.cloneNode(true);
      clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const xml = new XMLSerializer().serializeToString(clone);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width=w*scale; c.height=h*scale;
        const ctx = c.getContext('2d'); ctx.scale(scale,scale);
        ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0);
        resolve({ url:c.toDataURL('image/png'), w, h });
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(xml)));
    });
  }
  async function downloadPng(){
    const { url } = await svgToPngDataUrl(2);
    const a=document.createElement('a'); a.href=url; a.download='process-map.png'; a.click();
  }
  function downloadSvg(){
    const svg=document.getElementById('pmMap');
    const blob=new Blob([svg.outerHTML],{type:'image/svg+xml'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='process-map.svg'; a.click();
  }
  async function downloadPdf(){
    if (!window.jspdf){ alert('PDF library not loaded.'); return; }
    const svg=document.getElementById('pmMap');
    if (!svg.innerHTML.trim()){ alert('Generate a process map first.'); return; }
    const { url, w, h } = await svgToPngDataUrl(2);
    const { jsPDF } = window.jspdf;
    const orientation = w>=h?'landscape':'portrait';
    const pdf = new jsPDF({ orientation, unit:'pt', format:'a4' });
    const pageW=pdf.internal.pageSize.getWidth(), pageH=pdf.internal.pageSize.getHeight();
    const margin=24, headerH=28;
    pdf.setFontSize(13); pdf.setTextColor(31,58,138);
    pdf.text('Process Map — '+(state.title||''), margin, margin+4);
    pdf.setFontSize(9); pdf.setTextColor(107,114,128);
    pdf.text(new Date().toLocaleString(), pageW-margin, margin+4, { align:'right' });
    const availW = pageW - margin*2;
    const availH = pageH - margin*2 - headerH;
    // Scale to page width; if height exceeds page, paginate vertically.
    const scale = availW / w;
    const scaledH = h * scale;
    if (scaledH <= availH){
      pdf.addImage(url, 'PNG', margin, margin+headerH, availW, scaledH);
    } else {
      // Multi-page vertical split
      const pxPerPage = availH / scale; // source-image pixels per page
      const img = new Image();
      await new Promise(res => { img.onload = res; img.src = url; });
      const srcW = img.width, srcH = img.height;
      const srcPxPerPage = pxPerPage * (srcW / w);
      let y = 0, pageNo = 0;
      while (y < srcH){
        if (pageNo > 0){ pdf.addPage(); }
        const sliceH = Math.min(srcPxPerPage, srcH - y);
        const c = document.createElement('canvas');
        c.width = srcW; c.height = sliceH;
        const ctx = c.getContext('2d');
        ctx.fillStyle='#fff'; ctx.fillRect(0,0,srcW,sliceH);
        ctx.drawImage(img, 0, y, srcW, sliceH, 0, 0, srcW, sliceH);
        const sliceUrl = c.toDataURL('image/png');
        pdf.setFontSize(13); pdf.setTextColor(31,58,138);
        pdf.text('Process Map — '+(state.title||'')+`  (p.${pageNo+1})`, margin, margin+4);
        pdf.addImage(sliceUrl, 'PNG', margin, margin+headerH, availW, sliceH * scale);
        y += sliceH; pageNo++;
      }
    }
    pdf.save('process-map.pdf');
  }
  function computeLayout(){ const m=effectiveMode(); return m==='horizontal'?computeLayoutHorizontal():computeLayoutVertical(); }
  // ---------- Visio 2003 VDX export (single-file XML, opens in Visio) ----------
  function vdxEsc(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function vdxRect(id, cx, cy, w, h, fill, line, text, bold){
    return `<Shape ID="${id}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3"><XForm><PinX>${cx}</PinX><PinY>${cy}</PinY><Width>${w}</Width><Height>${h}</Height><LocPinX>${w/2}</LocPinX><LocPinY>${h/2}</LocPinY></XForm><Line><LineWeight>0.01</LineWeight><LineColor>${line}</LineColor><Rounding>0.05</Rounding></Line><Fill><FillForegnd>${fill}</FillForegnd><FillPattern>1</FillPattern></Fill><TextBlock><VerticalAlign>1</VerticalAlign></TextBlock><Char IX="0"><Font>2</Font><Size>${bold?0.14:0.10}</Size><Style>${bold?1:0}</Style></Char><Para IX="0"><HorzAlign>1</HorzAlign></Para><Geom IX="0"><NoFill>0</NoFill><NoLine>0</NoLine><MoveTo IX="1"><X>0</X><Y>0</Y></MoveTo><LineTo IX="2"><X>${w}</X><Y>0</Y></LineTo><LineTo IX="3"><X>${w}</X><Y>${h}</Y></LineTo><LineTo IX="4"><X>0</X><Y>${h}</Y></LineTo><LineTo IX="5"><X>0</X><Y>0</Y></LineTo></Geom><Text>${vdxEsc(text)}</Text></Shape>`;
  }
  function vdxDiamond(id, cx, cy, w, h, text){
    return `<Shape ID="${id}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3"><XForm><PinX>${cx}</PinX><PinY>${cy}</PinY><Width>${w}</Width><Height>${h}</Height><LocPinX>${w/2}</LocPinX><LocPinY>${h/2}</LocPinY></XForm><Line><LineWeight>0.01</LineWeight><LineColor>#1F4E79</LineColor></Line><Fill><FillForegnd>#FFF2CC</FillForegnd><FillPattern>1</FillPattern></Fill><TextBlock><VerticalAlign>1</VerticalAlign></TextBlock><Char IX="0"><Font>2</Font><Size>0.10</Size></Char><Para IX="0"><HorzAlign>1</HorzAlign></Para><Geom IX="0"><MoveTo IX="1"><X>${w/2}</X><Y>0</Y></MoveTo><LineTo IX="2"><X>${w}</X><Y>${h/2}</Y></LineTo><LineTo IX="3"><X>${w/2}</X><Y>${h}</Y></LineTo><LineTo IX="4"><X>0</X><Y>${h/2}</Y></LineTo><LineTo IX="5"><X>${w/2}</X><Y>0</Y></LineTo></Geom><Text>${vdxEsc(text)}</Text></Shape>`;
  }
  function vdxLine(id, x1, y1, x2, y2, label, color){
    const cx = (x1+x2)/2, cy = (y1+y2)/2;
    const w = Math.abs(x2-x1) || 0.001, h = Math.abs(y2-y1) || 0.001;
    const lc = color || '#1F4E79';
    return `<Shape ID="${id}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3"><XForm><PinX>${cx}</PinX><PinY>${cy}</PinY><Width>${w}</Width><Height>${h}</Height><LocPinX>${w/2}</LocPinX><LocPinY>${h/2}</LocPinY></XForm><XForm1D><BeginX>${x1}</BeginX><BeginY>${y1}</BeginY><EndX>${x2}</EndX><EndY>${y2}</EndY></XForm1D><Line><LineWeight>0.015</LineWeight><LineColor>${lc}</LineColor><EndArrow>4</EndArrow><EndArrowSize>2</EndArrowSize></Line><Fill><FillPattern>0</FillPattern></Fill><Char IX="0"><Font>2</Font><Size>0.09</Size><Color>${lc}</Color></Char><Para IX="0"><HorzAlign>1</HorzAlign></Para><Geom IX="0"><NoFill>1</NoFill><MoveTo IX="1"><X>${x1<x2?0:w}</X><Y>${y1<y2?0:h}</Y></MoveTo><LineTo IX="2"><X>${x1<x2?w:0}</X><Y>${y1<y2?h:0}</Y></LineTo></Geom><Text>${vdxEsc(label||'')}</Text></Shape>`;
  }

  function downloadVsdx(){
    if (!state.steps || !state.steps.length){ alert('No data to export. Generate the process map first.'); return; }
    const lay = computeLayout();
    // Convert layout px -> Visio inches (1in = 96 px), flip Y (Visio origin = bottom-left)
    const PX = 1/96;
    const totalW = Math.max(800, lay.totalW || 1200);
    const totalH = Math.max(600, lay.totalH || 900);
    const pageW = totalW * PX;
    const pageH = totalH * PX;
    const boxWpx = 160, boxHpx = 70;
    const bw = boxWpx * PX, bh = boxHpx * PX;

    const fillFor = t => t==='decision' ? '#FFF2CC'
      : (t==='start'||t==='end') ? '#DCEBD4'
      : t==='approval' ? '#FCD5B4'
      : t==='document' ? '#DEEAF6'
      : '#DEEAF6';

    let id = 1, shapes = '';

    // Swimlane bands (as horizontal or vertical stripes based on mode)
    const mode = (typeof effectiveMode === 'function') ? effectiveMode() : 'vertical';
    if (lay.laneRects && lay.laneRects.length){
      lay.laneRects.forEach(lr => {
        const x = lr.x * PX, y = lr.y * PX, w = lr.w * PX, h = lr.h * PX;
        const cx = x + w/2, cy = pageH - (y + h/2);
        shapes += vdxRect(id++, cx, cy, w, h, lr.color || '#F2F2F2', '#1F4E79', '', false);
      });
    }

    // Shapes for steps
    const posById = {};
    state.steps.forEach(st => {
      if (st.type === 'note') return;
      const p = lay.stepPos[st.id]; if (!p) return;
      const cxPx = p.x + boxWpx/2, cyPx = p.y + boxHpx/2;
      const cx = cxPx * PX, cy = pageH - cyPx * PX;
      posById[st.id] = { cx, cy };
      const label = `${st.name || st.id}` + (st.department ? `\n(${st.department})` : '');
      if (st.type === 'decision'){
        shapes += vdxDiamond(id++, cx, cy, bw, bh, label);
      } else {
        shapes += vdxRect(id++, cx, cy, bw, bh, fillFor(st.type), '#1F4E79', label, st.type==='start'||st.type==='end');
      }
    });

    // Connectors
    state.steps.forEach(st => {
      if (st.type === 'note') return;
      const from = posById[st.id]; if (!from) return;
      (st.nexts || []).forEach((nid, i) => {
        const to = posById[nid]; if (!to) return;
        const lbl = (st.branchLabels && st.branchLabels[i]) || '';
        const isYes = /^(yes|approv)/i.test(lbl);
        const isNo  = /^(no|reject)/i.test(lbl);
        const color = isYes ? '#2E7D32' : isNo ? '#C62828' : '#37474F';
        // Attach to edge centers so arrows land cleanly
        const dx = to.cx - from.cx, dy = to.cy - from.cy;
        let x1 = from.cx, y1 = from.cy, x2 = to.cx, y2 = to.cy;
        if (Math.abs(dx) >= Math.abs(dy)){
          x1 += (dx > 0 ? bw/2 : -bw/2);
          x2 += (dx > 0 ? -bw/2 :  bw/2);
        } else {
          y1 += (dy > 0 ? bh/2 : -bh/2);
          y2 += (dy > 0 ? -bh/2 :  bh/2);
        }
        shapes += vdxLine(id++, x1, y1, x2, y2, lbl, color);
      });
    });

    // Annotations
    state.steps.forEach(st => {
      if (!st.annotation) return;
      const p = lay.stepPos[st.id]; if (!p) return;
      const cx = (p.x + boxWpx + 90) * PX;
      const cy = pageH - (p.y + boxHpx/2) * PX;
      shapes += vdxRect(id++, cx, cy, 1.6, 0.7, '#FFFDE7', '#9E9E9E', st.annotation, false);
    });

    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<VisioDocument xmlns="http://schemas.microsoft.com/visio/2003/core" start="190" metric="0" DocLangID="1033" buildnum="6360" version="11.0" xml:space="preserve">
<DocumentProperties><Title>${vdxEsc(state.title||'Process Map')}</Title><Creator>Process Assurance Tracker</Creator></DocumentProperties>
<DocumentSettings TopPage="0" DefaultTextStyle="3" DefaultLineStyle="3" DefaultFillStyle="3" DefaultGuideStyle="4"><GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings></DocumentSettings>
<FaceNames><FaceName ID="2" Name="Calibri" Panos="2 15 5 2 2 2 4 3 2 4" Flags="325"/></FaceNames>
<StyleSheets><StyleSheet ID="0" NameU="No Style" Name="No Style"/><StyleSheet ID="3" NameU="Normal" Name="Normal" LineStyle="0" FillStyle="0" TextStyle="0"><Char IX="0"><Font>2</Font><Color>0</Color><Size>0.1666</Size></Char></StyleSheet><StyleSheet ID="4" NameU="Guide" Name="Guide"/></StyleSheets>
<Pages><Page ID="0" NameU="Page-1" Name="Page-1"><PageSheet LineStyle="0" FillStyle="0" TextStyle="0"><PageProps><PageWidth>${pageW.toFixed(3)}</PageWidth><PageHeight>${pageH.toFixed(3)}</PageHeight><PageScale>1</PageScale><DrawingScale>1</DrawingScale><DrawingSizeType>3</DrawingSizeType></PageProps><PrintProps><PrintPageOrientation>2</PrintPageOrientation><PaperKind>8</PaperKind></PrintProps></PageSheet>
<Shapes>${shapes}</Shapes></Page></Pages></VisioDocument>`;

    const blob = new Blob([xml], { type:'application/vnd.visio' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.title || 'process-map').replace(/[^\w\-]+/g, '_') + '.vdx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Excel template ----------
  function downloadTemplate(){
    if (!window.XLSX){ alert('Excel library not loaded.'); return; }
    const wb = XLSX.utils.book_new();
    const rows = [
      ['Process ID','Process Name','Process No','Version','Step ID','Step Name','Step Type','Swimlane','Sequence','Parent Step','Next Step(s)','Branch Label','Annotation','Shape','Previous Step(s)'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S001','Process Start','Start','Sales Department',1,'','S002','','','Start',''],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S002','Need to create new client (cash)','Process','Sales Department',2,'S001','S003','','','Process','S001'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S003','Proposal for prices (Max 15%)','Process','Pricing Team',3,'S002','S004','','','Process','S002'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S004','Negotiations with customer','Process','Sales Department',4,'S003','S005','','Cash clients may receive 10-15%','Process','S003'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S005','After customer acceptance','Process','Sales Department',5,'S004','S006','','','Process','S004'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S006',"Approval client's price list",'Approval','Pricing Team',6,'S005','S007','','','Approval','S005'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S007','Request documents from customer','Document','Sales Department',7,'S006','S008','','','Document','S006'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S008','Reviewed and accepted','Approval','Sales Department',8,'S007','S009','','','Approval','S007'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S009','Send supporting documents to Legal','Process','Sales Department',9,'S008','S010','','','Process','S008'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S010','Reviewed and accepted legally','Approval','Legal',10,'S009','S011','','','Approval','S009'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S011','Send documents to Master Data','Process','Legal',11,'S010','S012','','Tax No., approved price','Process','S010'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S012','Review all documents/data','Process','Master Data Control',12,'S011','S013','','','Process','S011'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S013','Create client on LMS and assign','Process','Master Data Control',13,'S012','S014','','','Process','S012'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S014','Extract/Review client on LMS','Process','Master Data Control',14,'S013','S015','','','Process','S013'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S015','Confirmation','Approval','Pricing Team',15,'S014','S016','','','Approval','S014'],
      ['MD-PS001','Create new client (Cash) on LMS','MD-PS001','1','S016','Process End','End','Master Data Control',16,'S015','','','','End','S015']
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'ProcessMap');
    XLSX.writeFile(wb, 'process-map-template.xlsx');
  }

  // ---------- Excel upload ----------
  async function handleExcel(file, token){
    if (!window.XLSX){ alert('Excel library not loaded.'); return; }
    const ta = document.getElementById('pmData');
    resetAll();
    if (ta){ ta.value=''; ta.dataset.dirty=''; }
    const svg = document.getElementById('pmMap'); if (svg){ svg.innerHTML=''; svg.removeAttribute('viewBox'); }
    try {
      const buf = await file.arrayBuffer();
      if (token !== lastExcelUploadToken) return;
      const wb = XLSX.read(new Uint8Array(buf), { type:'array', cellDates:true });
      const uni = findUnifiedSheet(wb);
      let ok = false;
      if (uni){ ok = loadUnified(uni.rows); }
      if (!ok){ ok = loadFromWorkbookLegacy(wb); }
      if (!ok){
        for (const name of (wb.SheetNames||[])){
          const ws = wb.Sheets[name]; if (!ws) continue;
          const tsv = XLSX.utils.sheet_to_csv(ws, { FS:'\t' });
          if (parseLegacyText(tsv)){ ok=true; break; }
        }
      }
      if (!ok){ alert('No recognizable data. Expected columns include Process ID, Step ID, Step Name, Step Type, Swimlane, Sequence, Next Step(s).'); return; }
      renderProcessSelector();
      render();
    } catch (err){
      console.error(err);
      alert('Failed to read Excel: '+(err && err.message ? err.message : err));
    }
  }

  function renderProcessSelector(){
    let sel = document.getElementById('pmProcessSelector');
    const host = document.getElementById('pmSelectorHost') || document.getElementById('pmMapWrap')?.parentNode;
    if (!host) return;
    if (state.processOrder.length < 2){
      if (sel) sel.parentNode.style.display = 'none';
      return;
    }
    if (!sel){
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin:8px 0 12px;display:flex;gap:10px;align-items:center;';
      wrap.innerHTML = `<label style="font-size:12px;font-weight:600;color:#374151;">Select Process:</label>`;
      sel = document.createElement('select');
      sel.id = 'pmProcessSelector';
      sel.style.cssText = 'padding:6px 8px;border:1px solid #cfd6df;border-radius:6px;font-size:13px;min-width:280px;';
      sel.addEventListener('change', () => { activateProcess(sel.value); render(); });
      wrap.appendChild(sel);
      const anchor = document.getElementById('pmMapWrap');
      anchor.parentNode.insertBefore(wrap, anchor);
    } else {
      sel.parentNode.style.display = 'flex';
    }
    sel.innerHTML = state.processOrder.map(pid => {
      const p = state.processes[pid];
      const label = `${p.pid}${p.title ? ' — '+p.title : ''}`;
      return `<option value="${esc(pid)}"${pid===state.currentPid?' selected':''}>${esc(label)}</option>`;
    }).join('');
  }

  function ensureLayoutModeSelector(){
    if (document.getElementById('pmLayoutMode')) return;
    const anchor = document.getElementById('pmMapWrap');
    if (!anchor || !anchor.parentNode) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:6px 0 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
    wrap.innerHTML = `<label style="font-size:12px;font-weight:600;color:#374151;">Layout mode:</label>`;
    const sel = document.createElement('select');
    sel.id = 'pmLayoutMode';
    sel.style.cssText = 'padding:6px 8px;border:1px solid #cfd6df;border-radius:6px;font-size:13px;';
    sel.innerHTML = `
      <option value="vertical">IDH Standard — Top-to-bottom (recommended)</option>
      <option value="horizontal">Horizontal Flow — Left-to-right</option>
      <option value="auto">Auto — minimize crossings</option>`;
    sel.value = state.layoutMode;
    sel.addEventListener('change', () => {
      state.layoutMode = sel.value;
      state.positions = {};
      state.view = { scale:1, tx:0, ty:0 };
      render();
    });
    wrap.appendChild(sel);
    anchor.parentNode.insertBefore(wrap, anchor);
  }

  function generate(){
    const ta = document.getElementById('pmData');
    const hasText = !!(ta && ta.value.trim());
    const isDirty = !!(ta && ta.dataset.dirty==='1');
    if (isDirty){
      resetAll();
      if (hasText) parseLegacyText(ta.value);
      ta.dataset.dirty='';
    } else if (!state.steps.length && hasText){
      parseLegacyText(ta.value); ta.dataset.dirty='';
    }
    if (!state.steps.length){ alert('No data to render. Upload the Excel file or paste data first.'); return; }
    renderProcessSelector();
    ensureLayoutModeSelector();
    render();
  }

  // ---------- Init ----------
  function init(){
    const btn = document.getElementById('pmGenerate'); if (!btn) return;
    btn.addEventListener('click', generate);
    document.getElementById('pmDownloadPdf')?.addEventListener('click', downloadPdf);
    document.getElementById('pmDownloadPng')?.addEventListener('click', downloadPng);
    document.getElementById('pmDownloadSvg')?.addEventListener('click', downloadSvg);
    document.getElementById('pmDownloadVsdx')?.addEventListener('click', downloadVsdx);
    let tplBtn = document.getElementById('pmDownloadTemplate');
    if (!tplBtn){
      const vsdxBtn = document.getElementById('pmDownloadVsdx');
      if (vsdxBtn && vsdxBtn.parentNode){
        tplBtn = document.createElement('button');
        tplBtn.type='button'; tplBtn.className='pm-btn'; tplBtn.id='pmDownloadTemplate';
        tplBtn.textContent='Download Excel Template';
        vsdxBtn.parentNode.insertBefore(tplBtn, vsdxBtn.nextSibling);
        const rz = document.createElement('button');
        rz.type='button'; rz.className='pm-btn'; rz.id='pmResetView'; rz.textContent='Reset View';
        vsdxBtn.parentNode.insertBefore(rz, tplBtn.nextSibling);
        rz.addEventListener('click', () => {
          state.view = { scale:1, tx:0, ty:0 };
          state.positions = {}; state.collapsed = {};
          render();
        });
      }
    }
    document.getElementById('pmDownloadTemplate')?.addEventListener('click', downloadTemplate);

    const fi = document.getElementById('pmExcelFile');
    fi?.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      const token = ++lastExcelUploadToken;
      e.target.value='';
      if (f) handleExcel(f, token);
    });
    const ta = document.getElementById('pmData');
    if (ta){
      ta.value=''; ta.defaultValue=''; ta.dataset.dirty='';
      ta.setAttribute('autocomplete','off');
      ta.addEventListener('input', () => { ta.dataset.dirty='1'; });
    }
    const tab = document.querySelector('.tab[data-tab="processMap"]');
    if (tab){
      tab.addEventListener('click', () => {
        const svg = document.getElementById('pmMap');
        const ta2 = document.getElementById('pmData');
        if (svg && !svg.innerHTML.trim() && (state.steps.length || (ta2 && ta2.value.trim()))) generate();
      });
    }
    // Re-render on window resize so vertical layout keeps fitting browser width
    let rz;
    window.addEventListener('resize', () => {
      clearTimeout(rz);
      rz = setTimeout(() => { if (state.steps.length) render(); }, 150);
    });
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
