document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generateBtn');
    const dataInput = document.getElementById('dataInput');
    const excelUpload = document.getElementById('excelUpload');
    
    let processData = [];
    let nodes = {};
    let swimlanes = [];

    // --- EVENT TRIGGERS ---
    if (generateBtn) {
        generateBtn.addEventListener('click', () => {
            updateHeaders();
            parsePastedData(dataInput.value);
            renderMap();
        });
    }

    if (excelUpload) {
        excelUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                const data = evt.target.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const firstSheet = workbook.SheetNames[0];
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
                processExcelData(json);
                updateHeaders();
                renderMap();
            };
            reader.readAsBinaryString(file);
        });
    }

    function updateHeaders() {
        const titleEl = document.getElementById('displayTitle');
        const metaEl = document.getElementById('displayMeta');
        const titleVal = document.getElementById('processTitle')?.value || '';
        const noVal = document.getElementById('processNo')?.value || '';
        const verVal = document.getElementById('processVersion')?.value || '';

        if (titleEl) titleEl.innerText = `Process Map of: ${titleVal}`;
        if (metaEl) metaEl.innerText = `Process no. ${noVal} Version no. ${verVal}`;
    }

    // --- DATA PARSING STRATEGIES ---
    function processExcelData(json) {
        processData = json.map(row => ({
            id: String(row['Step ID'] || '').trim(),
            lane: String(row['Lane'] || 'General').trim(),
            type: String(row['Type'] || 'Activity').toLowerCase().trim(),
            name: String(row['Step Name'] || '').trim(),
            next: String(row['Next Step'] || '').trim(),
            yes: String(row['Decision Yes'] || '').trim(),
            no: String(row['Decision No'] || '').trim(),
            owner: String(row['Owner'] || '').trim()
        })).filter(row => row.id !== '');
    }

    function parsePastedData(text) {
        if (!text.trim()) return;
        const rows = text.trim().split('\n');
        
        processData = rows.slice(1).map(rowStr => {
            const cols = rowStr.split('\t');
            if (cols.length < 4) return null;
            return {
                id: String(cols[0] || '').trim(),
                lane: String(cols[1] || 'General').trim(),
                type: String(cols[2] || 'Activity').toLowerCase().trim(),
                name: String(cols[3] || '').trim(),
                next: String(cols[4] || '').trim(),
                yes: String(cols[5] || '').trim(),
                no: String(cols[6] || '').trim(),
                owner: String(cols[8] || '').trim()
            };
        }).filter(row => row && row.id !== '');
    }

    // --- ENGINE RENDERING ---
    function renderMap() {
        const swimlanesLayer = document.getElementById('swimlanes-layer');
        const nodesLayer = document.getElementById('nodes-layer');
        const connectionsLayer = document.getElementById('connections-layer');
        
        if (!swimlanesLayer || !nodesLayer || !connectionsLayer) return;

        swimlanesLayer.innerHTML = '';
        nodesLayer.innerHTML = '';
        connectionsLayer.innerHTML = `
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="8" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#4a5568" />
                </marker>
            </defs>
        `;

        if (processData.length === 0) return;

        // Unique Swimlanes Configuration
        swimlanes = [...new Set(processData.map(d => d.lane))];
        const laneColors = ['#f4f6f9', '#fbf2f2', '#f2fbf4', '#fffdf5', '#f7f7f8'];

        swimlanes.forEach((lane, index) => {
            const sl = document.createElement('div');
            sl.className = 'swimlane';
            sl.dataset.lane = lane;
            
            const header = document.createElement('div');
            header.className = 'swimlane-header';
            header.style.backgroundColor = laneColors[index % laneColors.length];
            header.innerText = lane;
            
            const content = document.createElement('div');
            content.className = 'swimlane-content';
            
            sl.appendChild(header);
            sl.appendChild(content);
            swimlanesLayer.appendChild(sl);
        });

        // Run Position Computations
        calculatePositions();

        // Render Physical Nodes
        nodes = {};
        processData.forEach(nodeData => {
            const el = document.createElement('div');
            el.className = `process-node node-${nodeData.type}`;
            el.id = `node-${nodeData.id}`;
            el.style.left = `${nodeData.x}px`;
            el.style.top = `${nodeData.y}px`;

            const content = document.createElement('div');
            content.className = 'node-content';
            content.innerHTML = `<div class="node-id">${nodeData.id}</div><div class="node-name">${nodeData.name}</div>`;
            
            el.appendChild(content);
            nodesLayer.appendChild(el);
            nodes[nodeData.id] = el;

            makeDraggable(el, nodeData.id);
        });

        drawConnections();
    }

    function calculatePositions() {
        const laneHeight = 220;
        const startYOffset = 65;
        const xSpacing = 240;
        const startX = 90;

        let levelMap = {};
        let queue = processData.filter(d => d.type === 'start');
        if (queue.length === 0) queue = [processData[0]]; 
        
        let visited = new Set();
        queue.forEach(q => { levelMap[q.id] = 0; visited.add(q.id); });

        while (queue.length > 0) {
            let curr = queue.shift();
            let currLevel = levelMap[curr.id];
            
            let targets = [curr.next, curr.yes, curr.no].filter(t => t);
            targets.forEach(tId => {
                if (!visited.has(tId)) {
                    levelMap[tId] = currLevel + 1;
                    visited.add(tId);
                    const nextNode = processData.find(d => d.id === tId);
                    if (nextNode) queue.push(nextNode);
                }
            });
        }

        processData.forEach(d => {
            if (levelMap[d.id] === undefined) levelMap[d.id] = 0;
            const laneIndex = swimlanes.indexOf(d.lane);
            
            d.x = startX + (levelMap[d.id] * xSpacing);
            d.y = (laneIndex * laneHeight) + startYOffset;
            
            // Layout collision adjustments
            const conflicts = processData.filter(p => p.id !== d.id && p.lane === d.lane && levelMap[p.id] === levelMap[d.id]);
            if (conflicts.length > 0) {
                d.y += (conflicts.indexOf(d) * 75);
            }
        });
    }

    // --- ORTHOGONAL CONNECTION PIPELINE ---
    function drawConnections() {
        const svg = document.getElementById('connections-layer');
        if (!svg) return;
        const defs = svg.querySelector('defs');
        svg.innerHTML = '';
        if (defs) svg.appendChild(defs);

        processData.forEach(source => {
            if (source.next) drawLine(source.id, source.next, 'connector', svg);
            if (source.yes) drawLine(source.id, source.yes, 'connector connector-yes', svg);
            if (source.no) drawLine(source.id, source.no, 'connector connector-no', svg);
        });
    }

    function drawLine(sourceId, targetId, className, svg) {
        const sourceEl = nodes[sourceId];
        const targetEl = nodes[targetId];
        if (!sourceEl || !targetEl) return;

        const sRect = sourceEl.getBoundingClientRect();
        const tRect = targetEl.getBoundingClientRect();
        const containerRect = svg.getBoundingClientRect();

        const startX = (sRect.right - containerRect.left);
        const startY = (sRect.top + sRect.height / 2 - containerRect.top);
        const endX = (tRect.left - containerRect.left) - 6; 
        const endY = (tRect.top + tRect.height / 2 - containerRect.top);

        // Compute 90-degree turning paths
        const midX = startX + (endX - startX) / 2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
        
        path.setAttribute('d', d);
        path.setAttribute('class', className);
        svg.appendChild(path);
    }

    // --- INTERACTIVE DRAG HOOKS ---
    function makeDraggable(element, id) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        element.addEventListener('mousedown', (e) => {
            // Prevent interference from text selection inside nodes
            if(e.target.closest('.node-content')) isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = element.offsetLeft;
            initialTop = element.offsetTop;
            element.style.zIndex = 100;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            
            element.style.left = `${initialLeft + dx}px`;
            element.style.top = `${initialTop + dy}px`;
            
            drawConnections();
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                element.style.zIndex = '';
            }
        });
    }
});
