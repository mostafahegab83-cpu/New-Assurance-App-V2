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

  let lastExcelUploadToken = 0;

  function isHeaderRow(r){
    const joined = r.join(' ').toLowerCase();
    return /seq|activity|role|approver|sla|responsible/.test(joined) && !/\d/.test(String(r[0]||''));
  }
  function parseText(text){
    const lines = text.trim().split(/\r?\n/).filter(l=>l.trim());
    if (!lines.length) return [];
    const sep = lines[0].includes('\t') ? '\t' : (lines[0].includes(',') ? ',' : /\s{2,}/);
    const rows = lines.map(l => (typeof sep==='string' ? l.split(sep) : l.split(sep)).map(c=>c.trim()));
    if (rows.length && isHeaderRow(rows[0])) rows.shift();
    return rowsToData(rows);
  }
  function parseSeq(v){
    if (v==null) return 0;
    const m = String(v).match(/\d+/);
    return m ? parseInt(m[0],10) : 0;
  }
  function rowsToData(rows){
    return rows.map((r,i) => ({
      seq: parseSeq(r[0]) || (i+1),
      activity: r[1]||'',
      role: r[2]||'Unassigned',
      approver: r[3]||'',
      sla: r[4]||''
    })).filter(d=>d.activity).sort((a,b)=>a.seq-b.seq);
  }

  function rowsToTsv(rows){
    const cleaned = rows.filter(r => r[0]!=='' && r[1]);
    return cleaned.map(r => [r[0], r[1], r[2]||'', r[3]||'', r[4]||''].join('\t')).join('\n');
  }

  function findActivityStart(rows){
    for (let i=0; i<rows.length; i++){
      const c0 = String(rows[i][0]||'');
      if (/\d/.test(c0) && (rows[i][1]||'').toString().trim()) return i;
    }
    return -1;
  }

  function validActivityRows(rows, start){
    if (start < 0) return [];
    return rows.slice(start).filter(r => (r[0]!==''||r[1]) && r[1]);
  }

  function pickProcessSheet(wb){
    const activeTab = wb.Workbook && wb.Workbook.WBView && wb.Workbook.WBView[0]
      ? wb.Workbook.WBView[0].activeTab
      : null;
    const sheetNames = wb.SheetNames || [];
    const candidates = sheetNames.map((name, index) => {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:false });
      const start = findActivityStart(rows);
      const dataRows = validActivityRows(rows, start);
      return { name, index, rows, start, dataRows, count: dataRows.length };
    }).filter(c => c.count > 0);

    if (!candidates.length) return null;

    const activeCandidate = Number.isInteger(activeTab)
      ? candidates.find(c => c.index === activeTab)
      : null;
    if (activeCandidate) return activeCandidate;

    return candidates.sort((a,b) => b.count - a.count || a.index - b.index)[0];
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

  // ============ VISIO 2003 XML (.vdx) EXPORT ============
  // Produces a single self-contained VDX (Visio 2003 XML) file that Visio
  // Professional / Visio for the Web open natively. Simpler and far more
  // tolerant than raw .vsdx (OOXML) which requires masters, windows.xml,
  // thumbnail parts, etc.
  function buildVdx(){
    const data = parseText(document.getElementById('pmData').value);
    if (!data.length){ alert('Generate a process map first.'); return null; }
    const title = document.getElementById('pmTitle').value || 'Process Map';

    // Lanes (unique roles preserving order)
    const lanes = [];
    data.forEach(d => { if (!lanes.includes(d.role)) lanes.push(d.role); });
    const LANE_COLORS = ['#B6CDEA','#E9B4CD','#B9D5A7','#C6BADF','#F6CB92','#A9D3CB','#EBCA84','#BFBFBF'];

    // Visio units = inches. A3 landscape.
    const pageW = 23.4, pageH = 16.5;
    const laneHeaderW = 1.4;
    const boxW = 1.9, boxH = 0.8;
    const gapX = 0.5, laneH = 1.4;
    const topY = pageH - 0.7;

    const laneRects = lanes.map((role, i) => {
      const yTop = topY - i * laneH;
      const yBot = yTop - laneH;
      return { role, yTop, yBot, cy: (yTop+yBot)/2, color: LANE_COLORS[i % LANE_COLORS.length] };
    });

    const positions = data.map((d, idx) => {
      const laneIdx = lanes.indexOf(d.role);
      const x = laneHeaderW + 0.4 + idx * (boxW + gapX) + boxW/2;
      return { x, y: laneRects[laneIdx].cy, d };
    });

    let id = 1;
    let shapes = '';

    // Lane background bands + lane header rectangles
    laneRects.forEach(lr => {
      shapes += vdxRect(id++, (laneHeaderW + pageW)/2, lr.cy, pageW - laneHeaderW, laneH, '#FFFFFF', '#1F4E79', '', false);
      shapes += vdxRect(id++, laneHeaderW/2, lr.cy, laneHeaderW, laneH, lr.color, '#1F4E79', lr.role, true);
    });

    // Start ellipse
    const first = positions[0];
    const startX = first.x - boxW/2 - gapX - 0.7;
    shapes += vdxEllipse(id++, startX, first.y, 1.4, 0.55, 'Process Start');

    // Activity boxes
    positions.forEach(p => {
      const label = `${p.d.seq}. ${p.d.activity}\nApprover: ${p.d.approver||'—'}\nSLA: ${p.d.sla||'—'} day(s)`;
      shapes += vdxRect(id++, p.x, p.y, boxW, boxH, '#DEEAF6', '#1F4E79', label, false);
    });

    // End ellipse
    const last = positions[positions.length-1];
    const endX = last.x + boxW/2 + gapX + 0.7;
    shapes += vdxEllipse(id++, endX, last.y, 1.4, 0.55, 'Process End');

    // Connectors (1D shapes with Begin/End)
    shapes += vdxLine(id++, startX + 0.7, first.y, first.x - boxW/2, first.y);
    for (let i=0; i<positions.length-1; i++){
      const a = positions[i], b = positions[i+1];
      shapes += vdxLine(id++, a.x + boxW/2, a.y, b.x - boxW/2, b.y);
    }
    shapes += vdxLine(id++, last.x + boxW/2, last.y, endX - 0.7, last.y);

    return `<?xml version="1.0" encoding="utf-8" ?>
<VisioDocument xmlns="http://schemas.microsoft.com/visio/2003/core" start="190" metric="0" DocLangID="1033" key="{5CA35A15-1234-4B7F-9B0E-000000000001}" buildnum="6360" version="11.0" xml:space="preserve">
<DocumentProperties>
<Title>${esc(title)}</Title>
<Creator>Process Assurance Tracker</Creator>
<Company>IDH</Company>
<TimeCreated>${new Date().toISOString()}</TimeCreated>
<TimeSaved>${new Date().toISOString()}</TimeSaved>
</DocumentProperties>
<DocumentSettings TopPage="0" DefaultTextStyle="3" DefaultLineStyle="3" DefaultFillStyle="3" DefaultGuideStyle="4">
<GlueSettings>9</GlueSettings>
<SnapSettings>65847</SnapSettings>
<SnapExtensions>34</SnapExtensions>
<DynamicGridEnabled>1</DynamicGridEnabled>
<ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes>
<ProtectMasters>0</ProtectMasters><ProtectBkgnds>0</ProtectBkgnds>
</DocumentSettings>
<Colors>
<ColorEntry IX="0" RGB="#000000"/><ColorEntry IX="1" RGB="#FFFFFF"/>
<ColorEntry IX="2" RGB="#FF0000"/><ColorEntry IX="3" RGB="#00FF00"/>
<ColorEntry IX="4" RGB="#0000FF"/><ColorEntry IX="5" RGB="#FFFF00"/>
<ColorEntry IX="6" RGB="#FF00FF"/><ColorEntry IX="7" RGB="#00FFFF"/>
</Colors>
<FaceNames>
<FaceName ID="1" Name="Arial" UnicodeRanges="31367 -2147483648 8 0" CharSets="1073742335 -65536" Panos="2 11 6 4 2 2 2 2 2 4" Flags="325"/>
<FaceName ID="2" Name="Calibri" UnicodeRanges="-536870145 1073741843 41 0" CharSets="1073742335 -65536" Panos="2 15 5 2 2 2 4 3 2 4" Flags="325"/>
</FaceNames>
<StyleSheets>
<StyleSheet ID="0" NameU="No Style" Name="No Style"/>
<StyleSheet ID="1" NameU="Text Only" Name="Text Only" LineStyle="0" FillStyle="0" TextStyle="0"/>
<StyleSheet ID="2" NameU="None" Name="None" LineStyle="0" FillStyle="0" TextStyle="0"/>
<StyleSheet ID="3" NameU="Normal" Name="Normal" LineStyle="0" FillStyle="0" TextStyle="0">
<Char IX="0"><Font>2</Font><Color>0</Color><Size>0.1666666666666667</Size></Char>
</StyleSheet>
<StyleSheet ID="4" NameU="Guide" Name="Guide" LineStyle="0" FillStyle="0" TextStyle="0"/>
</StyleSheets>
<Pages>
<Page ID="0" NameU="Page-1" Name="Page-1" ViewScale="-1" ViewCenterX="${pageW/2}" ViewCenterY="${pageH/2}">
<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">
<PageProps><PageWidth>${pageW}</PageWidth><PageHeight>${pageH}</PageHeight><ShdwOffsetX>0.125</ShdwOffsetX><ShdwOffsetY>-0.125</ShdwOffsetY><PageScale>1</PageScale><DrawingScale>1</DrawingScale><DrawingSizeType>3</DrawingSizeType><DrawingScaleType>0</DrawingScaleType><InhibitSnap>0</InhibitSnap><UIVisibility>0</UIVisibility><ShdwType>0</ShdwType><ShdwObliqueAngle>0</ShdwObliqueAngle><ShdwScaleFactor>1</ShdwScaleFactor></PageProps>
<PrintProps><PageLeftMargin>0.25</PageLeftMargin><PageRightMargin>0.25</PageRightMargin><PageTopMargin>0.25</PageTopMargin><PageBottomMargin>0.25</PageBottomMargin><ScaleX>1</ScaleX><ScaleY>1</ScaleY><PagesX>1</PagesX><PagesY>1</PagesY><CenterX>0</CenterX><CenterY>0</CenterY><PrintGrid>0</PrintGrid><PrintPageOrientation>2</PrintPageOrientation><PaperKind>8</PaperKind><PaperSource>7</PaperSource></PrintProps>
</PageSheet>
<Shapes>${shapes}</Shapes>
</Page>
</Pages>
</VisioDocument>`;
  }

  function vdxRect(id, cx, cy, w, h, fill, line, text, bold){
    return `<Shape ID="${id}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3">
<XForm><PinX>${cx}</PinX><PinY>${cy}</PinY><Width>${w}</Width><Height>${h}</Height><LocPinX F="Width*0.5">${w/2}</LocPinX><LocPinY F="Height*0.5">${h/2}</LocPinY><Angle>0</Angle><FlipX>0</FlipX><FlipY>0</FlipY><ResizeMode>0</ResizeMode></XForm>
<Line><LineWeight>0.01</LineWeight><LineColor>${line}</LineColor><LinePattern>1</LinePattern><Rounding>0.05</Rounding></Line>
<Fill><FillForegnd>${fill}</FillForegnd><FillBkgnd>#FFFFFF</FillBkgnd><FillPattern>1</FillPattern><ShdwForegnd>#000000</ShdwForegnd><ShdwPattern>0</ShdwPattern></Fill>
<TextBlock><LeftMargin>0.05</LeftMargin><RightMargin>0.05</RightMargin><TopMargin>0.05</TopMargin><BottomMargin>0.05</BottomMargin><VerticalAlign>1</VerticalAlign></TextBlock>
<Char IX="0"><Font>2</Font><Color>#000000</Color><Style>${bold?1:0}</Style><Size>${bold?0.14:0.10}</Size></Char>
<Para IX="0"><HorzAlign>1</HorzAlign></Para>
<Geom IX="0"><NoFill>0</NoFill><NoLine>0</NoLine><NoShow>0</NoShow><NoSnap>0</NoSnap>
<MoveTo IX="1"><X>0</X><Y>0</Y></MoveTo>
<LineTo IX="2"><X F="Width">${w}</X><Y>0</Y></LineTo>
<LineTo IX="3"><X F="Width">${w}</X><Y F="Height">${h}</Y></LineTo>
<LineTo IX="4"><X>0</X><Y F="Height">${h}</Y></LineTo>
<LineTo IX="5"><X>0</X><Y>0</Y></LineTo>
</Geom>
<Text>${esc(text)}</Text>
</Shape>`;
  }

  function vdxEllipse(id, cx, cy, w, h, text){
    return `<Shape ID="${id}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3">
<XForm><PinX>${cx}</PinX><PinY>${cy}</PinY><Width>${w}</Width><Height>${h}</Height><LocPinX F="Width*0.5">${w/2}</LocPinX><LocPinY F="Height*0.5">${h/2}</LocPinY><Angle>0</Angle></XForm>
<Line><LineWeight>0.02</LineWeight><LineColor>#1F4E79</LineColor><LinePattern>1</LinePattern></Line>
<Fill><FillForegnd>#FFFFFF</FillForegnd><FillPattern>1</FillPattern></Fill>
<TextBlock><VerticalAlign>1</VerticalAlign></TextBlock>
<Char IX="0"><Font>2</Font><Color>#000000</Color><Style>1</Style><Size>0.12</Size></Char>
<Para IX="0"><HorzAlign>1</HorzAlign></Para>
<Geom IX="0"><NoFill>0</NoFill><NoLine>0</NoLine><NoShow>0</NoShow><NoSnap>0</NoSnap>
<Ellipse IX="1"><X F="Width*0.5">${w/2}</X><Y F="Height*0.5">${h/2}</Y><A F="Width">${w}</A><B F="Height*0.5">${h/2}</B><C F="Width*0.5">${w/2}</C><D F="Height">${h}</D></Ellipse>
</Geom>
<Text>${esc(text)}</Text>
</Shape>`;
  }

  function vdxLine(id, x1, y1, x2, y2){
    const cx = (x1+x2)/2, cy = (y1+y2)/2;
    const w = Math.abs(x2-x1) || 0.001, h = Math.abs(y2-y1) || 0.001;
    return `<Shape ID="${id}" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3">
<XForm><PinX>${cx}</PinX><PinY>${cy}</PinY><Width>${w}</Width><Height>${h}</Height><LocPinX F="Width*0.5">${w/2}</LocPinX><LocPinY F="Height*0.5">${h/2}</LocPinY><Angle>0</Angle></XForm>
<XForm1D><BeginX>${x1}</BeginX><BeginY>${y1}</BeginY><EndX>${x2}</EndX><EndY>${y2}</EndY></XForm1D>
<Line><LineWeight>0.015</LineWeight><LineColor>#1F4E79</LineColor><LinePattern>1</LinePattern><EndArrow>4</EndArrow><EndArrowSize>2</EndArrowSize></Line>
<Fill><FillPattern>0</FillPattern></Fill>
<Geom IX="0"><NoFill>1</NoFill><NoLine>0</NoLine><NoShow>0</NoShow><NoSnap>0</NoSnap>
<MoveTo IX="1"><X>${x1<x2?0:w}</X><Y>${y1<y2?0:h}</Y></MoveTo>
<LineTo IX="2"><X>${x1<x2?w:0}</X><Y>${y1<y2?h:0}</Y></LineTo>
</Geom>
</Shape>`;
  }

  function downloadVsdx(){
    const xml = buildVdx();
    if (!xml) return;
    const blob = new Blob([xml], { type: 'application/vnd.visio' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (document.getElementById('pmTitle').value || 'process-map').replace(/[^\w-]+/g,'_') + '.vdx';
    a.click();
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

  async function handleExcel(file, token){
    if (!window.XLSX){ alert('Excel library not loaded.'); return; }
    try {
      const buffer = await file.arrayBuffer();
      if (token !== lastExcelUploadToken) return;
      const wb = XLSX.read(buffer, { type: 'array', cellDates:true });
      const picked = pickProcessSheet(wb);
      if (!picked) {
        alert('No activity table found in this Excel file. Please check the columns: Seq, Activity, Responsible Role, Approver, SLA.');
        return;
      }
      const tsv = rowsToTsv(picked.dataRows);
      document.getElementById('pmData').value = tsv;
      generate();
    } catch (err){
      console.error(err);
      alert('Failed to read Excel file: ' + (err && err.message ? err.message : err));
    }
  }

  function init(){
    const btnGen = document.getElementById('pmGenerate');
    if (!btnGen) return;
    btnGen.addEventListener('click', generate);
    document.getElementById('pmDownloadPdf').addEventListener('click', downloadPdf);
    document.getElementById('pmDownloadPng').addEventListener('click', downloadPng);
    document.getElementById('pmDownloadSvg').addEventListener('click', downloadSvg);
    const vsdxBtn = document.getElementById('pmDownloadVsdx');
    if (vsdxBtn) vsdxBtn.addEventListener('click', downloadVsdx);
    document.getElementById('pmExcelFile').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      const token = ++lastExcelUploadToken;
      e.target.value = '';
      if (f) handleExcel(f, token);
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
