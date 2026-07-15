/* Process Map Generator v2 — swimlane SVG with departments/timeline/decisions
 *
 * Supported input:
 *  A) Excel workbook with 3 sheets: ProcessSteps, Departments, Timeline
 *     - ProcessSteps columns: Step ID, Previous Step, Step Name, Step Type,
 *       Department, Owner, Decision Question, Yes Next, No Next, SLA (Days),
 *       Week, Document, Status Color, Notes
 *     - Departments columns: Department, Color, Order
 *     - Timeline columns:    Week, Start X Position
 *  B) Legacy single-sheet paste (Seq, Activity, Role, Approver, SLA)
 *
 * Rendering: SVG with rounded-rect / oval / diamond / document / hexagon /
 * hourglass shapes, department swimlanes, timeline header, auto-connectors,
 * decision Yes/No branches, drag-to-reposition, wheel zoom + drag pan,
 * click-to-collapse lanes, and PNG / SVG / PDF / VDX export.
 */
(function(){
  // ---------- Constants ----------
  const DEFAULT_LANE_COLORS = ['#B6CDEA','#E9B4CD','#B9D5A7','#C6BADF','#F6CB92','#A9D3CB','#EBCA84','#BFBFBF'];
  const STATUS_COLORS = {
    blue:'#DEEAF6', green:'#DCEBD4', yellow:'#FFF2CC',
    red:'#F8CBAD',  orange:'#FCD5B4', gray:'#E7E6E6', grey:'#E7E6E6'
  };
  const SHAPE_TYPES = ['start','process','decision','document','end','delay','approval'];

  // ---------- State ----------
  const state = {
    steps: [],          // normalized step objects
    departments: [],    // {name, color, order}
    timeline: [],       // {week, x}
    positions: {},      // stepId -> {x,y}  (user drag overrides)
    collapsed: {},      // deptName -> bool
    view: { scale:1, tx:0, ty:0 },
    title: '', pno: '', ver: ''
  };
  let lastExcelUploadToken = 0;

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
    const k = s.toLowerCase();
    return STATUS_COLORS[k] || s;
  }
  function normShape(t){
    const s = String(t||'process').toLowerCase().trim();
    return SHAPE_TYPES.includes(s) ? s : 'process';
  }

  // ---------- Parsing: sheet rows -> {header, rows} ----------
  function sheetToObjects(ws){
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:false });
    if (!rows.length) return [];
    // Find header row: first row containing at least one non-empty string cell that isn't numeric
    let hi = 0;
    for (let i=0; i<Math.min(rows.length,3); i++){
      const nonEmpty = rows[i].filter(c => String(c).trim() !== '');
      if (nonEmpty.length >= 2){ hi = i; break; }
    }
    const headers = rows[hi].map(normHeader);
    const out = [];
    for (let i=hi+1; i<rows.length; i++){
      const r = rows[i];
      if (!r.some(c => String(c).trim() !== '')) continue;
      const obj = {};
      headers.forEach((h,idx) => { if (h) obj[h] = r[idx]; });
      out.push(obj);
    }
    return out;
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

  // ---------- Normalize into state.steps / state.departments / state.timeline ----------
  function loadFromWorkbook(wb){
    const psSheet = findSheet(wb, 'ProcessSteps', 'Process Steps', 'Steps');
    if (!psSheet) return false;
    const psRows = sheetToObjects(psSheet);
    if (!psRows.length) return false;

    const deptSheet = findSheet(wb, 'Departments', 'Swimlanes', 'Department');
    const tlSheet   = findSheet(wb, 'Timeline', 'Weeks', 'Time');

    state.steps = psRows.map(r => normalizeStep(r)).filter(s => s.id != null);
    state.departments = deptSheet ? sheetToObjects(deptSheet).map((d,i)=>({
      name: String(d.department||'').trim(),
      color: resolveColor(d.color) || DEFAULT_LANE_COLORS[i % DEFAULT_LANE_COLORS.length],
      order: Number(d.order)||i
    })).filter(d=>d.name) : [];
    state.timeline = tlSheet ? sheetToObjects(tlSheet).map(t => ({
      week: String(t.week||'').trim(),
      x: Number(t.startxposition ?? t.x ?? t.startx)||0
    })).filter(t=>t.week) : [];

    // Fill missing departments from steps
    const seen = new Set(state.departments.map(d=>d.name.toLowerCase()));
    state.steps.forEach(s => {
      const d = s.department||'General';
      if (!seen.has(d.toLowerCase())){
        state.departments.push({ name:d, color: DEFAULT_LANE_COLORS[state.departments.length % DEFAULT_LANE_COLORS.length], order: state.departments.length });
        seen.add(d.toLowerCase());
      }
    });
    state.departments.sort((a,b)=>a.order-b.order);

    // Fill missing timeline weeks from steps preserving first-seen order
    if (!state.timeline.length){
      const tSeen = new Set(); const tl = [];
      state.steps.forEach(s => {
        const w = s.week || 'Week 1';
        if (!tSeen.has(w)){ tl.push({ week:w, x: tl.length }); tSeen.add(w); }
      });
      state.timeline = tl;
    }
    return true;
  }

  function normalizeStep(r){
    const num = v => { const n = parseInt(String(v).match(/-?\d+/)?.[0]); return isNaN(n)?null:n; };
    return {
      id: num(r.stepid ?? r.id ?? r.seq),
      prev: r.previousstep!=null && String(r.previousstep).trim()!=='' ? String(r.previousstep).trim() : null,
      name: String(r.stepname ?? r.activity ?? r.name ?? '').trim(),
      type: normShape(r.steptype ?? r.type ?? 'process'),
      department: String(r.department ?? r.swimlane ?? r.role ?? 'General').trim(),
      owner: String(r.owner ?? r.approver ?? r.responsible ?? '').trim(),
      question: String(r.decisionquestion ?? r.question ?? '').trim(),
      yesNext: num(r.yesnext),
      noNext: num(r.nonext),
      sla: String(r.sladays ?? r.sla ?? '').trim(),
      week: String(r.week ?? '').trim() || 'Week 1',
      document: String(r.document ?? '').trim(),
      color: resolveColor(r.statuscolor ?? r.color),
      notes: String(r.notes ?? '').trim()
    };
  }

  // ---------- Legacy TSV parsing (paste box) ----------
  function parseLegacyText(text){
    const lines = text.trim().split(/\r?\n/).filter(l=>l.trim());
    if (!lines.length) return false;
    const sep = lines[0].includes('\t') ? '\t' : (lines[0].includes(',') ? ',' : /\s{2,}/);
    const rows = lines.map(l => typeof sep === 'string' ? l.split(sep).map(c=>c.trim()) : l.split(sep).map(c=>c.trim()));
    const header = rows[0].map(normHeader).join('|');
    const isNewFormat = /stepid|steptype|department|decisionquestion|yesnext/.test(header);
    if (isNewFormat){
      const headers = rows[0].map(normHeader);
      const objs = rows.slice(1).filter(r => r.some(c=>c)).map(r => {
        const o={}; headers.forEach((h,i)=>{ if(h) o[h]=r[i]; }); return o;
      });
      state.steps = objs.map(normalizeStep).filter(s=>s.id!=null);
    } else {
      // Old 5-col legacy
      if (isNaN(parseInt(rows[0][0]))) rows.shift();
      state.steps = rows.map((r,i) => ({
        id: parseInt(r[0])||(i+1),
        prev: i===0 ? null : String(parseInt(rows[i-1][0])||i),
        name: r[1]||'',
        type: 'process',
        department: r[2]||'General',
        owner: r[3]||'',
        question: '', yesNext:null, noNext:null,
        sla: r[4]||'',
        week: 'Week 1',
        document: '',
        color: '#DEEAF6',
        notes: ''
      })).filter(s => s.name);
    }
    // Rebuild depts / timeline defaults
    state.departments = [];
    const seen = new Set();
    state.steps.forEach(s => {
      if (!seen.has(s.department.toLowerCase())){
        state.departments.push({ name:s.department, color: DEFAULT_LANE_COLORS[state.departments.length%DEFAULT_LANE_COLORS.length], order: state.departments.length });
        seen.add(s.department.toLowerCase());
      }
    });
    const tSeen = new Set(); state.timeline = [];
    state.steps.forEach(s => { if(!tSeen.has(s.week)){ state.timeline.push({week:s.week,x:state.timeline.length}); tSeen.add(s.week); }});
    return state.steps.length > 0;
  }

  // ---------- Layout ----------
  const LAYOUT = {
    laneHeaderW: 150, headerH: 60, weekHeaderH: 34,
    laneH: 140, colW: 220, padL: 12, padR: 60,
    boxW: 180, boxH: 78
  };

  function computeLayout(){
    const L = LAYOUT;
    const nCols = Math.max(1, state.timeline.length);
    const visibleDepts = state.departments.filter(d => !state.collapsed[d.name]);
    const collapsedCount = state.departments.length - visibleDepts.length;
    const collapsedH = 22;
    const totalW = L.laneHeaderW + L.padL + nCols*L.colW + L.padR;
    const totalH = L.headerH + L.weekHeaderH + visibleDepts.length*L.laneH + collapsedCount*collapsedH + 20;
    // Lane Y map
    const laneY = {}; let y = L.headerH + L.weekHeaderH;
    state.departments.forEach(d => {
      laneY[d.name] = { y, h: state.collapsed[d.name] ? collapsedH : L.laneH, collapsed: !!state.collapsed[d.name] };
      y += state.collapsed[d.name] ? collapsedH : L.laneH;
    });
    // Week x map
    const weekX = {};
    state.timeline.forEach((t,i) => {
      const idx = Number.isFinite(t.x) ? t.x : i;
      weekX[t.week] = L.laneHeaderW + L.padL + idx*L.colW;
    });
    // Per-cell auto stacking for shapes in same (dept,week)
    const cellCount = {};
    const stepPos = {};
    state.steps.forEach(s => {
      const lane = laneY[s.department] || { y:L.headerH+L.weekHeaderH, h:L.laneH, collapsed:false };
      const cx0 = weekX[s.week] != null ? weekX[s.week] : L.laneHeaderW + L.padL;
      const key = s.department+'|'+s.week;
      const k = (cellCount[key] = (cellCount[key]||0) + 1) - 1;
      const cellY = lane.y + (lane.h - L.boxH)/2 + (k*20);
      const cellX = cx0 + 20 + (k*15);
      // User drag override
      const p = state.positions[s.id];
      stepPos[s.id] = { x: p?.x ?? cellX, y: p?.y ?? cellY, lane, hidden: lane.collapsed };
    });
    return { totalW, totalH, laneY, weekX, stepPos, visibleDepts };
  }

  // ---------- Shape rendering ----------
  function shapePath(type, x, y, w, h){
    const r = 12;
    switch(type){
      case 'start': case 'end':
        return { tag:'ellipse', attrs:{ cx:x+w/2, cy:y+h/2, rx:w/2, ry:h/2 } };
      case 'decision':
        return { tag:'polygon', attrs:{ points:`${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}` } };
      case 'document':
        return { tag:'path', attrs:{ d:`M${x},${y} L${x+w},${y} L${x+w},${y+h-10} Q${x+w*0.75},${y+h+6} ${x+w/2},${y+h-6} Q${x+w*0.25},${y+h-14} ${x},${y+h-6} Z` } };
      case 'delay':
        return { tag:'polygon', attrs:{ points:`${x},${y} ${x+w},${y} ${x+w/2},${y+h/2} ${x+w},${y+h} ${x},${y+h} ${x+w/2},${y+h/2}` } };
      case 'approval':
        return { tag:'polygon', attrs:{ points:`${x+18},${y} ${x+w-18},${y} ${x+w},${y+h/2} ${x+w-18},${y+h} ${x+18},${y+h} ${x},${y+h/2}` } };
      case 'process':
      default:
        return { tag:'rect', attrs:{ x,y,width:w,height:h,rx:r,ry:r } };
    }
  }

  function shapeAnchor(type, x, y, w, h, side){
    // side: 'l','r','t','b' — return {x,y}
    const cx = x+w/2, cy = y+h/2;
    if (type==='decision'){
      if (side==='r') return { x:x+w, y:cy };
      if (side==='l') return { x, y:cy };
      if (side==='t') return { x:cx, y };
      if (side==='b') return { x:cx, y:y+h };
    }
    if (type==='start' || type==='end'){
      const rx=w/2, ry=h/2;
      if (side==='r') return { x:x+w, y:cy };
      if (side==='l') return { x, y:cy };
      if (side==='t') return { x:cx, y:cy-ry };
      if (side==='b') return { x:cx, y:cy+ry };
    }
    if (side==='r') return { x:x+w, y:cy };
    if (side==='l') return { x, y:cy };
    if (side==='t') return { x:cx, y };
    if (side==='b') return { x:cx, y:y+h };
    return { x:cx, y:cy };
  }

  function sideForConnector(from, to){
    // Prefer right->left if to is to the right; else left->right; else bottom/top
    if (to.x > from.x + 5) return { a:'r', b:'l' };
    if (to.x < from.x - 5) return { a:'l', b:'r' };
    if (to.y > from.y) return { a:'b', b:'t' };
    return { a:'t', b:'b' };
  }

  function connectorPath(ax, ay, bx, by, aSide, bSide){
    // Orthogonal 3-segment routing
    if (aSide==='r' || aSide==='l'){
      const midX = (ax+bx)/2;
      return `M ${ax} ${ay} L ${midX} ${ay} L ${midX} ${by} L ${bx} ${by}`;
    } else {
      const midY = (ay+by)/2;
      return `M ${ax} ${ay} L ${ax} ${midY} L ${bx} ${midY} L ${bx} ${by}`;
    }
  }

  // ---------- Main render ----------
  function render(){
    const svg = document.getElementById('pmMap');
    if (!state.steps.length){ svg.innerHTML=''; svg.removeAttribute('viewBox'); return; }
    state.title = document.getElementById('pmTitle')?.value || state.title;
    state.pno   = document.getElementById('pmNo')?.value   || state.pno;
    state.ver   = document.getElementById('pmVer')?.value  || state.ver;

    const L = LAYOUT;
    const layout = computeLayout();
    const { totalW, totalH, laneY, weekX, stepPos } = layout;

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

    // Title bar
    s += `<rect x="0" y="0" width="${totalW}" height="${L.headerH}" fill="#f4f7fb" stroke="#1f4e79"/>`;
    s += `<text x="14" y="24" font-size="14" font-weight="bold" fill="#1f3a8a">${esc(state.title||'Process Map')}</text>`;
    s += `<text x="14" y="44" font-size="11" fill="#374151">Process no. ${esc(state.pno)}   ·   Version ${esc(state.ver)}   ·   ${state.steps.length} activities</text>`;

    // Timeline header
    s += `<rect x="0" y="${L.headerH}" width="${L.laneHeaderW}" height="${L.weekHeaderH}" fill="#eef2f7" stroke="#1f4e79"/>`;
    s += `<text x="${L.laneHeaderW/2}" y="${L.headerH + L.weekHeaderH/2 + 4}" text-anchor="middle" font-size="11" font-weight="bold" fill="#1f3a8a">Department \\ Week</text>`;
    state.timeline.forEach((t,i) => {
      const x = weekX[t.week];
      s += `<rect x="${x}" y="${L.headerH}" width="${L.colW}" height="${L.weekHeaderH}" fill="#eef2f7" stroke="#1f4e79"/>`;
      s += `<text x="${x + L.colW/2}" y="${L.headerH + L.weekHeaderH/2 + 4}" text-anchor="middle" font-size="12" font-weight="bold" fill="#1f3a8a">${esc(t.week)}</text>`;
    });

    // Swimlanes
    state.departments.forEach(d => {
      const lane = laneY[d.name];
      if (lane.collapsed){
        s += `<rect x="0" y="${lane.y}" width="${totalW}" height="${lane.h}" fill="#f7f9fc" stroke="#1f4e79" class="pm-lane-collapsed" data-dept="${esc(d.name)}" style="cursor:pointer"/>`;
        s += `<text x="10" y="${lane.y + lane.h/2 + 4}" font-size="11" font-weight="bold" fill="#1f3a8a" style="pointer-events:none">▸ ${esc(d.name)} (collapsed — click to expand)</text>`;
        return;
      }
      s += `<rect x="0" y="${lane.y}" width="${L.laneHeaderW}" height="${lane.h}" fill="${d.color}" stroke="#1f4e79" class="pm-lane-header" data-dept="${esc(d.name)}" style="cursor:pointer"/>`;
      s += `<rect x="${L.laneHeaderW}" y="${lane.y}" width="${totalW - L.laneHeaderW}" height="${lane.h}" fill="#ffffff" stroke="#1f4e79"/>`;
      const cx = L.laneHeaderW/2, cy = lane.y + lane.h/2;
      s += `<text x="${cx}" y="${cy}" font-size="12" font-weight="bold" text-anchor="middle" transform="rotate(-90 ${cx} ${cy})" style="pointer-events:none">▾ ${esc(d.name)}</text>`;
      // Week column dividers
      state.timeline.forEach(t => {
        const x = weekX[t.week] + L.colW;
        s += `<line x1="${x}" y1="${lane.y}" x2="${x}" y2="${lane.y + lane.h}" stroke="#e3e8ef"/>`;
      });
    });

    // Connectors first (so shapes overlay)
    const stepById = {}; state.steps.forEach(st => { stepById[st.id] = st; });
    const drawConn = (fromId, toId, kind, labelOverride) => {
      const from = stepById[fromId], to = stepById[toId];
      if (!from || !to) return '';
      const pf = stepPos[fromId], pt = stepPos[toId];
      if (!pf || !pt || pf.hidden || pt.hidden) return '';
      const sides = sideForConnector({x:pf.x+L.boxW/2, y:pf.y+L.boxH/2}, {x:pt.x+L.boxW/2, y:pt.y+L.boxH/2});
      const a = shapeAnchor(from.type, pf.x, pf.y, L.boxW, L.boxH, sides.a);
      const b = shapeAnchor(to.type,   pt.x, pt.y, L.boxW, L.boxH, sides.b);
      const path = connectorPath(a.x, a.y, b.x, b.y, sides.a, sides.b);
      const marker = kind==='yes' ? 'pmArrYes' : kind==='no' ? 'pmArrNo' : 'pmArr';
      const color  = kind==='yes' ? '#2e7d32' : kind==='no' ? '#c62828' : '#1f4e79';
      let out = `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.6" marker-end="url(#${marker})"/>`;
      const label = labelOverride || (to.sla ? `SLA: ${to.sla}d` : '');
      if (label){
        const mx = (a.x + b.x)/2, my = (a.y + b.y)/2 - 6;
        out += `<rect x="${mx-28}" y="${my-11}" width="56" height="15" rx="3" fill="#fff" stroke="${color}" stroke-width="0.6"/>`;
        out += `<text x="${mx}" y="${my}" text-anchor="middle" font-size="10" fill="${color}">${esc(label)}</text>`;
      }
      return out;
    };

    state.steps.forEach(st => {
      if (st.type==='decision'){
        if (st.yesNext!=null) s += drawConn(st.id, st.yesNext, 'yes', 'Yes');
        if (st.noNext!=null)  s += drawConn(st.id, st.noNext,  'no',  'No');
      } else if (st.prev){
        // prev may reference multiple? treat single
        s += drawConn(parseInt(st.prev), st.id, 'plain', st.sla ? `SLA: ${st.sla}d` : '');
      }
    });

    // Shapes
    state.steps.forEach(st => {
      const p = stepPos[st.id]; if (!p || p.hidden) return;
      const sh = shapePath(st.type, p.x, p.y, L.boxW, L.boxH);
      const fill = st.color || '#DEEAF6';
      const attrStr = Object.entries(sh.attrs).map(([k,v])=>`${k}="${v}"`).join(' ');
      s += `<g class="pm-node" data-id="${st.id}" style="cursor:move">`;
      s += `<${sh.tag} ${attrStr} fill="${fill}" stroke="#1f4e79" stroke-width="1.5" filter="url(#pmShadow)"/>`;
      // Text
      const isDec = st.type==='decision';
      const label = isDec ? (st.question || st.name) : st.name;
      const lines = wrap(label, isDec?16:26).slice(0, isDec?3:2);
      s += `<text x="${p.x + L.boxW/2}" y="${p.y + 14}" text-anchor="middle" font-size="10" font-weight="bold" fill="#0f172a" style="pointer-events:none">${st.id}${isDec?' ?':''}</text>`;
      lines.forEach((ln,li) => {
        s += `<text x="${p.x + L.boxW/2}" y="${p.y + 30 + li*13}" text-anchor="middle" font-size="10.5" fill="#0f172a" style="pointer-events:none">${esc(ln)}</text>`;
      });
      if (!isDec){
        s += `<text x="${p.x + L.boxW/2}" y="${p.y + L.boxH - 16}" text-anchor="middle" font-size="9" fill="#475569" style="pointer-events:none">Owner: ${esc(st.owner||'—')}</text>`;
        if (st.sla) s += `<text x="${p.x + L.boxW/2}" y="${p.y + L.boxH - 4}" text-anchor="middle" font-size="9" fill="#475569" style="pointer-events:none">SLA: ${esc(st.sla)}d</text>`;
      }
      // Document icon
      if (st.document){
        const dx = p.x + L.boxW - 14, dy = p.y + 4;
        s += `<g style="pointer-events:none"><rect x="${dx}" y="${dy}" width="10" height="12" fill="#fffbe6" stroke="#b45309" stroke-width="0.8"/><line x1="${dx+2}" y1="${dy+3}" x2="${dx+8}" y2="${dy+3}" stroke="#b45309"/><line x1="${dx+2}" y1="${dy+6}" x2="${dx+8}" y2="${dy+6}" stroke="#b45309"/><line x1="${dx+2}" y1="${dy+9}" x2="${dx+6}" y2="${dy+9}" stroke="#b45309"/><title>${esc(st.document)}</title></g>`;
      }
      // Notes tooltip
      if (st.notes) s += `<title>${esc(st.notes)}</title>`;
      s += `</g>`;
    });

    svg.innerHTML = s;
    attachInteractions(svg, layout);
  }

  // ---------- Interactions: drag nodes, wheel zoom, pan, lane collapse ----------
  function attachInteractions(svg, layout){
    const L = LAYOUT;
    // Lane header click -> toggle collapse
    svg.querySelectorAll('.pm-lane-header, .pm-lane-collapsed').forEach(el => {
      el.addEventListener('click', () => {
        const dept = el.getAttribute('data-dept');
        state.collapsed[dept] = !state.collapsed[dept];
        render();
      });
    });
    // Node drag
    let drag = null;
    svg.querySelectorAll('.pm-node').forEach(g => {
      g.addEventListener('mousedown', ev => {
        ev.stopPropagation();
        const id = +g.getAttribute('data-id');
        const pt = svgPoint(svg, ev);
        const pos = layout.stepPos[id];
        drag = { id, dx: pt.x - pos.x, dy: pt.y - pos.y };
      });
    });
    // Pan (mousedown on background)
    let pan = null;
    svg.addEventListener('mousedown', ev => {
      if (drag) return;
      if (ev.target === svg || ev.target.tagName === 'rect' && !ev.target.closest('.pm-node') && !ev.target.classList.contains('pm-lane-header') && !ev.target.classList.contains('pm-lane-collapsed')){
        pan = { x: ev.clientX, y: ev.clientY, tx: state.view.tx, ty: state.view.ty };
      }
    });
    window.addEventListener('mousemove', ev => {
      if (drag){
        const pt = svgPoint(svg, ev);
        state.positions[drag.id] = { x: pt.x - drag.dx, y: pt.y - drag.dy };
        render();
      } else if (pan){
        const dx = (ev.clientX - pan.x) / state.view.scale;
        const dy = (ev.clientY - pan.y) / state.view.scale;
        state.view.tx = pan.tx - dx;
        state.view.ty = pan.ty - dy;
        applyView(svg);
      }
    });
    window.addEventListener('mouseup', () => { drag = null; pan = null; });
    // Wheel zoom
    svg.addEventListener('wheel', ev => {
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 1.1 : 1/1.1;
      state.view.scale = Math.max(0.3, Math.min(3, state.view.scale * factor));
      applyView(svg);
    }, { passive:false });
  }

  function applyView(svg){
    const w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
    svg.setAttribute('viewBox', `${state.view.tx} ${state.view.ty} ${w/state.view.scale} ${h/state.view.scale}`);
  }
  function svgPoint(svg, ev){
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  // ---------- Exports ----------
  function svgToPngDataUrl(scale){
    return new Promise((resolve, reject) => {
      const svg = document.getElementById('pmMap');
      const w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
      const clone = svg.cloneNode(true);
      clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const xml = new XMLSerializer().serializeToString(clone);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = w*scale; c.height = h*scale;
        const ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h);
        ctx.drawImage(img,0,0);
        resolve({ url: c.toDataURL('image/png'), w, h });
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(xml)));
    });
  }
  async function downloadPng(){
    const { url } = await svgToPngDataUrl(2);
    const a = document.createElement('a'); a.href = url; a.download = 'process-map.png'; a.click();
  }
  function downloadSvg(){
    const svg = document.getElementById('pmMap');
    const blob = new Blob([svg.outerHTML], {type:'image/svg+xml'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'process-map.svg'; a.click();
  }
  async function downloadPdf(){
    if (!window.jspdf){ alert('PDF library not loaded.'); return; }
    const svg = document.getElementById('pmMap');
    if (!svg.innerHTML.trim()){ alert('Generate a process map first.'); return; }
    const { url, w, h } = await svgToPngDataUrl(2);
    const { jsPDF } = window.jspdf;
    const orientation = w >= h ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a3' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 24, headerH = 28;
    pdf.setFontSize(13); pdf.setTextColor(31,58,138);
    pdf.text('Process Map — ' + (state.title||''), margin, margin + 4);
    pdf.setFontSize(9); pdf.setTextColor(107,114,128);
    pdf.text(new Date().toLocaleString(), pageW - margin, margin + 4, { align:'right' });
    const availW = pageW - margin*2, availH = pageH - margin*2 - headerH;
    const ratio = Math.min(availW/w, availH/h);
    pdf.addImage(url, 'PNG', margin + (availW-w*ratio)/2, margin + headerH, w*ratio, h*ratio);
    pdf.save('process-map.pdf');
  }

  // ---------- Legacy VDX export (kept as-is, best effort) ----------
  function buildVdx(){
    if (!state.steps.length){ alert('Generate a process map first.'); return null; }
    const pageW = 23.4, pageH = 16.5;
    const laneHeaderW = 1.4, boxW = 1.9, boxH = 0.8, gapX = 0.4, laneH = 1.4;
    const topY = pageH - 0.7;
    const lanes = state.departments.map(d => d.name);
    const laneRects = lanes.map((role, i) => {
      const yTop = topY - i * laneH; const yBot = yTop - laneH;
      return { role, yTop, yBot, cy:(yTop+yBot)/2, color: state.departments[i].color };
    });
    const stepOrder = [...state.steps].sort((a,b)=>a.id-b.id);
    const laneIdxOf = n => Math.max(0, lanes.indexOf(n));
    const pos = {}; const cellCount = {};
    stepOrder.forEach((s, idx) => {
      const li = laneIdxOf(s.department);
      const key = s.department;
      const k = (cellCount[key] = (cellCount[key]||0) + 1) - 1;
      pos[s.id] = { x: laneHeaderW + 0.4 + idx*(boxW+gapX) + boxW/2 + k*0.05, y: laneRects[li].cy };
    });
    let id = 1, shapes = '';
    laneRects.forEach(lr => {
      shapes += vdxRect(id++, (laneHeaderW+pageW)/2, lr.cy, pageW-laneHeaderW, laneH, '#FFFFFF', '#1F4E79', '', false);
      shapes += vdxRect(id++, laneHeaderW/2, lr.cy, laneHeaderW, laneH, lr.color, '#1F4E79', lr.role, true);
    });
    stepOrder.forEach(s => {
      const p = pos[s.id]; if(!p) return;
      const label = `${s.id}. ${s.name}${s.owner?'\nOwner: '+s.owner:''}${s.sla?'\nSLA: '+s.sla+'d':''}`;
      if (s.type==='decision') shapes += vdxDiamond(id++, p.x, p.y, boxW, boxH, s.question||s.name);
      else shapes += vdxRect(id++, p.x, p.y, boxW, boxH, s.color||'#DEEAF6', '#1F4E79', label, false);
    });
    const stepById = {}; state.steps.forEach(s => stepById[s.id]=s);
    stepOrder.forEach(s => {
      if (s.type==='decision'){
        if (s.yesNext!=null && pos[s.yesNext]) shapes += vdxLine(id++, pos[s.id].x+boxW/2, pos[s.id].y, pos[s.yesNext].x-boxW/2, pos[s.yesNext].y);
        if (s.noNext!=null && pos[s.noNext])   shapes += vdxLine(id++, pos[s.id].x+boxW/2, pos[s.id].y, pos[s.noNext].x-boxW/2, pos[s.noNext].y);
      } else if (s.prev && pos[parseInt(s.prev)]){
        const a = pos[parseInt(s.prev)], b = pos[s.id];
        shapes += vdxLine(id++, a.x+boxW/2, a.y, b.x-boxW/2, b.y);
      }
    });
    return `<?xml version="1.0" encoding="utf-8" ?>
<VisioDocument xmlns="http://schemas.microsoft.com/visio/2003/core" start="190" metric="0" DocLangID="1033" buildnum="6360" version="11.0" xml:space="preserve">
<DocumentProperties><Title>${esc(state.title||'Process Map')}</Title><Creator>Process Assurance Tracker</Creator></DocumentProperties>
<DocumentSettings TopPage="0" DefaultTextStyle="3" DefaultLineStyle="3" DefaultFillStyle="3" DefaultGuideStyle="4"><GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings></DocumentSettings>
<FaceNames><FaceName ID="2" Name="Calibri" Panos="2 15 5 2 2 2 4 3 2 4" Flags="325"/></FaceNames>
<StyleSheets><StyleSheet ID="0" NameU="No Style" Name="No Style"/><StyleSheet ID="3" NameU="Normal" Name="Normal" LineStyle="0" FillStyle="0" TextStyle="0"><Char IX="0"><Font>2</Font><Color>0</Color><Size>0.1666</Size></Char></StyleSheet><StyleSheet ID="4" NameU="Guide" Name="Guide"/></StyleSheets>
<Pages><Page ID="0" NameU="Page-1" Name="Page-1"><PageSheet LineStyle="0" FillStyle="0" TextStyle="0"><PageProps><PageWidth>${pageW}</PageWidth><PageHeight>${pageH}</PageHeight><PageScale>1</PageScale><DrawingScale>1</DrawingScale><DrawingSizeType>3</DrawingSizeType></PageProps><PrintProps><PrintPageOrientation>2</PrintPageOrientation><PaperKind>8</PaperKind></PrintProps></PageSheet>
<Shapes>${shapes}</Shapes></Page></Pages></VisioDocument>`;
  }
  function vdxRect(id, cx, cy, w, h, fill, line, text, bold){
    return `<Shape ID="${id}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3"><XForm><PinX>${cx}</PinX><PinY>${cy}</PinY><Width>${w}</Width><Height>${h}</Height><LocPinX>${w/2}</LocPinX><LocPinY>${h/2}</LocPinY></XForm><Line><LineWeight>0.01</LineWeight><LineColor>${line}</LineColor><Rounding>0.05</Rounding></Line><Fill><FillForegnd>${fill}</FillForegnd><FillPattern>1</FillPattern></Fill><TextBlock><VerticalAlign>1</VerticalAlign></TextBlock><Char IX="0"><Font>2</Font><Size>${bold?0.14:0.10}</Size><Style>${bold?1:0}</Style></Char><Para IX="0"><HorzAlign>1</HorzAlign></Para><Geom IX="0"><NoFill>0</NoFill><NoLine>0</NoLine><MoveTo IX="1"><X>0</X><Y>0</Y></MoveTo><LineTo IX="2"><X>${w}</X><Y>0</Y></LineTo><LineTo IX="3"><X>${w}</X><Y>${h}</Y></LineTo><LineTo IX="4"><X>0</X><Y>${h}</Y></LineTo><LineTo IX="5"><X>0</X><Y>0</Y></LineTo></Geom><Text>${esc(text)}</Text></Shape>`;
  }
  function vdxDiamond(id, cx, cy, w, h, text){
    return `<Shape ID="${id}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3"><XForm><PinX>${cx}</PinX><PinY>${cy}</PinY><Width>${w}</Width><Height>${h}</Height><LocPinX>${w/2}</LocPinX><LocPinY>${h/2}</LocPinY></XForm><Line><LineWeight>0.01</LineWeight><LineColor>#1F4E79</LineColor></Line><Fill><FillForegnd>#FFF2CC</FillForegnd><FillPattern>1</FillPattern></Fill><TextBlock><VerticalAlign>1</VerticalAlign></TextBlock><Char IX="0"><Font>2</Font><Size>0.10</Size></Char><Para IX="0"><HorzAlign>1</HorzAlign></Para><Geom IX="0"><MoveTo IX="1"><X>${w/2}</X><Y>0</Y></MoveTo><LineTo IX="2"><X>${w}</X><Y>${h/2}</Y></LineTo><LineTo IX="3"><X>${w/2}</X><Y>${h}</Y></LineTo><LineTo IX="4"><X>0</X><Y>${h/2}</Y></LineTo><LineTo IX="5"><X>${w/2}</X><Y>0</Y></LineTo></Geom><Text>${esc(text)}</Text></Shape>`;
  }
  function vdxLine(id, x1, y1, x2, y2){
    const cx = (x1+x2)/2, cy = (y1+y2)/2;
    const w = Math.abs(x2-x1) || 0.001, h = Math.abs(y2-y1) || 0.001;
    return `<Shape ID="${id}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3"><XForm><PinX>${cx}</PinX><PinY>${cy}</PinY><Width>${w}</Width><Height>${h}</Height><LocPinX>${w/2}</LocPinX><LocPinY>${h/2}</LocPinY></XForm><XForm1D><BeginX>${x1}</BeginX><BeginY>${y1}</BeginY><EndX>${x2}</EndX><EndY>${y2}</EndY></XForm1D><Line><LineWeight>0.015</LineWeight><LineColor>#1F4E79</LineColor><EndArrow>4</EndArrow><EndArrowSize>2</EndArrowSize></Line><Fill><FillPattern>0</FillPattern></Fill><Geom IX="0"><NoFill>1</NoFill><MoveTo IX="1"><X>${x1<x2?0:w}</X><Y>${y1<y2?0:h}</Y></MoveTo><LineTo IX="2"><X>${x1<x2?w:0}</X><Y>${y1<y2?h:0}</Y></LineTo></Geom></Shape>`;
  }
  function downloadVsdx(){
    const xml = buildVdx(); if (!xml) return;
    const blob = new Blob([xml], { type:'application/vnd.visio' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.title || 'process-map').replace(/[^\w-]+/g,'_') + '.vdx';
    a.click();
  }

  // ---------- Excel template download ----------
  function downloadTemplate(){
    if (!window.XLSX){ alert('Excel library not loaded.'); return; }
    const wb = XLSX.utils.book_new();
    const steps = [
      ['Step ID','Previous Step','Step Name','Step Type','Department','Owner','Decision Question','Yes Next','No Next','SLA (Days)','Week','Document','Status Color','Notes'],
      [1,'START','Approved Annual Plan','Start','Sales','CEO','','','',2,'Week 1','','Blue',''],
      [2,1,'New Hospital Lead','Process','Sales','Sales Manager','','','',3,'Week 1','','Blue',''],
      [3,2,'Site Visit','Process','Sales','Sales Manager','','','',4,'Week 1','Checklist','Blue',''],
      [4,3,'Hospital Accepts Proposal?','Decision','Sales','Sales Manager','Accepted?',5,20,3,'Week 1','Proposal','Yellow',''],
      [5,4,'Draft Contract','Process','Contracts','Contract Admin','','','',3,'Week 2','Draft Contract','Orange',''],
      [6,5,'Contract Approved?','Decision','Finance','Finance Manager','Approved?',7,5,7,'Week 3','','Yellow',''],
      [7,6,'Create Location','Process','Finance','Finance','','','',1,'Week 4','ERP','Green',''],
      [8,7,'Order Equipment','Process','Procurement','Procurement','','','','','Week 5','Purchase Order','Blue',''],
      [9,8,'Laboratory Ready','End','Project','PM','','','','','Week 6','','Green',''],
      [20,4,'Location Rejected','End','Sales','Sales Manager','','','','','Week 1','','Red','']
    ];
    const depts = [
      ['Department','Color','Order'],
      ['Sales','#B6CDEA',1],
      ['Contracts','#B9D5A7',2],
      ['Finance','#E7E6E6',3],
      ['Procurement','#F6CB92',4],
      ['Project','#EBCA84',5]
    ];
    const timeline = [
      ['Week','Start X Position'],
      ['Week 1',0],['Week 2',1],['Week 3',2],['Week 4',3],['Week 5',4],['Week 6',5],['Week 7',6]
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(steps), 'ProcessSteps');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(depts), 'Departments');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(timeline), 'Timeline');
    XLSX.writeFile(wb, 'process-map-template.xlsx');
  }

  // ---------- Excel upload ----------
  async function handleExcel(file, token){
    if (!window.XLSX){ alert('Excel library not loaded.'); return; }
    try {
      const buffer = await file.arrayBuffer();
      if (token !== lastExcelUploadToken) return;
      const wb = XLSX.read(buffer, { type:'array', cellDates:true });
      const ok = loadFromWorkbook(wb);
      if (!ok){
        // Legacy fallback: read first sheet as TSV
        const first = wb.Sheets[wb.SheetNames[0]];
        const tsv = XLSX.utils.sheet_to_csv(first, { FS:'\t' });
        document.getElementById('pmData').value = tsv;
        if (!parseLegacyText(tsv)){
          alert('No recognizable data. Expected sheets: ProcessSteps, Departments, Timeline (or a Seq/Activity/Role/Approver/SLA table).');
          return;
        }
      }
      // Reset drag positions on fresh import to reflow, but keep positions for existing IDs
      // (per spec: update existing nodes by Step ID)
      const currentIds = new Set(state.steps.map(s=>s.id));
      Object.keys(state.positions).forEach(k => { if (!currentIds.has(+k)) delete state.positions[k]; });
      render();
    } catch (err){
      console.error(err);
      alert('Failed to read Excel: ' + (err && err.message ? err.message : err));
    }
  }

  function generate(){
    // Prefer state.steps if loaded from Excel; otherwise parse textarea
    const ta = document.getElementById('pmData');
    if (!state.steps.length || (ta && ta.value.trim() && ta.dataset.dirty === '1')){
      parseLegacyText(ta.value);
      ta.dataset.dirty = '';
    }
    if (!state.steps.length){ alert('No data to render.'); return; }
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
      // inject template + reset zoom buttons next to VDX button
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
      e.target.value = '';
      if (f) handleExcel(f, token);
    });
    const ta = document.getElementById('pmData');
    ta?.addEventListener('input', () => { ta.dataset.dirty = '1'; });

    const tab = document.querySelector('.tab[data-tab="processMap"]');
    if (tab){
      tab.addEventListener('click', () => {
        const svg = document.getElementById('pmMap');
        if (svg && !svg.innerHTML.trim()) generate();
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
