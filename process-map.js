/* Process Map Generator — swimlane SVG from Seq/Activity/Role/Approver/SLA */
(function(){
  const LANE_HEADER_COLORS = ['#B6CDEA','#E9B4CD','#B9D5A7','#C6BADF','#F6CB92','#A9D3CB','#EBCA84','#BFBFBF'];

  function esc(t){ return String(t==null?'':t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function wrap(text, max){
    const words = String(text||'').split(/\s+/); const lines=[]; let cur='';
    words.forEach(w=>{ if ((cur+' '+w).trim().length>max){ if(cur) lines.push(cur); cur=w;} else cur=(cur+' '+w).trim();});
    if(cur) lines.push(cur); return lines;
  }
  function arrow(x1,y1,x2,y2){
    return `<line x1="${x1}" y1="${y1}" x2="${x2-2}" y2="${y2}" stroke="#1f4e79" stroke-width="1.5" marker-end="url(#pmArr)"/>`;
  }

  function parseText(text){
    const lines = text.trim().split(/\r?\n/).filter(l=>l.trim());
    if (!lines.length) return [];
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const rows = lines.map(l => l.split(sep).map(c=>c.trim()));
    if (rows.length && isNaN(parseInt(rows[0][0]))) rows.shift();
    return rowsToData(rows);
  }
  function rowsToData(rows){
    return rows.map(r => ({
      seq: parseInt(r[0])||0,
      activity: r[1]||'',
      role: r[2]||'Unassigned',
      approver: r[3]||'',
      sla: r[4]||''
    })).filter(d=>d.activity).sort((a,b)=>a.seq-b.seq);
  }

  function generate(){
    const data = parseText(document.getElementById('pmData').value);
    const svg = document.getElementById('pmMap');
    if (!data.length){ svg.innerHTML=''; return; }

    const lanes = [];
    data.forEach(d => { if (!lanes.includes(d.role)) lanes.push(d.role); });

    const laneHeaderW = 140;
    const boxW = 200, boxH = 78, gapX = 60, laneH = 130;
    const headerH = 60, topPad = 20;
    const totalW = laneHeaderW + 60 + data.length * (boxW + gapX) + 200;
    const totalH = headerH + topPad + lanes.length * laneH + 40;

    svg.setAttribute('width', totalW);
    svg.setAttribute('height', totalH);
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg');

    const title = document.getElementById('pmTitle').value;
    const pno = document.getElementById('pmNo').value;
    const ver = document.getElementById('pmVer').value;

    let s = '';
    s += `<defs><marker id="pmArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1f4e79"/></marker></defs>`;
    s += `<rect x="0" y="0" width="${totalW}" height="${headerH}" fill="#fff" stroke="#1f4e79"/>`;
    s += `<rect x="0" y="0" width="60" height="${headerH}" fill="#fff" stroke="#1f4e79"/>`;
    s += `<text x="30" y="35" text-anchor="middle" font-size="12" font-weight="bold" fill="#1f4e79">IDH</text>`;
    s += `<text x="80" y="25" font-size="13" font-weight="bold">Process Map of: ${esc(title)}</text>`;
    s += `<text x="80" y="45" font-size="11">Process no.  ${esc(pno)}    Version no. ${esc(ver)}</text>`;

    lanes.forEach((role, i) => {
      const y = headerH + topPad + i * laneH;
      const color = LANE_HEADER_COLORS[i % LANE_HEADER_COLORS.length];
      s += `<rect x="0" y="${y}" width="${laneHeaderW}" height="${laneH}" fill="${color}" stroke="#1f4e79"/>`;
      s += `<rect x="${laneHeaderW}" y="${y}" width="${totalW - laneHeaderW}" height="${laneH}" fill="#fff" stroke="#1f4e79"/>`;
      const cx = laneHeaderW/2, cy = y + laneH/2;
      s += `<text x="${cx}" y="${cy}" font-size="12" font-weight="bold" text-anchor="middle" transform="rotate(-90 ${cx} ${cy})">${esc(role)}</text>`;
    });

    const positions = data.map((d, idx) => {
      const laneIdx = lanes.indexOf(d.role);
      const x = laneHeaderW + 40 + idx * (boxW + gapX);
      const y = headerH + topPad + laneIdx * laneH + (laneH - boxH)/2;
      return { x, y, d };
    });

    const first = positions[0];
    const startX = first.x - gapX + 10, startY = first.y + boxH/2;
    s += `<ellipse cx="${startX}" cy="${startY - 30}" rx="55" ry="22" fill="#fff" stroke="#1f4e79" stroke-width="2"/>`;
    s += `<text x="${startX}" y="${startY - 25}" text-anchor="middle" font-size="12" font-weight="bold" fill="#1f4e79">Process Start</text>`;
    s += arrow(startX, startY - 8, first.x, first.y + boxH/2);

    positions.forEach((p, i) => {
      s += `<rect x="${p.x}" y="${p.y}" width="${boxW}" height="${boxH}" rx="10" ry="10" fill="#DEEAF6" stroke="#1f4e79" stroke-width="1.5"/>`;
      const lines = wrap(p.d.activity, 28).slice(0,2);
      s += `<text x="${p.x + boxW/2}" y="${p.y + 16}" text-anchor="middle" font-size="11" font-weight="bold">${p.d.seq}.</text>`;
      lines.forEach((ln, li) => {
        s += `<text x="${p.x + boxW/2}" y="${p.y + 32 + li*13}" text-anchor="middle" font-size="10.5">${esc(ln)}</text>`;
      });
      s += `<text x="${p.x + boxW/2}" y="${p.y + boxH - 16}" text-anchor="middle" font-size="9.5" fill="#555">Approver: ${esc(p.d.approver||'—')}</text>`;
      s += `<text x="${p.x + boxW/2}" y="${p.y + boxH - 4}" text-anchor="middle" font-size="9.5" fill="#555">SLA: ${esc(p.d.sla||'—')} day(s)</text>`;

      if (i < positions.length - 1) {
        const n = positions[i+1];
        const fromX = p.x + boxW, fromY = p.y + boxH/2;
        const toX = n.x, toY = n.y + boxH/2;
        if (fromY === toY) {
          s += arrow(fromX, fromY, toX, toY);
        } else {
          const midX = (fromX + toX)/2;
          s += `<polyline points="${fromX},${fromY} ${midX},${fromY} ${midX},${toY} ${toX},${toY}" fill="none" stroke="#1f4e79" stroke-width="1.5" marker-end="url(#pmArr)"/>`;
        }
      }
    });

    const last = positions[positions.length-1];
    const endX = last.x + boxW + gapX, endY = last.y + boxH/2;
    s += `<ellipse cx="${endX + 55}" cy="${endY}" rx="55" ry="22" fill="#fff" stroke="#1f4e79" stroke-width="2"/>`;
    s += `<text x="${endX + 55}" y="${endY + 5}" text-anchor="middle" font-size="12" font-weight="bold" fill="#1f4e79">Process End</text>`;
    s += arrow(last.x + boxW, endY, endX, endY);

    svg.innerHTML = s;
  }

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
    const margin = 24;
    const headerH = 30;
    const title = document.getElementById('pmTitle').value || 'Process Map';
    pdf.setFontSize(13); pdf.setTextColor(31,58,138);
    pdf.text('Process Map — ' + title, margin, margin + 4);
    pdf.setFontSize(9); pdf.setTextColor(107,114,128);
    pdf.text(new Date().toLocaleString(), pageW - margin, margin + 4, { align:'right' });
    const availW = pageW - margin*2;
    const availH = pageH - margin*2 - headerH;
    const ratio = Math.min(availW/w, availH/h);
    const renderW = w*ratio, renderH = h*ratio;
    pdf.addImage(url, 'PNG', margin + (availW-renderW)/2, margin + headerH, renderW, renderH);
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
        // Detect header row: find first row whose first cell is numeric
        let start = 0;
        for (let i=0; i<rows.length; i++){
          const c0 = rows[i][0];
          if (c0!=='' && !isNaN(parseInt(c0))){ start = i; break; }
        }
        const cleaned = rows.slice(start).filter(r => r[0]!=='' && r[1]);
        // put back into textarea as TSV so users can tweak
        const tsv = cleaned.map(r => [r[0], r[1], r[2]||'', r[3]||'', r[4]||''].join('\t')).join('\n');
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
    // Auto-generate initial map when tab first opened
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
