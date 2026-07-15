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

  // ============ VISIO (.vsdx) EXPORT ============
  // Builds a minimal Open Packaging Convention (.vsdx) file with a single page
  // containing rectangles for each activity (grouped visually into swimlanes
  // by role) plus start/end ellipses and connector lines. Opens in Visio 2013+
  // and Visio for the Web.
  function buildVsdx(){
    const data = parseText(document.getElementById('pmData').value);
    if (!data.length){ alert('Generate a process map first.'); return null; }
    const title = document.getElementById('pmTitle').value || 'Process Map';

    // Lanes (unique roles preserving order)
    const lanes = [];
    data.forEach(d => { if (!lanes.includes(d.role)) lanes.push(d.role); });
    const LANE_COLORS = ['B6CDEA','E9B4CD','B9D5A7','C6BADF','F6CB92','A9D3CB','EBCA84','BFBFBF'];

    // Visio uses inches; page 1 unit = 1 inch. Place shapes on an A3 landscape sheet.
    const pageW = 23.4, pageH = 16.5;      // inches
    const laneHeaderW = 1.2;               // inches
    const boxW = 1.8, boxH = 0.8;
    const gapX = 0.5;
    const laneH = 1.3;
    const topPad = pageH - 0.7;            // start Y (top). Visio Y origin = bottom-left.

    // Compute lane rectangles (background bands)
    const laneRects = lanes.map((role, i) => {
      const yTop = topPad - i * laneH;
      const yBot = yTop - laneH;
      return { role, yTop, yBot, color: LANE_COLORS[i % LANE_COLORS.length] };
    });

    // Compute activity box positions (Visio pin = center)
    const positions = data.map((d, idx) => {
      const laneIdx = lanes.indexOf(d.role);
      const x = laneHeaderW + 0.4 + idx * (boxW + gapX) + boxW/2;
      const y = laneRects[laneIdx].yTop - laneH/2;
      return { x, y, d };
    });

    let shapesXml = '';
    let shapeId = 1;
    const S = (extra) => shapeId++;

    // Lane header rects + labels
    laneRects.forEach(lr => {
      const cx = laneHeaderW/2;
      const cy = (lr.yTop + lr.yBot)/2;
      const id = S();
      shapesXml += rectShape(id, cx, cy, laneHeaderW, laneH, lr.color, lr.role, true);
      // Lane background band across
      const bgId = S();
      const bx = (laneHeaderW + pageW)/2;
      shapesXml += rectShape(bgId, bx, cy, pageW - laneHeaderW, laneH, 'FFFFFF', '', false, '1F4E79');
    });

    // Start ellipse
    const first = positions[0];
    const startX = first.x - boxW/2 - gapX;
    const startY = first.y + 0.5;
    shapesXml += ellipseShape(S(), startX, startY, 1.4, 0.5, 'Process Start');

    // Activity boxes
    positions.forEach(p => {
      const label = `${p.d.seq}. ${p.d.activity}\nApprover: ${p.d.approver||'—'}\nSLA: ${p.d.sla||'—'} day(s)`;
      shapesXml += rectShape(S(), p.x, p.y, boxW, boxH, 'DEEAF6', label, false, '1F4E79');
    });

    // End ellipse
    const last = positions[positions.length-1];
    const endX = last.x + boxW/2 + gapX + 0.7;
    const endY = last.y;
    shapesXml += ellipseShape(S(), endX, endY, 1.4, 0.5, 'Process End');

    // Connectors (start→first, between activities, last→end) as simple lines
    shapesXml += lineShape(S(), startX + 0.7, startY, positions[0].x - boxW/2, positions[0].y);
    for (let i=0; i<positions.length-1; i++){
      const a = positions[i], b = positions[i+1];
      shapesXml += lineShape(S(), a.x + boxW/2, a.y, b.x - boxW/2, b.y);
    }
    shapesXml += lineShape(S(), last.x + boxW/2, last.y, endX - 0.7, endY);

    const pageXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
<Shapes>${shapesXml}</Shapes>
</PageContents>`;

    const pagesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">
<Page ID="0" NameU="Page-1" Name="Page-1" ViewScale="-1" ViewCenterX="${pageW/2}" ViewCenterY="${pageH/2}">
<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">
<Cell N="PageWidth" V="${pageW}"/><Cell N="PageHeight" V="${pageH}"/>
<Cell N="ShdwOffsetX" V="0.125"/><Cell N="ShdwOffsetY" V="-0.125"/>
<Cell N="PageScale" V="1" U="IN_F"/><Cell N="DrawingScale" V="1" U="IN_F"/>
<Cell N="DrawingSizeType" V="3"/><Cell N="DrawingScaleType" V="0"/>
<Cell N="InhibitSnap" V="0"/><Cell N="PageLockReplace" V="0" U="BOOL"/>
<Cell N="PageLockDuplicate" V="0" U="BOOL"/><Cell N="UIVisibility" V="0"/>
<Cell N="ShdwType" V="0"/><Cell N="ShdwObliqueAngle" V="0"/><Cell N="ShdwScaleFactor" V="1"/>
<Cell N="DrawingResizeType" V="1"/>
</PageSheet>
<Rel r:id="rId1"/>
</Page>
</Pages>`;

    const pagesRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>
</Relationships>`;

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0">
<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings>
<SnapExtensions>34</SnapExtensions><SnapAngles/><DynamicGridEnabled>1</DynamicGridEnabled>
<ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes>
<ProtectMasters>0</ProtectMasters><ProtectBkgnds>0</ProtectBkgnds>
</DocumentSettings>
<Colors><ColorEntry IX="0" RGB="#000000"/></Colors>
<FaceNames><FaceName ID="1" Name="Calibri"/></FaceNames>
<StyleSheets>
<StyleSheet ID="0" NameU="No Style" Name="No Style"/>
</StyleSheets>
</VisioDocument>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
</Relationships>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

    const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title>
<dc:creator>Process Assurance Tracker</dc:creator>
<cp:lastModifiedBy>Process Assurance Tracker</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`;

    const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>Microsoft Visio</Application><AppVersion>15.0000</AppVersion>
</Properties>`;

    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypes);
    zip.folder('_rels').file('.rels', rootRels);
    zip.folder('docProps').file('core.xml', coreXml);
    zip.folder('docProps').file('app.xml', appXml);
    zip.folder('visio').file('document.xml', documentXml);
    zip.folder('visio/_rels').file('document.xml.rels', docRels);
    zip.folder('visio/pages').file('pages.xml', pagesXml);
    zip.folder('visio/pages').file('page1.xml', pageXml);
    zip.folder('visio/pages/_rels').file('pages.xml.rels', pagesRels);
    return zip;
  }

  function rectShape(id, cx, cy, w, h, fillHex, text, bold, lineHex){
    const line = lineHex || '1F4E79';
    return `<Shape ID="${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">
<Cell N="PinX" V="${cx}"/><Cell N="PinY" V="${cy}"/>
<Cell N="Width" V="${w}"/><Cell N="Height" V="${h}"/>
<Cell N="LocPinX" F="Width*0.5"/><Cell N="LocPinY" F="Height*0.5"/>
<Cell N="Angle" V="0"/><Cell N="FlipX" V="0"/><Cell N="FlipY" V="0"/>
<Cell N="ResizeMode" V="0"/>
<Cell N="LineColor" V="#${line}"/><Cell N="LineWeight" V="0.01"/>
<Cell N="FillForegnd" V="#${fillHex}"/>
<Cell N="Char.Size" V="${bold?0.14:0.1}"/><Cell N="Char.Style" V="${bold?1:0}"/>
<Cell N="Para.HorzAlign" V="1"/><Cell N="VerticalAlign" V="1"/>
<Section N="Geometry" IX="0">
<Cell N="NoFill" V="0"/><Cell N="NoLine" V="0"/><Cell N="NoShow" V="0"/><Cell N="NoSnap" V="0"/>
<Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
<Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row>
<Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row>
<Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row>
<Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
</Section>
<Text>${esc(text)}</Text>
</Shape>`;
  }

  function ellipseShape(id, cx, cy, w, h, text){
    return `<Shape ID="${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">
<Cell N="PinX" V="${cx}"/><Cell N="PinY" V="${cy}"/>
<Cell N="Width" V="${w}"/><Cell N="Height" V="${h}"/>
<Cell N="LocPinX" F="Width*0.5"/><Cell N="LocPinY" F="Height*0.5"/>
<Cell N="LineColor" V="#1F4E79"/><Cell N="LineWeight" V="0.02"/>
<Cell N="FillForegnd" V="#FFFFFF"/>
<Cell N="Char.Size" V="0.12"/><Cell N="Char.Style" V="1"/>
<Cell N="Para.HorzAlign" V="1"/><Cell N="VerticalAlign" V="1"/>
<Section N="Geometry" IX="0">
<Cell N="NoFill" V="0"/><Cell N="NoLine" V="0"/><Cell N="NoShow" V="0"/><Cell N="NoSnap" V="0"/>
<Row T="Ellipse" IX="1"><Cell N="X" F="Width*0.5"/><Cell N="Y" F="Height*0.5"/><Cell N="A" F="Width"/><Cell N="B" F="Height*0.5"/><Cell N="C" F="Width*0.5"/><Cell N="D" F="Height"/></Row>
</Section>
<Text>${esc(text)}</Text>
</Shape>`;
  }

  function lineShape(id, x1, y1, x2, y2){
    const cx = (x1+x2)/2, cy = (y1+y2)/2;
    const w = Math.abs(x2-x1) || 0.01, h = Math.abs(y2-y1) || 0.01;
    // Use begin/end trigger cells; Visio treats as 1D shape
    return `<Shape ID="${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">
<Cell N="PinX" V="${cx}"/><Cell N="PinY" V="${cy}"/>
<Cell N="Width" V="${w}"/><Cell N="Height" V="${h}"/>
<Cell N="LocPinX" F="Width*0.5"/><Cell N="LocPinY" F="Height*0.5"/>
<Cell N="BeginX" V="${x1}"/><Cell N="BeginY" V="${y1}"/>
<Cell N="EndX" V="${x2}"/><Cell N="EndY" V="${y2}"/>
<Cell N="LineColor" V="#1F4E79"/><Cell N="LineWeight" V="0.015"/>
<Cell N="EndArrow" V="4"/>
<Section N="Geometry" IX="0">
<Cell N="NoFill" V="1"/><Cell N="NoLine" V="0"/><Cell N="NoShow" V="0"/><Cell N="NoSnap" V="0"/>
<Row T="MoveTo" IX="1"><Cell N="X" V="${x1<x2?0:w}"/><Cell N="Y" V="${y1<y2?0:h}"/></Row>
<Row T="LineTo" IX="2"><Cell N="X" V="${x1<x2?w:0}"/><Cell N="Y" V="${y1<y2?h:0}"/></Row>
</Section>
</Shape>`;
  }

  async function downloadVsdx(){
    if (!window.JSZip){ alert('Visio export library not loaded.'); return; }
    const zip = buildVsdx();
    if (!zip) return;
    const blob = await zip.generateAsync({ type:'blob', mimeType:'application/vnd.ms-visio.drawing' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (document.getElementById('pmTitle').value || 'process-map').replace(/[^\w-]+/g,'_') + '.vsdx';
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
    const vsdxBtn = document.getElementById('pmDownloadVsdx');
    if (vsdxBtn) vsdxBtn.addEventListener('click', downloadVsdx);
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
