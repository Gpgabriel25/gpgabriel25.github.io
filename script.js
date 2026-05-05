const canvas = document.getElementById('network-canvas');
const ctx = canvas.getContext('2d', { alpha: true });

let width, height, dpr = 1;
const TWO_PI = Math.PI * 2;

// Network configuration: Larger, more visually impressive topology
const layersInfo = [4, 10, 14, 10, 4];
let layers = [];
let allNodes = [];
let connections = [];

// Gentle learning rate, since we now normalize all gradient steps
const LEARNING_RATE = 0.15; // Boosted so it recovers quickly from the decay state

// Switch to Tanh activation to perfectly balance positive/negative signals (-1 to 1)
// This strictly guarantees an equal balance of Red and Black weights mathematically!
const sigmoid = x => Math.tanh(x);
const dSigmoid = act => (1 - (act * act)) + 0.1; 

let mouseX = 0;
let mouseY = 0;
let isMoving = false;
let scrollY = 0;
let time = 0;
let sleepTimer = 0; // Optimization tracker
let frameCount = 0;
let lastFrameTime = 0;
const _fwdInputs = new Array(4);
const _bwdTargets = new Array(4);

function resize() {
    // Robustness optimization: Bound the Max scaling to `2` to prevent memory crashing 
    // the max-texture size on 4k/8k ultrawide ultra-HDPi displays.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    
    layoutNetwork();
}

function initNetwork() {
    layers = [];
    allNodes = [];
    connections = [];
    

    for (let l = 0; l < layersInfo.length; l++) {
        let nodeCount = layersInfo[l];
        let layer = [];
        for (let i = 0; i < nodeCount; i++) {
            const node = {
                layerIndex: l,
                index: i,
                activation: 0,
                visualActivation: 0, 
                bias: (Math.random() - 0.5) * 2,
                error: 0,
                baseX: 0, baseY: 0,
                x: 0, y: 0,
                phaseOff: Math.random() * TWO_PI,
                incoming: [], // O(N) optimization: track connections directly on the node
                outgoing: [] 
            };
            layer.push(node);
            allNodes.push(node);
        }
        layers.push(layer);
    }

    for (let l = 0; l < layers.length - 1; l++) {
        let currentLayer = layers[l];
        let nextLayer = layers[l + 1];
        
        for (let si = 0; si < currentLayer.length; si++) {
            const source = currentLayer[si];
            for (let ti = 0; ti < nextLayer.length; ti++) {
                const target = nextLayer[ti];
                let conn = {
                    source,
                    target,
                    weight: (Math.random() - 0.5) * 2,
                    signalActivity: 0
                };
                connections.push(conn);
                source.outgoing.push(conn);
                target.incoming.push(conn);
            }
        }
    }
}

function layoutNetwork() {
    // Keep it left-to-right, but strictly bound the vertical layout so it isn't completely 'squished' and tall on phones
    const isMobile = width < 600;
    
    // Scale horizontal spacing fully
    const layerSpacing = width / (layersInfo.length + 1);
    
    // Stretch vertically to a beautiful arbitrary proportion (75% of screen height) 
    // so it breathes naturally on mobile without hitting the extreme top/bottom edges!
    const layoutHeight = isMobile ? (height * 0.75) : height;
    
    for (let l = 0; l < layers.length; l++) {
        const layer = layers[l];
        const x = layerSpacing * (l + 1);
        
        let nodeSpacing = Math.min(layoutHeight / (layer.length + 1), 70);
        
        // Let it expand slightly past layout height if there are many nodes, but safely centered
        const totalLayerHeight = (layer.length - 1) * nodeSpacing;
        const startY = (height - totalLayerHeight) / 2; // Always center on screen vertically!
        
        for (let i = 0; i < layer.length; i++) {
            const node = layer[i];
            node.baseX = x;
            node.baseY = startY + (i * nodeSpacing);
            node.x = node.baseX;
            node.y = node.baseY;
        }
    }
}

