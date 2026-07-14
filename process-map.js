/* Process Map Generator — swimlane SVG
   Columns: Step ID | Lane | Type | Step Name | Next Step | Decision Yes | Decision No | Documents | Owner
   Types: Start, End, Activity, Approval, Decision
*/
(function(){
  const LANE_COLORS = ['#B6CDEA','#E9B4CD','#B9D5A7','#C6BADF','#F6CB92','#A9D3CB','#EBCA84','#BFBFBF'];
  const FILL = {
    activity: '#DEEAF6',
    approval: '#F8CBAD',
    decision: '#FFE699',
    terminator: '#FFFFFF'
  };
  const STROKE = '#1f4e79';

  function esc(t){ return String(t==null?'':t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function wrap(text, max){
    const words = String(text||'').split(/\s+/); const lines=[]; let cur='';
    words.forEach(w=>{ if((cur+' '+w).trim().length>max){ if(cur) lines.push(cur); cur=w;} else cur=(cur+' '+w).trim();});
    if(cur) lines.push(cur); return lines;
  }
  function shapeType(t){
    const s=(t||'').toLowerCase();
    if (s.startsWith('start')) return 'start';
    if (s.startsWith('end')) return 'end';
    if (s.startsWith('deci')) return 'decision';
    if (s.startsWith('appr')) return 'approval';
    return 'activity';
  }

  // ---------- Parsing ----------
  function parseText(text){
    const lines = text.trim().split(/\r?\n/).filter(l=>l.trim());
    if (!lines.length) return [];
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const rows = lines.map(l => l.split(sep).map(c=>c.trim()));
    return rowsToData(rows);
  }
  function rowsToData(rows){
    if (rows.length && /step\s*id|^id$/i.test(String(rows[0][0]||''))) rows.shift();
    return rows.filter(r => r[0] && r[3]).map(r => ({
      id:     String(r[0]).trim(),
      lane:   (r[1]||'Unassigned').trim(),
      type:   (r[2]||'Activity').trim(),
      name:   (r[3]||'').trim(),
      next:   (r[4]||'').trim(),
      yes:    (r[5]||'').trim(),
      no:     (r[6]||'').trim(),
      docs:   (r[7]||'').trim(),
      owner:  (r[8]||'').trim()
    }));
  }

  // ---------- Layout ----------
  function layout(steps){
    const map = new Map(steps.map(s=>[s.id,s]));
    const edges = [];
    steps.forEach(s => {
      const t = shapeType(s.type);
      if (t === 'decision'){
        if (s.yes && map.has(s.yes)) edges.push({from:s.id, to:s.yes, label:'Yes'});
        if (s.no  && map.has(s.no))  edges.push({from:s.id, to:s.no,  label:'No'});
      } else if (s.next && map.has(s.next)){
        edges.push({from:s.id, to:s.next, label:''});
      }
    });

    // Longest-path column via DFS, ignoring back-edges.
    const depth = new Map();
    const onStack = new Set();
    const back = new Set();
    const adj = new Map();
    steps.forEach(s => adj.set(s.id, []));
    edges.forEach(e => adj.get(e.from).push(e));

    function dfs(id, d){
      const cur = depth.get(id);
      if (cur !== undefined && cur >= d) return;
      depth.set(id, d);
      onStack.add(id);
      (adj.get(id)||[]).forEach(e => {
        if (onStack.has(e.to)){ back.add(e.from+'->'+e.to); return; }
        dfs(e.to, d+1);
      });
      onStack.delete(id);
    }
    const start = steps.find(s=>shapeType(s.type)==='start') || steps[0];
    dfs(start.id, 0);
    // Any orphans → append at end
    let maxD = 0; depth.forEach(v => { if(v>maxD) maxD=v; });
    steps.forEach(s => { if (!depth.has(s.id)){ maxD++; dfs(s.id, maxD); }});

    // Lanes preserve first-appearance order
    const lanes = [];
    steps.forEach(s => { if (!lanes.includes(s.lane)) lanes.push(s.lane); });

    // Assign (col,lane) resolving collisions
    const used = new Set();
    const pos = new Map();
    const sorted = [...steps].sort((a,b)=>(depth.get(a.id)-depth.get(b.id)));
    sorted.forEach(s => {
      let c = depth.get(s.id)||0;
      const li = lanes.indexOf(s.lane);
      while (used.has(c+','+li)) c++;
      used.add(c+','+li);
      pos.set(s.id, { col:c, lane:li });
    });

    let maxCol = 0; pos.forEach(p => { if (p.col>maxCol) maxCol=p.col; });
    return { edges, back, lanes, pos, maxCol };
  }

  // ---------- Rendering ----------
  function generate(){
    const data = parseText(document.getElementById('pmData').value);
    const svg = document.getElementById('pmMap');
    if (!data.length){ svg.innerHTML=''; return; }

    const { edges, back, lanes, pos, maxCol } = layout(data);

    const laneHeaderW = 90;
    const boxW = 190, boxH = 74;
    const colW = boxW + 60;
    const laneH = 150;
    const headerH = 56, topPad = 20;
    const totalW = laneHeaderW + 40 + (maxCol+1) * colW + 60;
    const totalH = headerH + topPad + lanes.length * laneH + 60;

    svg.setAttribute('width', totalW);
    svg.setAttribute('height', totalH);
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg');

    const title = document.getElementById('pmTitle').value;
    const pno   = document.getElementById('pmNo').value;
    const ver   = document.getElementById('pmVer').value;

    let s = '';
    s += `<defs><marker id="pmArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${STROKE}"/></marker></defs>`;

    // Header
    s += `<rect x="0" y="0" width="${totalW}" height="${headerH}" fill="#fff" stroke="${STROKE}"/>`;
    s += `<rect x="0" y="0" width="60" height="${headerH}" fill="#fff" stroke="${STROKE}"/>`;
    s += `<text x="30" y="34" text-anchor="middle" font-size="12" font-weight="bold" fill="${STROKE}">IDH</text>`;
    s += `<text x="80" y="24" font-size="13" font-weight="bold">Process Map of: ${esc(title)}</text>`;
    s += `<text x="80" y="44" font-size="11">Process no. ${esc(pno)}   Version no. ${esc(ver)}</text>`;

    // Lanes
    lanes.forEach((role, i) => {
      const y = headerH + topPad + i*laneH;
      const color = LANE_COLORS[i % LANE_COLORS.length];
      s += `<rect x="0" y="${y}" width="${laneHeaderW}" height="${laneH}" fill="${color}" stroke="${STROKE}"/>`;
      s += `<rect x="${laneHeaderW}" y="${y}" width="${totalW - laneHeaderW}" height="${laneH}" fill="#fff" stroke="${STROKE}"/>`;
      const cx = laneHeaderW/2, cy = y + laneH/2;
      s += `<text x="${cx}" y="${cy}" font-size="12" font-weight="bold" text-anchor="middle" transform="rotate(-90 ${cx} ${cy})">${esc(role)}</text>`;
    });

    // Compute coordinates per step
    const coord = new Map();
    data.forEach(step => {
      const p = pos.get(step.id);
      const cx = laneHeaderW + 40 + p.col*colW + boxW/2;
      const cy = headerH + topPad + p.lane*laneH + laneH/2;
      coord.set(step.id, { cx, cy, step, shape: shapeType(step.type) });
    });

    // Draw edges first (under shapes)
    function anchor(c, side){
      const w = c.shape==='decision' ? 110 : (c.shape==='start'||c.shape==='end' ? 110 : boxW);
      const h = c.shape==='decision' ? 74  : (c.shape==='start'||c.shape==='end' ? 44  : boxH);
      if (side==='right')  return { x: c.cx + w/2, y: c.cy };
      if (side==='left')   return { x: c.cx - w/2, y: c.cy };
      if (side==='top')    return { x: c.cx, y: c.cy - h/2 };
      if (side==='bottom') return { x: c.cx, y: c.cy + h/2 };
    }

    edges.forEach(e => {
      const a = coord.get(e.from), b = coord.get(e.to);
      if (!a || !b) return;
      const isBack = back.has(e.from+'->'+e.to) || b.cx < a.cx;
      let pts, labelPos = null;

      if (isBack){
        // Route down and around
        const yBelow = Math.max(a.cy, b.cy) + 55;
        const p1 = anchor(a,'bottom');
        const p2 = anchor(b,'bottom');
        pts = `${p1.x},${p1.y} ${p1.x},${yBelow} ${p2.x},${yBelow} ${p2.x},${p2.y}`;
        labelPos = { x: (p1.x+p2.x)/2, y: yBelow - 4 };
      } else if (Math.abs(a.cy - b.cy) < 2){
        const p1 = anchor(a,'right'), p2 = anchor(b,'left');
        pts = `${p1.x},${p1.y} ${p2.x},${p2.y}`;
        labelPos = { x: (p1.x+p2.x)/2, y: p1.y - 6 };
      } else {
        // Elbow: right → midX → down/up → left
        const p1 = anchor(a,'right'), p2 = anchor(b,'left');
        const midX = (p1.x + p2.x)/2;
        pts = `${p1.x},${p1.y} ${midX},${p1.y} ${midX},${p2.y} ${p2.x},${p2.y}`;
        labelPos = { x: midX + 4, y: (p1.y+p2.y)/2 };
      }
      s += `<polyline points="${pts}" fill="none" stroke="${STROKE}" stroke-width="1.5" marker-end="url(#pmArr)"/>`;
      if (e.label && labelPos){
        s += `<rect x="${labelPos.x-14}" y="${labelPos.y-11}" width="28" height="14" fill="#fff" stroke="${STROKE}" stroke-width="0.5" rx="2"/>`;
        s += `<text x="${labelPos.x}" y="${labelPos.y}" text-anchor="middle" font-size="10" font-weight="bold" fill="${STROKE}">${esc(e.label)}</text>`;
      }
    });

    // Draw shapes
    coord.forEach(c => {
      const { cx, cy, step, shape } = c;
      if (shape==='start' || shape==='end'){
        s += `<ellipse cx="${cx}" cy="${cy}" rx="55" ry="22" fill="${FILL.terminator}" stroke="${STROKE}" stroke-width="2"/>`;
        s += `<text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="12" font-weight="bold" fill="${STROKE}">${esc(step.name)}</text>`;
      } else if (shape==='decision'){
        const w = 110, h = 74;
        s += `<polygon points="${cx},${cy-h/2} ${cx+w/2},${cy} ${cx},${cy+h/2} ${cx-w/2},${cy}" fill="${FILL.decision}" stroke="${STROKE}" stroke-width="1.5"/>`;
        const lines = wrap(step.name, 16).slice(0,3);
        const startY = cy - (lines.length-1)*5;
        lines.forEach((ln,i)=>{ s += `<text x="${cx}" y="${startY + i*11}" text-anchor="middle" font-size="9.5" font-weight="bold">${esc(ln)}</text>`; });
      } else {
        const fill = shape==='approval' ? FILL.approval : FILL.activity;
        const x = cx - boxW/2, y = cy - boxH/2;
        s += `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="10" ry="10" fill="${fill}" stroke="${STROKE}" stroke-width="1.5"/>`;
        s += `<text x="${cx}" y="${y+14}" text-anchor="middle" font-size="10" font-weight="bold" fill="#1f4e79">${esc(step.id)}${shape==='approval'?' • Approval':''}</text>`;
        const lines = wrap(step.name, 30).slice(0,3);
        lines.forEach((ln,i)=>{ s += `<text x="${cx}" y="${y+30+i*12}" text-anchor="middle" font-size="10.5">${esc(ln)}</text>`; });
        if (step.docs){
          s += `<text x="${cx}" y="${y+boxH-6}" text-anchor="middle" font-size="9" fill="#555">📄 ${esc(step.docs.slice(0,34))}</text>`;
        }
      }
    });

    svg.innerHTML = s;
  }

  // ---------- Export ----------
  function svgToPngDataUrl(scale){
    return new Promise((resolve, reject) => {
      const svg = document.getElementById('pmMap');
      const w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
      const xml = new XMLSerializer().serializeToString(svg);
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
    const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 24, headH = 30;
    const title = document.getElementById('pmTitle').value || 'Process Map';
    pdf.setFontSize(13); pdf.setTextColor(31,58,138);
    pdf.text('Process Map — ' + title, margin, margin + 4);
    pdf.setFontSize(9); pdf.setTextColor(107,114,128);
    pdf.text(new Date().toLocaleString(), pageW - margin, margin + 4, { align:'right' });
    const availW = pageW - margin*2;
    const availH = pageH - margin*2 - headH;
    const ratio = Math.min(availW/w, availH/h);
    const rW = w*ratio, rH = h*ratio;
    pdf.addImage(url, 'PNG', margin + (availW-rW)/2, margin + headH, rW, rH);
    pdf.save('process-map.pdf');
  }

  function handleExcel(file){
    if (!window.XLSX){ alert('Excel library not loaded.'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
        // Detect and skip header row
        let start = 0;
        if (rows.length && /step\s*id|^id$/i.test(String(rows[0][0]||''))) start = 1;
        const cleaned = rows.slice(start).filter(r => r[0] && r[3]);
        const tsv = cleaned.map(r => [0,1,2,3,4,5,6,7,8].map(i=>r[i]||'').join('\t')).join('\n');
        document.getElementById('pmData').value = tsv;
        generate();
      } catch (err){
        console.error(err);
        alert('Failed to read Excel file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function init(){
    const btnGen = document.getElementById('pmGenerate');
    if (!btnGen) return;
    btnGen.addEventListener('click', generate);
    document.getElementById('pmDownloadPdf').addEventListener('click', downloadPdf);
    document.getElementById('pmDownloadPng').addEventListener('click', downloadPng);
    document.getElementById('pmDownloadSvg').addEventListener('click', downloadSvg);
    document.getElementById('pmExcelFile').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) handleExcel(f);
      e.target.value = '';
    });
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
