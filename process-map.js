document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generateBtn');
    const dataInput = document.getElementById('dataInput');
    const excelUpload = document.getElementById('excelUpload');
    
    let processData = [];
    let nodes = {};
    let swimlanes = [];

    // --- EVENT LISTENERS ---
    generateBtn.addEventListener('click', () => {
        updateHeaders();
        parsePastedData(dataInput.value);
        renderMap();
    });

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

    function updateHeaders() {
        document.getElementById('displayTitle').innerText = `Process Map of: ${document.getElementById('processTitle').value}`;
        document.getElementById('displayMeta').innerText = `Process no. ${document.getElementById('processNo').value} Version no. ${document.getElementById('processVersion').value}`;
    }

    // --- DATA PARSING ---
    function processExcelData(json) {
        processData = json.map(row => ({
            id: row['Step ID'] || '',
            lane: row['Lane'] || 'General',
            type: (row['Type'] || 'Activity').toLowerCase(),
            name: row['Step Name'] || '',
            next: row['Next Step'] || '',
            yes: row['Decision Yes'] || '',
            no: row['Decision No'] || '',
            owner: row['Owner'] || ''
        })).filter(row => row.id !== '');
    }

    function parsePastedData(text) {
        if (!text.trim()) return;
        const rows = text.trim().split('\n');
        const headers = rows[0].split('\t').map(h => h.trim().toLowerCase());
        
        processData = rows.slice(1).map(rowStr => {
            const cols = rowStr.split('\t');
            let obj = {};
            // Assuming order from screenshot if headers don't match exactly
            obj.id = cols[0] || '';
            obj.lane = cols[1] || 'General';
            obj.type = (cols[2] || 'Activity').toLowerCase();
            obj.name = cols[3] || '';
            obj.next = cols[4] || '';
            obj.yes = cols[5] || '';
            obj.no = cols[6] || '';
            obj.owner = cols[8] || '';
            return obj;
        }).filter(row => row.id !== '');
    }

    // --- RENDERING ---
    function renderMap() {
        const swimlanesLayer = document.getElementById('swimlanes-layer');
        const nodesLayer = document.getElementById('nodes-layer');
        const connectionsLayer = document.getElementById('connections-layer');
        
        swimlanesLayer.innerHTML = '';
        nodesLayer.innerHTML = '';
        connectionsLayer.innerHTML = `
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#1a365d" />
                </marker>
            </defs>
        `;

        if (processData.length === 0) return;

        // Extract Swimlanes
        swimlanes = [...new Set(processData.map(d => d.lane))];
        const laneColors = ['#f0f4f8', '#f8d7da', '#d4edda', '#fff3cd', '#e2e3e5'];

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

        // Calculate layout
        calculatePositions();

        // Draw Nodes
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
        const laneHeight = 200;
        const startYOffset = 60;
        const xSpacing = 250;
        const startX = 80;

        let levelMap = {};
        
        // Simple BFS to assign X levels based on sequence
        let queue = processData.filter(d => d.type === 'start');
        if (queue.length === 0) queue = [processData[0]]; // fallback
        
        let visited = new Set();
        queue.forEach(q => { levelMap[q.id] = 0; visited.add(q.id); });

        while (queue.length > 0) {
            let curr = queue.shift();
            let currLevel = levelMap[curr.id];
            
            let targets = [curr.next, curr.yes, curr.no].filter(t => t);
            targets.forEach(tId => {
                const targetNode = processData.find(d => d.id === tId);
                if (targetNode && !visited.has(tId)) {
                    levelMap[tId] = currLevel + 1;
                    visited.add(tId);
                    queue.push(targetNode);
                }
            });
        }

        // Handle disconnected nodes
        processData.forEach(d => {
            if (levelMap[d.id] === undefined) levelMap[d.id] = 0;
        });

        // Calculate physical X and Y
        processData.forEach(d => {
            const laneIndex = swimlanes.indexOf(d.lane);
            d.x = startX + (levelMap[d.id] * xSpacing);
            d.y = (laneIndex * laneHeight) + startYOffset;
            
            // Stagger Y if multiple nodes occupy same X/Lane combo (basic collision avoidance)
            const peers = processData.filter(p => p.id !== d.id && p.lane === d.lane && levelMap[p.id] === levelMap[d.id]);
            if (peers.length > 0) {
                // simple offset
                 d.y += (peers.indexOf(d) * 80);
            }
        });
    }

    // --- DRAWING LINES ---
    function drawConnections() {
        const svg = document.getElementById('connections-layer');
        // keep defs
        const defs = svg.querySelector('defs');
        svg.innerHTML = '';
        svg.appendChild(defs);

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

        // Start from right edge of source
        const startX = (sRect.right - containerRect.left);
        const startY = (sRect.top + sRect.height / 2 - containerRect.top);

        // End at left edge of target
        const endX = (tRect.left - containerRect.left) - 5; // -5 to account for arrow marker
        const endY = (tRect.top + tRect.height / 2 - containerRect.top);

        // Calculate Orthogonal Path
        const midX = startX + (endX - startX) / 2;
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        // M start, L midX startY, L midX endY, L end
        const d = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
        
        path.setAttribute('d', d);
        path.setAttribute('class', className);
        svg.appendChild(path);
    }

    // --- DRAG AND DROP ---
    function makeDraggable(element, id) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        element.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = element.offsetLeft;
            initialTop = element.offsetTop;
            element.style.zIndex = 10;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            
            element.style.left = `${initialLeft + dx}px`;
            element.style.top = `${initialTop + dy}px`;
            
            // Redraw lines efficiently on move
            drawConnections();
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                element.style.zIndex = '';
                // Optional: Snap to grid could go here
            }
        });
    }
});