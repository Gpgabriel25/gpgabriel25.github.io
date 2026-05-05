(() => {
const canvas = document.getElementById('network-canvas');
const ctx = canvas.getContext('2d', { alpha: true });
let width, height, dpr;

const nodes = [];
const edges = [];
const NUM_NODES = 35;
const NODE_RADIUS = 6;
const MAX_PACKETS = 50;
const TWO_PI = Math.PI * 2;
const PACKET_SPEED = 0.004;

const packets = Array.from({ length: MAX_PACKETS }, () => ({
    active: false,
    edge: null,
    progress: 0,
    forward: true,
    target: null
}));
let activePacketCount = 0;

const EDGE_COLOR_CACHE = [];
const NODE_FILL_CACHE = [];

let mouseX = -9999, mouseY = -9999;
let hoverNode = null;
let lastWidth = 0;

function edgeColorFromGlow(glow) {
    if (document.documentElement.getAttribute('data-theme') === 'dark') {
        const b = 175 + ((glow * 55) | 0);
        return 'rgb(' + b + ',' + (170 + ((glow * 20) | 0)) + ',162)';
    }
    const r = 22 + ((glow * 80) | 0);
    let style = EDGE_COLOR_CACHE[r];
    if (!style) {
        style = 'rgb(' + r + ',22,22)';
        EDGE_COLOR_CACHE[r] = style;
    }
    return style;
}

function nodeFillStyle(rv) {
    if (document.documentElement.getAttribute('data-theme') === 'dark') {
        return 'rgb(' + (220 - (rv >> 2)) + ',215,208)';
    }
    let style = NODE_FILL_CACHE[rv];
    if (!style) {
        style = 'rgb(' + rv + ',28,28)';
        NODE_FILL_CACHE[rv] = style;
    }
    return style;
}

function acquirePacket(edge, forward, target) {
    if (activePacketCount >= MAX_PACKETS) return null;
    for (let i = 0; i < MAX_PACKETS; i++) {
        const packet = packets[i];
        if (!packet.active) {
            packet.active = true;
            packet.edge = edge;
            packet.progress = forward ? 0 : 1;
            packet.forward = forward;
            packet.target = target;
            activePacketCount++;
            return packet;
        }
    }
    return null;
}

function releasePacket(packet) {
    if (!packet.active) return;
    packet.active = false;
    packet.edge = null;
    packet.target = null;
    activePacketCount--;
}

function pickRandomBorderNode() {
    let picked = null;
    let seen = 0;
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.x < 120 || n.x > width - 120 || n.y < 120 || n.y > height - 120) {
            seen++;
            if (Math.random() * seen < 1) picked = n;
        }
    }
    return picked;
}

function resize() {
    const newW = window.innerWidth;
    if (lastWidth && Math.abs(newW - lastWidth) < 2) return; // skip Safari iOS URL bar
    lastWidth = newW;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = newW;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function init() {
    nodes.length = 0;
    edges.length = 0;
    activePacketCount = 0;
    for (let i = 0; i < MAX_PACKETS; i++) {
        const packet = packets[i];
        packet.active = false;
        packet.edge = null;
        packet.target = null;
        packet.progress = 0;
        packet.forward = true;
    }

    const cols = Math.ceil(Math.sqrt(NUM_NODES * (width / height)));
    const rows = Math.ceil(NUM_NODES / cols);
    const padX = 80, padY = 80;
    const cellW = (width - padX * 2) / Math.max(cols - 1, 1);
    const cellH = (height - padY * 2) / Math.max(rows - 1, 1);

    for (let i = 0; i < NUM_NODES; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        nodes.push({
            id: i,
            x: padX + col * cellW + (Math.random() - 0.5) * cellW * 0.5,
            y: padY + row * cellH + (Math.random() - 0.5) * cellH * 0.5,
            vx: (Math.random() - 0.5) * 0.06,
            vy: (Math.random() - 0.5) * 0.06,
            traffic: 0,
            pulsePhase: Math.random() * TWO_PI,
            // Precompute adjacency list indices
            adjEdges: []
        });
    }

    // Mesh: connect 3 nearest
    const edgeSet = new Set();
    const edgeKey = (a, b) => a < b ? a * NUM_NODES + b : b * NUM_NODES + a;
    for (let i = 0; i < NUM_NODES; i++) {
        const sorted = nodes.slice().sort((a, b) =>
            Math.hypot(a.x - nodes[i].x, a.y - nodes[i].y) -
            Math.hypot(b.x - nodes[i].x, b.y - nodes[i].y)
        );
        for (let j = 1; j <= 3; j++) {
            const neighbor = sorted[j];
            const key = edgeKey(nodes[i].id, neighbor.id);
            if (edgeSet.has(key)) continue;
            edgeSet.add(key);
            const idx = edges.length;
            edges.push({
                a: nodes[i], b: neighbor,
                weight: 1,
                broken: false,
                trafficGlow: 0,
                breakAnim: 0,
                idx: idx
            });
        }
    }
    // Build adjacency lists
    for (let i = 0; i < edges.length; i++) {
        edges[i].a.adjEdges.push(i);
        edges[i].b.adjEdges.push(i);
    }
}

// --- Interaction ---
function updatePointer(x, y) {
    mouseX = x; mouseY = y;
    hoverNode = null;
    let minD2 = Infinity;
    for (let i = 0; i < nodes.length; i++) {
        const dx = nodes[i].x - x, dy = nodes[i].y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) { minD2 = d2; hoverNode = nodes[i]; }
    }
}

