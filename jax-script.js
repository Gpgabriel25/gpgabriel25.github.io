(() => {
const canvas = document.getElementById('network-canvas');
const ctx = canvas.getContext('2d', { alpha: true });
let width, height, dpr;
const TAU = Math.PI * 2;
const OFFSCREEN_PAD = 50;
const FADE_ZONE = 200; // px from left edge where alpha fades to 0

// Smooth left-edge fade: returns 0..1
function leftFade(x) {
    if (x >= FADE_ZONE) return 1;
    if (x <= 0) return 0;
    return x / FADE_ZONE;
}

// --- Layout (percentage-based, recalculated on resize) ---
let COL_SPACING, NODE_COUNT, NODE_SPREAD, NODE_RADIUS, MAX_COLS, RIGHT_PAD;
let LABEL_FONT;

function computeLayout() {
    const isMobile = width < 700;
    // Spacing is ~15% of viewport width, clamped
    COL_SPACING = Math.max(100, Math.min(300, width * 0.15));
    // Nodes scale with height
    NODE_COUNT = isMobile ? 5 : 7;
    NODE_SPREAD = Math.max(40, height * 0.08);
    NODE_RADIUS = Math.max(4, Math.min(7, width * 0.004));
    RIGHT_PAD = width * 0.05;
    MAX_COLS = Math.ceil(width / COL_SPACING) + 2;
    LABEL_FONT = (NODE_RADIUS + 4) + 'px Inter,sans-serif';
}

// --- State ---
let timeAxis = 0;
let columns = [];
let allEdges = [];
let scrollSpeed = 0;
let lastScrollY = 0;
let hoverX = -9999, hoverY = -9999;
let lastWidth = 0;

function resize() {
    const newW = window.innerWidth;
    if (lastWidth && Math.abs(newW - lastWidth) < 2) return; // skip Safari bar
    lastWidth = newW;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = newW;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
}

function spawnColumn(tIndex) {
    const nodes = [];
    const centerY = height / 2;
    const totalSpread = (NODE_COUNT - 1) * NODE_SPREAD;
    const startY = centerY - totalSpread / 2;
    for (let i = 0; i < NODE_COUNT; i++) {
        nodes.push({
            y: startY + i * NODE_SPREAD + (Math.random() - 0.5) * NODE_SPREAD * 0.3,
            hovered: false,
            pulsePhase: Math.random() * TAU,
            trueParents: []
        });
    }
    const col = { t: tIndex, nodes, birthTime: timeAxis, label: 't=' + tIndex };
    columns.push(col);

    // Connect to previous columns — SPARSE: only 2-3 random edges per node pair
    if (columns.length > 1) {
        const start = Math.max(0, columns.length - 3);
        for (let p = start; p < columns.length - 1; p++) {
            const pCol = columns[p];
            for (let ci = 0; ci < col.nodes.length; ci++) {
                const cNode = col.nodes[ci];
                // Each target node gets 3-4 random source connections
                const numLinks = 3 + Math.floor(Math.random() * 2);
                // Fisher-Yates partial shuffle (no allocation)
                const pNodes = pCol.nodes;
                const pLen = pNodes.length;
                const count = numLinks < pLen ? numLinks : pLen;
                for (let k = 0; k < count; k++) {
                    const swap = k + ((Math.random() * (pLen - k)) | 0);
                    const tmp = pNodes[k]; pNodes[k] = pNodes[swap]; pNodes[swap] = tmp;
                }
                for (let k = 0; k < count; k++) {
                    const isTrue = Math.random() < 0.15;
                    const edge = {
                        source: pNodes[k], target: cNode,
                        sourceCol: pCol, targetCol: col,
                        isTrue
                    };
                    allEdges.push(edge);
                    if (isTrue) cNode.trueParents.push(edge);
                }
            }
        }
    }

    // Cull old columns
    while (columns.length > MAX_COLS) {
        const removed = columns.shift();
        let write = 0;
        for (let i = 0; i < allEdges.length; i++) {
            const edge = allEdges[i];
            if (edge.sourceCol !== removed && edge.targetCol !== removed) {
                allEdges[write++] = edge;
            } else if (edge.isTrue) {
                const parents = edge.target.trueParents;
                for (let p = 0; p < parents.length; p++) {
                    if (parents[p] === edge) {
                        parents[p] = parents[parents.length - 1];
                        parents.length--;
                        break;
                    }
                }
            }
        }
        allEdges.length = write;
    }
}

// --- Interaction ---
window.addEventListener('scroll', () => {
    const dy = Math.abs(window.scrollY - lastScrollY);
    scrollSpeed = Math.min(dy * 0.00015, 0.006);
    lastScrollY = window.scrollY;
}, { passive: true });

document.addEventListener('mousemove', e => { hoverX = e.clientX; hoverY = e.clientY; });
document.addEventListener('touchmove', e => {
    if (e.touches.length > 0) { hoverX = e.touches[0].clientX; hoverY = e.touches[0].clientY; }
}, { passive: true });
document.addEventListener('mouseleave', () => { hoverX = -9999; hoverY = -9999; });
document.addEventListener('touchend', () => { hoverX = -9999; hoverY = -9999; }, { passive: true });

// --- Main loop ---
function animate() {
    ctx.clearRect(0, 0, width, height);

    timeAxis += 0.002 + scrollSpeed;
    scrollSpeed *= 0.9;

    const currentT = Math.floor(timeAxis);
    if (columns.length === 0 || columns[columns.length - 1].t < currentT + 2) {
        spawnColumn(currentT + 2);
    }

    // --- Draw edges (batch by type to reduce state changes) ---
    // Spurious edges — batched into a single path per fade-in bucket
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#161616';
    ctx.beginPath();
    let batchAlpha = -1;
    for (let i = 0; i < allEdges.length; i++) {
        const e = allEdges[i];
        if (e.isTrue) continue;

        const sx = width - RIGHT_PAD - (timeAxis - e.sourceCol.t) * COL_SPACING;
        const tx = width - RIGHT_PAD - (timeAxis - e.targetCol.t) * COL_SPACING;
        if (tx < -OFFSCREEN_PAD || sx > width + OFFSCREEN_PAD) continue;

        const colAge = timeAxis - e.targetCol.birthTime;
        const fadeIn = colAge < 1.5 ? colAge / 1.5 : 1;
        const edgeFade = leftFade(Math.min(sx, tx));
        const alpha = 0.25 * fadeIn * edgeFade;
        if (alpha < 0.01) continue;

        // Flush if alpha changed significantly
        if (batchAlpha >= 0 && Math.abs(alpha - batchAlpha) > 0.02) {
            ctx.globalAlpha = batchAlpha;
            ctx.stroke();
            ctx.beginPath();
        }
        batchAlpha = alpha;
        ctx.moveTo(sx, e.source.y);
        ctx.lineTo(tx, e.target.y);
    }
    if (batchAlpha >= 0) {
        ctx.globalAlpha = batchAlpha;
        ctx.stroke();
    }

    // True edges
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#964137';
    ctx.fillStyle = '#964137';
    for (let i = 0; i < allEdges.length; i++) {
        const e = allEdges[i];
        if (!e.isTrue) continue;

        const sx = width - RIGHT_PAD - (timeAxis - e.sourceCol.t) * COL_SPACING;
        const tx = width - RIGHT_PAD - (timeAxis - e.targetCol.t) * COL_SPACING;
        if (tx < -OFFSCREEN_PAD || sx > width + OFFSCREEN_PAD) continue;

        const colAge = timeAxis - e.targetCol.birthTime;
        const fadeIn = colAge < 1.5 ? colAge / 1.5 : 1;
        const edgeFade = leftFade(Math.min(sx, tx));

        const mx = (sx + tx) * 0.5 + (e.source.y - e.target.y) * 0.1;
        const my = (e.source.y + e.target.y) * 0.5;

        ctx.beginPath();
        ctx.moveTo(sx, e.source.y);
        ctx.quadraticCurveTo(mx, my, tx, e.target.y);
        ctx.globalAlpha = 0.55 * fadeIn * edgeFade;
        ctx.stroke();

        // Arrowhead
        if (fadeIn > 0.3 && edgeFade > 0.1) {
            const angle = Math.atan2(e.target.y - my, tx - mx);
            ctx.beginPath();
            ctx.moveTo(tx, e.target.y);
            ctx.lineTo(tx - 7 * Math.cos(angle - 0.3), e.target.y - 7 * Math.sin(angle - 0.3));
            ctx.lineTo(tx - 7 * Math.cos(angle + 0.3), e.target.y - 7 * Math.sin(angle + 0.3));
            ctx.closePath();
            ctx.globalAlpha = 0.35 * fadeIn * edgeFade;
            ctx.fill();
        }
    }

    // --- Draw columns + nodes ---
    ctx.textAlign = 'center';
    ctx.font = LABEL_FONT;
    ctx.fillStyle = '#161616';
    const labelY = height / 2 - (NODE_COUNT / 2) * NODE_SPREAD - 15;
    for (let ci = 0; ci < columns.length; ci++) {
        const c = columns[ci];
        const x = width - RIGHT_PAD - (timeAxis - c.t) * COL_SPACING;
        if (x < -OFFSCREEN_PAD || x > width + OFFSCREEN_PAD) continue;
        const age = Math.max(0, timeAxis - c.t);
        const colAge = timeAxis - c.birthTime;
        const fadeIn = colAge < 1.5 ? colAge / 1.5 : 1;
        const colFade = leftFade(x);

        // Time label — absolute index
        ctx.globalAlpha = Math.max(0.15, 0.45 - age * 0.06) * fadeIn * colFade;
        ctx.fillText(c.label, x, labelY);

        for (let ni = 0; ni < c.nodes.length; ni++) {
            const n = c.nodes[ni];
            const dx = x - hoverX;
            const dy = n.y - hoverY;
            n.hovered = (dx * dx + dy * dy) < 1225;

            n.pulsePhase += 0.012;
            const pulse = Math.sin(n.pulsePhase) * 0.5 + 0.5;
            const baseAlpha = Math.max(0.2, 0.85 - age * 0.1) * fadeIn * colFade;
            const r = NODE_RADIUS + (n.hovered ? 2 : 0) + pulse * 0.8;

            // Charcoal fill
            ctx.beginPath();
            ctx.arc(x, n.y, r, 0, TAU);
            ctx.globalAlpha = baseAlpha;
            ctx.fillStyle = n.hovered ? '#964137' : '#1e1e1e';
            ctx.fill();

            // Hover: highlight true causal ancestors
            if (n.hovered) {
                const parents = n.trueParents;
                ctx.strokeStyle = '#964137';
                ctx.lineWidth = 1.5;
                ctx.globalAlpha = 0.5;
                for (let ei = 0; ei < parents.length; ei++) {
                    const e = parents[ei];
                    const esx = width - RIGHT_PAD - (timeAxis - e.sourceCol.t) * COL_SPACING;
                    if (esx < -OFFSCREEN_PAD || esx > width + OFFSCREEN_PAD) continue;
                    ctx.beginPath();
                    ctx.arc(esx, e.source.y, r + 3, 0, TAU);
                    ctx.stroke();
                }
            }
        }
    }

    ctx.globalAlpha = 1;

    requestAnimationFrame(animate);
}

resize();
window.addEventListener('resize', resize);
// Preload initial columns so graph is visible immediately
for (let i = 0; i <= MAX_COLS; i++) spawnColumn(i);
// Skip fade-in for preloaded columns
for (let i = 0; i < columns.length; i++) columns[i].birthTime = -2;
animate();
})();