// Object Pool for Data Packets to prevent GC thrashing
const MAX_PACKETS = 25;
let packetPool = Array.from({ length: MAX_PACKETS }, () => ({
    active: false, conn: null, progress: 0, speed: 0, size: 0
}));

function spawnPacket(conn, intensity) {
    if (Math.random() > 0.05) return;
    
    // Find an inactive packet in the pool
    for (let i = 0; i < MAX_PACKETS; i++) {
        if (!packetPool[i].active) {
            let p = packetPool[i];
            p.active = true;
            p.conn = conn;
            p.progress = 0;
            p.speed = 0.008 + Math.random() * 0.005;
            p.size = 1.5 + Math.random() * 2.0;
            break;
        }
    }
}

function forwardPass(inputs) {
    // Dynamic mapping allows inputs to mismatch layer sizes safely
    const inCount = Math.min(inputs.length, layers[0].length);
    for (let i = 0; i < inCount; i++) {
        layers[0][i].activation = inputs[i];
    }

    for (let l = 1; l < layers.length; l++) {
        const layer = layers[l];
        for (let n = 0; n < layer.length; n++) {
            const targetNode = layer[n];
            let sum = targetNode.bias;
            // Pre-computed lookup destroys the O(N) GC footprint!
            const incoming = targetNode.incoming;
            for (let ci = 0; ci < incoming.length; ci++) {
                const conn = incoming[ci];
                sum += conn.source.activation * conn.weight;
                
                const contribution = Math.abs(conn.source.activation * conn.weight);
                if (contribution > 0.3) { // Lowered activity threshold so it sparks much easier!
                    conn.signalActivity = Math.min(1.5, conn.signalActivity + contribution * 0.8);
                    spawnPacket(conn, contribution);
                }
            }
            targetNode.activation = sigmoid(sum);
        }
    }
}

function backwardPass(targets) {
    const outputNodes = layers[layers.length - 1];
    for (let i = 0; i < outputNodes.length; i++) {
        const node = outputNodes[i];
        const target = targets[i % targets.length];
        // Using Cross-Entropy equivalent gradient ensures outputs literally NEVER freeze when confident
        node.error = (target - node.activation); 
    }

    for (let l = layers.length - 2; l >= 0; l--) {
        const layer = layers[l];
        for (let si = 0; si < layer.length; si++) {
            const sourceNode = layer[si];
            let errorSum = 0;
            // O(1) Adjacency lookup over array-wide filters
            const outgoing = sourceNode.outgoing;
            for (let oi = 0; oi < outgoing.length; oi++) {
                const conn = outgoing[oi];
                // To prevent the "dead network" syndrome where decayed 0-weights block 
                // all learning signals to deep layers, we guarantee a minimum transmission flow.
                const transWeight = Math.abs(conn.weight) < 0.3 ? (Math.sign(conn.weight || 1) * 0.3) : conn.weight;
                errorSum += conn.target.error * transWeight;
            }
            sourceNode.error = errorSum * dSigmoid(sourceNode.activation);
        }
    }

    for (let i = 0; i < connections.length; i++) {
        const conn = connections[i];
        // Gradient tracking
        const rawGrad = conn.target.error * conn.source.activation;
        
        // Rprop-style Update
        const update = Math.sign(rawGrad) * LEARNING_RATE * Math.min(Math.abs(rawGrad * 5), 1.0);
        conn.weight += update;
        
        // Keep weights bounded
        if (conn.weight > 6) conn.weight = 6;
        if (conn.weight < -6) conn.weight = -6;
    }

    for (let l = 1; l < layers.length; l++) {
        const layer = layers[l];
        for (let i = 0; i < layer.length; i++) {
            const node = layer[i];
            const update = Math.sign(node.error) * LEARNING_RATE * Math.min(Math.abs(node.error * 5), 1.0);
            node.bias += update;
            if (node.bias > 6) node.bias = 6;
            if (node.bias < -6) node.bias = -6;
        }
    }
}

window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    isMoving = true;
});