document.addEventListener('mousemove', e => updatePointer(e.clientX, e.clientY));
document.addEventListener('touchmove', e => {
    if (e.touches.length > 0) updatePointer(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });
document.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; hoverNode = null; });
document.addEventListener('touchend', () => { mouseX = -9999; mouseY = -9999; hoverNode = null; }, { passive: true });

// Click/tap breaks closest edge
function breakEdge(x, y) {
    let minDist = 40, closest = null;
    for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (e.broken) continue;
        const ax = e.a.x, ay = e.a.y, bx = e.b.x, by = e.b.y;
        const L2 = (ax - bx) ** 2 + (ay - by) ** 2;
        if (L2 === 0) continue;
        let t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + t * (bx - ax), py = ay + t * (by - ay);
        const dist = Math.hypot(x - px, y - py);
        if (dist < minDist) { minDist = dist; closest = e; }
    }
    if (closest) { closest.broken = true; closest.breakAnim = 1.0; }
}

document.addEventListener('click', e => breakEdge(e.clientX, e.clientY));
document.addEventListener('touchstart', e => {
    if (e.touches.length > 0) breakEdge(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

// --- Pathfinding: find next edge toward target node (greedy) ---
function nextEdgeToward(currentNode, targetNode, prevEdge) {
    let bestEdge = null, bestDist2 = Infinity;
    const adj = currentNode.adjEdges;
    for (let i = 0; i < adj.length; i++) {
        const e = edges[adj[i]];
        if (e.broken || e.weight < 0.3) continue;
        if (prevEdge && e === prevEdge) continue;
        const other = e.a === currentNode ? e.b : e.a;
        const dx = other.x - targetNode.x, dy = other.y - targetNode.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist2) { bestDist2 = d2; bestEdge = e; }
    }
    return bestEdge;
}

// --- Spawn a packet at a random far-away node, aimed at hoverNode ---
function spawnPacketToward(target) {
    // Pick a random node (not the target itself)
    let origin = null;
    for (let attempts = 0; attempts < 10; attempts++) {
        const candidate = nodes[Math.floor(Math.random() * nodes.length)];
        if (candidate !== target) { origin = candidate; break; }
    }
    if (!origin) return;
    const firstEdge = nextEdgeToward(origin, target, null);
    if (!firstEdge) return;
    const forward = firstEdge.a === origin;
    if (acquirePacket(firstEdge, forward, target)) origin.traffic += 0.2;
}

// --- Animation ---
function animate() {
    if (document.documentElement.classList.contains('effects-off')) {
        ctx.clearRect(0, 0, width, height);
        requestAnimationFrame(animate);
        return;
    }
    ctx.clearRect(0, 0, width, height);

    // --- Update edge state ---
    for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (e.broken) {
            e.weight = Math.max(0, e.weight - 0.008);
            e.breakAnim = Math.max(0, e.breakAnim - 0.02);
        }
        e.trafficGlow *= 0.96;
    }

    // --- Draw edges: batch idle edges into one stroke call ---
    ctx.beginPath();
    ctx.strokeStyle = document.documentElement.getAttribute('data-theme') === 'dark'
        ? 'rgb(200,195,188)' : 'rgb(22,22,22)';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (e.broken || e.weight <= 0 || e.trafficGlow > 0.02) continue;
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
    }
    ctx.stroke();

    // Draw active/broken edges individually
    for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (e.weight <= 0) continue;

        if (e.broken && e.breakAnim > 0) {
            const mx = (e.a.x + e.b.x) * 0.5, my = (e.a.y + e.b.y) * 0.5;
            const gap = (1 - e.breakAnim) * 20;
            const angle = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x);
            const gx = Math.cos(angle) * gap, gy = Math.sin(angle) * gap;
            ctx.globalAlpha = 0.4 * e.weight;
            ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(mx - gx, my - gy);
            ctx.strokeStyle = '#964137'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.beginPath(); ctx.moveTo(mx + gx, my + gy); ctx.lineTo(e.b.x, e.b.y);
            ctx.stroke(); ctx.globalAlpha = 1;
            continue;
        }

        if (e.trafficGlow <= 0.02) continue; // already drawn in batch
        const glow = e.trafficGlow < 1 ? e.trafficGlow : 1;
        ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y);
        ctx.lineWidth = 1 + glow * 2.5;
        ctx.globalAlpha = 0.12 + glow * 0.25;
        ctx.strokeStyle = edgeColorFromGlow(glow);
        ctx.stroke();
    }

    // --- Spawn packets toward cursor ---
    if (hoverNode && activePacketCount < MAX_PACKETS && Math.random() < 0.08) {
        spawnPacketToward(hoverNode);
    }
    // Ambient traffic (slow) when no hover
    if (!hoverNode && activePacketCount < 12 && Math.random() < 0.015) {
        const src = pickRandomBorderNode();
        if (src) {
            const adj = src.adjEdges;
            for (let j = 0; j < adj.length; j++) {
                const e = edges[adj[j]];
                if (!e.broken && e.weight > 0.5) {
                    const fwd = e.a === src;
                    if (acquirePacket(e, fwd, null)) src.traffic += 0.2;
                    break;
                }
            }
        }
    }

    // --- Update & draw packets ---
    ctx.fillStyle = '#964137';
    for (let i = 0; i < MAX_PACKETS; i++) {
        const p = packets[i];
        if (!p.active) continue;
        p.progress += p.forward ? PACKET_SPEED : -PACKET_SPEED;

        if (p.progress >= 1 || p.progress <= 0) {
            const arrived = p.forward ? p.edge.b : p.edge.a;
            arrived.traffic += 0.3;
            p.edge.trafficGlow += 0.12;

            // Update target if hoverNode changed
            if (hoverNode) p.target = hoverNode;

            // Reached the target? Recycle: spawn at a far-away node
            if (p.target && arrived === p.target) {
                // Recycle: spawn at a random different node
                let origin = null;
                for (let attempts = 0; attempts < 10; attempts++) {
                    const candidate = nodes[Math.floor(Math.random() * nodes.length)];
                    if (candidate !== p.target) { origin = candidate; break; }
                }
                if (origin) {
                    const next = nextEdgeToward(origin, p.target, null);
                    if (next) {
                        const fwd = next.a === origin;
                        p.edge = next;
                        p.progress = fwd ? 0 : 1;
                        p.forward = fwd;
                        origin.traffic += 0.15;
                        continue;
                    }
                }
                releasePacket(p);
                continue;
            }

            // Route toward target (greedy) or random walk
            const target = p.target;
            let next = null;
            if (target) {
                next = nextEdgeToward(arrived, target, p.edge);
            }
            if (!next) {
                // Random walk fallback
                const adj = arrived.adjEdges;
                let candidateCount = 0;
                for (let j = 0; j < adj.length; j++) {
                    const e = edges[adj[j]];
                    if (!e.broken && e.weight > 0.3 && e !== p.edge) {
                        candidateCount++;
                        if (Math.random() * candidateCount < 1) next = e;
                    }
                }
            }

            if (next) {
                const fwd = next.a === arrived;
                p.edge = next;
                p.progress = fwd ? 0 : 1;
                p.forward = fwd;
                next.trafficGlow += 0.08;
            } else {
                releasePacket(p);
            }
            continue;
        }

        // Draw packet
        const sx = p.edge.a.x, sy = p.edge.a.y;
        const tx = p.edge.b.x, ty = p.edge.b.y;
        const px = sx + (tx - sx) * p.progress;
        const py = sy + (ty - sy) * p.progress;

        const glow = Math.sin(p.progress * 3.14159);
        ctx.beginPath();
        ctx.arc(px, py, 2.5 + glow * 1.5, 0, TWO_PI);
        ctx.globalAlpha = 0.3 + glow * 0.4;
        ctx.fill();

        // Soft outer glow
        ctx.beginPath();
        ctx.arc(px, py, 5 + glow * 3, 0, TWO_PI);
        ctx.globalAlpha = glow * 0.06;
        ctx.fill();
    }

    // --- Update & draw nodes ---
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx; n.y += n.vy;
        if (n.x < 30 || n.x > width - 30) n.vx *= -1;
        if (n.y < 30 || n.y > height - 30) n.vy *= -1;

        n.traffic *= 0.97;
        n.pulsePhase += 0.01;
        const pulse = Math.sin(n.pulsePhase) * 0.5 + 0.5;

        const isHover = n === hoverNode;
        const congestion = n.traffic < 3 ? n.traffic : 3;
        const radius = NODE_RADIUS + congestion * 1.5 + pulse * 0.8 + (isHover ? 4 : 0);
        const alpha = 0.45 + (congestion * 0.12 < 0.4 ? congestion * 0.12 : 0.4);

        // Congestion ring
        if (congestion > 0.5) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, radius + 3, 0, TWO_PI);
            ctx.globalAlpha = congestion * 0.05;
            ctx.strokeStyle = '#964137';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Solid fill
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, TWO_PI);
        ctx.globalAlpha = alpha;
        if (isHover) {
            ctx.fillStyle = 'rgb(120,35,30)';
        } else {
            const rv = 30 + (congestion * 30) | 0;
            ctx.fillStyle = nodeFillStyle(rv);
        }
        ctx.fill();
    }

    ctx.globalAlpha = 1;

    requestAnimationFrame(animate);
}

resize();
window.addEventListener('resize', resize);
init();
animate();
})();
