const canvas = document.getElementById('network-canvas');
const ctx = canvas.getContext('2d');

let width, height;

// Network configuration: Larger, more visually impressive topology
const layersInfo = [4, 10, 14, 10, 4];
let layers = [];
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

function resize() {
    // Robustness optimization: Bound the Max scaling to `2` to prevent memory crashing 
    // the max-texture size on 4k/8k ultrawide ultra-HDPi displays.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    
    ctx.scale(dpr, dpr);
    
    layoutNetwork();
}

function initNetwork() {
    layers = [];
    connections = [];
    

    for (let l = 0; l < layersInfo.length; l++) {
        let nodeCount = layersInfo[l];
        let layer = [];
        for (let i = 0; i < nodeCount; i++) {
            layer.push({
                layerIndex: l,
                index: i,
                activation: 0,
                visualActivation: 0, 
                bias: (Math.random() - 0.5) * 2,
                error: 0,
                baseX: 0, baseY: 0,
                x: 0, y: 0,
                phaseOff: Math.random() * Math.PI * 2,
                incoming: [], // O(N) optimization: track connections directly on the node
                outgoing: [] 
            });
        }
        layers.push(layer);
    }

    for (let l = 0; l < layers.length - 1; l++) {
        let currentLayer = layers[l];
        let nextLayer = layers[l + 1];
        
        currentLayer.forEach(source => {
            nextLayer.forEach(target => {
                let conn = {
                    source,
                    target,
                    weight: (Math.random() - 0.5) * 2,
                    signalActivity: 0
                };
                connections.push(conn);
                source.outgoing.push(conn);
                target.incoming.push(conn);
            });
        });
    }
}

function layoutNetwork() {
    const layerSpacing = width / (layersInfo.length + 1);
    
    layers.forEach((layer, l) => {
        const x = layerSpacing * (l + 1);
        const nodeSpacing = Math.min(height / (layer.length + 1), 70);
        const totalLayerHeight = (layer.length - 1) * nodeSpacing;
        const startY = (height - totalLayerHeight) / 2;
        
        layer.forEach((node, i) => {
            node.baseX = x;
            node.baseY = startY + (i * nodeSpacing);
            node.x = node.baseX;
            node.y = node.baseY;
        });
    });
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
        layers[l].forEach(targetNode => {
            let sum = targetNode.bias;
            // Pre-computed lookup destroys the O(N) GC footprint!
            targetNode.incoming.forEach(conn => {
                sum += conn.source.activation * conn.weight;
                
                const contribution = Math.abs(conn.source.activation * conn.weight);
                if (contribution > 0.5) { 
                    conn.signalActivity = Math.min(1.2, conn.signalActivity + contribution * 0.5);
                    spawnPacket(conn, contribution);
                }
            });
            targetNode.activation = sigmoid(sum);
        });
    }
}

function backwardPass(targets) {
    const outputNodes = layers[layers.length - 1];
    outputNodes.forEach((node, i) => {
        const target = targets[i % targets.length];
        // Using Cross-Entropy equivalent gradient ensures outputs literally NEVER freeze when confident
        node.error = (target - node.activation); 
    });

    for (let l = layers.length - 2; l >= 0; l--) {
        layers[l].forEach(sourceNode => {
            let errorSum = 0;
            // O(1) Adjacency lookup over array-wide filters
            sourceNode.outgoing.forEach(conn => {
                // To prevent the "dead network" syndrome where decayed 0-weights block 
                // all learning signals to deep layers, we guarantee a minimum transmission flow.
                const transWeight = Math.abs(conn.weight) < 0.3 ? (Math.sign(conn.weight || 1) * 0.3) : conn.weight;
                errorSum += conn.target.error * transWeight;
            });
            sourceNode.error = errorSum * dSigmoid(sourceNode.activation);
        });
    }

    connections.forEach(conn => {
        // Gradient tracking
        const rawGrad = conn.target.error * conn.source.activation;
        
        // Rprop-style Update
        const update = Math.sign(rawGrad) * LEARNING_RATE * Math.min(Math.abs(rawGrad * 5), 1.0);
        conn.weight += update;
        
        // Keep weights bounded
        if (conn.weight > 6) conn.weight = 6;
        if (conn.weight < -6) conn.weight = -6;
    });

    for (let l = 1; l < layers.length; l++) {
        layers[l].forEach(node => {
            const update = Math.sign(node.error) * LEARNING_RATE * Math.min(Math.abs(node.error * 5), 1.0);
            node.bias += update;
            if (node.bias > 6) node.bias = 6;
            if (node.bias < -6) node.bias = -6;
        });
    }
}

window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    isMoving = true;
});

window.addEventListener('scroll', () => {
    scrollY = window.scrollY;
});