// Mobile touch support
document.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length > 0) {
        mouseX = e.touches[0].clientX;
        mouseY = e.touches[0].clientY;
        isMoving = true;
    }
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches.length > 0) {
        mouseX = e.touches[0].clientX;
        mouseY = e.touches[0].clientY;
        isMoving = true;
    }
}, { passive: true });

window.addEventListener('scroll', () => {
    scrollY = window.scrollY;
    isMoving = true; // Scrolling feeds raw energy to the network too!
});

function animate(now) {
    frameCount++;
    // If effects are off, skip drawing but keep rAF alive for when they turn back on
    if (document.documentElement.classList.contains('effects-off')) {
        requestAnimationFrame(animate);
        return;
    }
    // Time-based throttle: cap at ~30fps when idle (consistent on any refresh rate)
    if (sleepTimer > 300) {
        if (now - lastFrameTime < 33) {
            requestAnimationFrame(animate);
            return;
        }
    }
    lastFrameTime = now;
    ctx.clearRect(0, 0, width, height);

    time += 0.05;
    const parallaxOffset = -(scrollY * 0.15);

    ctx.setTransform(dpr, 0, 0, dpr, 0, parallaxOffset * dpr);

    if (isMoving) {
        // Tie inputs to both mouse position AND the physical page scroll, 
        // so mobile flick-scrolling causes massive data cascading even when thumbs let go of the screen!
        const nx = (mouseX / width) + (scrollY * 0.005);
        const ny = (mouseY / height) + (scrollY * 0.003);
        
        // Complex, highly volatile shifting inputs tied to both mouse and time
        const phase = time * 0.5;
        _fwdInputs[0] = Math.sin(nx * 10 + phase);
        _fwdInputs[1] = Math.cos(ny * 10 - phase);
        _fwdInputs[2] = Math.sin((nx + ny) * 5);
        _fwdInputs[3] = Math.cos((nx - ny) * 5);
        forwardPass(_fwdInputs);
        
        // Target functions undulate violently with mouse position. 
        // With Tanh, targets go from -1 to 1 perfectly balancing red and black gradients!
        const t1 = Math.cos(nx * 15 + time);
        const t2 = Math.sin(ny * 15 - time);
        const t3 = Math.sin(nx * ny * 20);
        const t4 = Math.cos(nx * 20 + ny * 20 - phase);
        
        _bwdTargets[0] = t1;
        _bwdTargets[1] = t2;
        _bwdTargets[2] = t3;
        _bwdTargets[3] = t4;
        backwardPass(_bwdTargets);
        
        isMoving = false;
        sleepTimer = 0; // Reset sleep timer when moving
    } else {
        sleepTimer++;

        // Absolutely no learning while idle.
        // Node activations organically power down, and structure softly evaporates over ~5 seconds (0.985 ^ 300)
        for (let ni = 0; ni < allNodes.length; ni++) {
            const node = allNodes[ni];
            node.activation *= 0.99;
            node.bias *= 0.99;
        }

        for (let ci = 0; ci < connections.length; ci++) {
            const conn = connections[ci];
            conn.weight *= 0.99;
            // Spontaneous generation: If a weight dies completely, inject a tiny spark of noise 
            // so it's ready to learn if the mouse ever moves again
            if (Math.abs(conn.weight) < 0.2) {
                conn.weight = Math.sign(conn.weight || 1) * 0.2; // strict floor so it never truly dies
            }
        }
    }

    // Now update visuals smoothly towards the instantaneous math
    for (let ni = 0; ni < allNodes.length; ni++) {
        const node = allNodes[ni];
        node.x = node.baseX + Math.sin(time * 0.5 + node.phaseOff) * 4;
        node.y = node.baseY + Math.cos(time * 0.4 + node.phaseOff) * 4;
        // Unlink visuals slightly less so it's punchier
        node.visualActivation += (node.activation - node.visualActivation) * 0.3;
    }

    // Draw lines based on weight
    // Track last strokeStyle to skip redundant state changes
    const _isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const _inkColor = _isDark ? '#d8d3cc' : '#161616';
    let _lastStroke = '';
    for (let ci = 0; ci < connections.length; ci++) {
        const conn = connections[ci];
        const weightMag = Math.abs(conn.weight);
        if (weightMag < 0.1) continue;

        ctx.beginPath();
        ctx.moveTo(conn.source.x, conn.source.y);
        ctx.lineTo(conn.target.x, conn.target.y);

        // Highly magnified line width scaling so weight shifts are blatantly visible
        ctx.lineWidth = Math.min(weightMag * 1.2, 5.0);
        
        const baseAlpha = Math.min(weightMag * 0.15, 0.4);
        const actAlpha = conn.signalActivity * 0.6;
        const alpha = Math.min(baseAlpha + actAlpha, 0.95);

        const _posWeight = conn.weight > 0;
        ctx.globalAlpha = _posWeight ? alpha : alpha * 0.9;
        const _newStroke = _posWeight ? _inkColor : '#b43232';
        if (_newStroke !== _lastStroke) { ctx.strokeStyle = _newStroke; _lastStroke = _newStroke; }
        
        ctx.stroke();
        
        conn.signalActivity = Math.max(0, conn.signalActivity - 0.03);
    }

    // Draw Data Packets along lines using Object Pool
    for (let i = 0; i < MAX_PACKETS; i++) {
        let p = packetPool[i];
        if (!p.active) continue;

        p.progress += p.speed;
        if (p.progress >= 1) {
            p.active = false;
        } else {
            const px = p.conn.source.x + (p.conn.target.x - p.conn.source.x) * p.progress;
            const py = p.conn.source.y + (p.conn.target.y - p.conn.source.y) * p.progress;
            
            ctx.beginPath();
            ctx.arc(px, py, p.size, 0, TWO_PI);
            ctx.globalAlpha = Math.sin(p.progress * Math.PI) * 0.95;
            ctx.fillStyle = p.conn.weight > 0 ? _inkColor : '#b43232'; 
            ctx.fill();
        }
    }

    // Draw solid geometric nodes
    // Hoist constant state out of the loop
    ctx.fillStyle = _inkColor;
    ctx.strokeStyle = _inkColor;
    for (let ni = 0; ni < allNodes.length; ni++) {
        const node = allNodes[ni];
        ctx.beginPath();

        // Use absolute value of visualActivation since Tanh can be negative
        const absAct = Math.abs(node.visualActivation);
        // Increased baseline minimums so nodes (biases) never become physically invisible
        const radius = 4.5 + (absAct * 2.5);
        ctx.arc(node.x, node.y, radius, 0, TWO_PI);

        ctx.globalAlpha = 0.4 + (absAct * 0.6);
        ctx.fill();

        ctx.lineWidth = 1;
        ctx.globalAlpha = 1.0;
        ctx.stroke();

        // Smoothed threshold (0.05 instead of 0.3) so glows fade in gently
        if (absAct > 0.05) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 4 + (absAct * 2), 0, TWO_PI);
            ctx.lineWidth = 0.5;
            ctx.globalAlpha = absAct * 0.8;
            ctx.stroke();
            ctx.lineWidth = 1;
        }
    }

    ctx.globalAlpha = 1.0; // Reset state
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    requestAnimationFrame(animate);
}

// 'Invisible' Scroll Revelation Typography from Subagent
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0, rootMargin: "0px 0px -5% 0px" });

document.querySelectorAll('.post').forEach(el => {
    el.style.opacity = '0.01'; 
    el.style.transform = 'translateY(12px)';
    el.style.transition = 'opacity 1.2s cubic-bezier(0.19, 1, 0.22, 1), transform 1.2s cubic-bezier(0.19, 1, 0.22, 1)';
    el.style.willChange = 'opacity, transform';
    observer.observe(el);
});

initNetwork();
resize();
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
    // Safari iOS fix: Scrolling hides the URL bar, triggering a resize event just for height.
    // This causes the entire network to recalculate and teleport. We only resize on width changes!
    if (window.innerWidth !== lastWidth) {
        lastWidth = window.innerWidth;
        resize();
    }
});
animate();