function animate() {
    ctx.clearRect(0, 0, width, height);

    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    time += 0.05;
    const parallaxOffset = -(scrollY * 0.15);
    
    ctx.save();
    ctx.translate(0, parallaxOffset);

    if (isMoving) {
        const nx = mouseX / width;
        const ny = mouseY / height;
        
        // Complex, highly volatile shifting inputs tied to both mouse and time
        const phase = time * 0.5;
        forwardPass([
            Math.sin(nx * 10 + phase), 
            Math.cos(ny * 10 - phase), 
            Math.sin((nx + ny) * 5), 
            Math.cos((nx - ny) * 5)
        ]);
        
        // Target functions undulate violently with mouse position. 
        // With Tanh, targets go from -1 to 1 perfectly balancing red and black gradients!
        const t1 = Math.cos(nx * 15 + time);
        const t2 = Math.sin(ny * 15 - time);
        const t3 = Math.sin(nx * ny * 20);
        const t4 = Math.cos(nx * 20 + ny * 20 - phase);
        
        backwardPass([t1, t2, t3, t4]);
        
        isMoving = false;
        sleepTimer = 0; // Reset sleep timer when moving
    } else {
        sleepTimer++;

        // Absolutely no learning while idle.
        // Node activations organically power down, and structure softly evaporates over ~5 seconds (0.985 ^ 300)
        layers.forEach(layer => {
            layer.forEach(node => {
                node.activation *= 0.99; 
                node.bias *= 0.99;
            });
        });

        connections.forEach(conn => {
            conn.weight *= 0.99;
            // Spontaneous generation: If a weight dies completely, inject a tiny spark of noise 
            // so it's ready to learn if the mouse ever moves again
            if (Math.abs(conn.weight) < 0.2) {
                conn.weight = Math.sign(conn.weight || 1) * 0.2; // strict floor so it never truly dies
            }
        });
    }

    // Now update visuals smoothly towards the instantaneous math
    layers.forEach(layer => {
        layer.forEach(node => {
            node.x = node.baseX + Math.sin(time * 0.5 + node.phaseOff) * 4;
            node.y = node.baseY + Math.cos(time * 0.4 + node.phaseOff) * 4;
            // Unlink visuals slightly less so it's punchier
            node.visualActivation += (node.activation - node.visualActivation) * 0.3;
        });
    });

    // Draw lines based on weight
    connections.forEach(conn => {
        const weightMag = Math.abs(conn.weight);
        if (weightMag < 0.1) return; 

        ctx.beginPath();
        ctx.moveTo(conn.source.x, conn.source.y);
        ctx.lineTo(conn.target.x, conn.target.y);

        // Highly magnified line width scaling so weight shifts are blatantly visible
        ctx.lineWidth = Math.min(weightMag * 1.2, 5.0);
        
        const baseAlpha = Math.min(weightMag * 0.15, 0.4);
        const actAlpha = conn.signalActivity * 0.6;
        const alpha = Math.min(baseAlpha + actAlpha, 0.95);

        // Pre-calculated Hex to kill String GC!
        ctx.globalAlpha = conn.weight > 0 ? alpha : alpha * 0.9;
        ctx.strokeStyle = conn.weight > 0 ? '#161616' : '#b43232';
        
        ctx.stroke();
        
        conn.signalActivity = Math.max(0, conn.signalActivity - 0.03);
    });

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
            ctx.arc(px, py, p.size, 0, Math.PI * 2);
            ctx.globalAlpha = Math.sin(p.progress * Math.PI) * 0.95;
            ctx.fillStyle = p.conn.weight > 0 ? '#161616' : '#b43232'; 
            ctx.fill();
        }
    }

    // Draw solid geometric nodes
    layers.forEach((layer, l) => {
        layer.forEach(node => {
            ctx.beginPath();
            
            // Use absolute value of visualActivation since Tanh can be negative
            const absAct = Math.abs(node.visualActivation);
            // Increased baseline minimums so nodes (biases) never become physically invisible
            const radius = 4.5 + (absAct * 2.5);
            ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
            
            ctx.globalAlpha = 0.4 + (absAct * 0.6);
            ctx.fillStyle = '#161616';
            ctx.fill();
            
            ctx.lineWidth = 1;
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = '#161616';
            ctx.stroke();
            
            // Smoothed threshold (0.05 instead of 0.3) so glows fade in gently
            if (absAct > 0.05) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 4 + (absAct * 2), 0, Math.PI * 2);
                ctx.lineWidth = 0.5;
                ctx.globalAlpha = absAct * 0.8;
                ctx.stroke();
            }
        });
    });

    ctx.globalAlpha = 1.0; // Reset state
    ctx.restore();

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
window.addEventListener('resize', resize);
animate();
