import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================
// CONFIG
// ============================================
const GIST_ID = '397ef638ef931f3ace318e891a741312';

const REGIONS = [
    { key: 'v1',       name: 'Visual primario',      tag: 'V1',    pos: [0, 0.1, -1.15],   desc: 'Primary visual cortex - processes basic visual features' },
    { key: 'ffa',      name: 'Faces / avatares',     tag: 'FFA',   pos: [-1.05, -0.1, -0.4], desc: 'Fusiform face area - facial recognition and processing' },
    { key: 'ppa',      name: 'Layouts / cenas',      tag: 'PPA',   pos: [1.05, -0.1, -0.4],  desc: 'Parahippocampal place area - spatial layout perception' },
    { key: 'v5',       name: 'Movimento / animacao',  tag: 'V5',    pos: [-1.0, 0.3, -0.7],  desc: 'Visual motion area - movement and dynamic elements' },
    { key: 'ips',      name: 'Atencao visual',       tag: 'IPS',   pos: [0, 0.9, -0.3],     desc: 'Intraparietal sulcus - visual attention and focus' },
    { key: 'broca',    name: 'Texto / labels',        tag: 'Broca', pos: [-0.9, 0.2, 0.65],  desc: 'Broca area - language and text processing' },
    { key: 'pfc',      name: 'Decisao / memoria',     tag: 'PFC',   pos: [0, 0.5, 1.05],     desc: 'Prefrontal cortex - decision making and working memory' },
    { key: 'semantic', name: 'Semantica / contexto',  tag: 'SEM',   pos: [0.9, 0.0, 0.3],    desc: 'Semantic processing - meaning and context understanding' },
];

// ============================================
// STATE
// ============================================
let gradioUrl = null;
let currentFile = null;
let abFiles = { a: null, b: null };
let abResults = { a: null, b: null };
let brainScene = null;
let abBrainScenes = { a: null, b: null };

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initUpload();
    initABUpload();
    brainScene = createBrainScene('brainCanvas', 'brainContainer');
    checkGradioStatus();
});

// ============================================
// NAVIGATION
// ============================================
function initNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const view = btn.dataset.view;
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(view === 'ab-test' ? 'viewAbTest' : 'viewAnalyze').classList.add('active');

            // Init AB brain scenes on first switch
            if (view === 'ab-test' && !abBrainScenes.a) {
                abBrainScenes.a = createBrainScene('brainCanvasA', 'brainContainerA');
                abBrainScenes.b = createBrainScene('brainCanvasB', 'brainContainerB');
            }
        });
    });
}

// ============================================
// GRADIO CONNECTION
// ============================================
async function checkGradioStatus() {
    const dot = document.getElementById('statusDot');
    const txt = document.getElementById('statusText');
    try {
        const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, { cache: 'no-store' });
        const data = await res.json();
        const content = JSON.parse(data.files['gradio_url.json'].content);
        if (content.url && !content.url.includes('placeholder')) {
            gradioUrl = content.url.replace(/\/$/, '');
            // Test if actually reachable
            try {
                const test = await fetch(gradioUrl + '/info', { mode: 'cors', signal: AbortSignal.timeout(5000) });
                if (test.ok) {
                    dot.className = 'status-dot online';
                    txt.textContent = 'Server online';
                    document.getElementById('analyzeBtn').disabled = !currentFile;
                    return;
                }
            } catch {}
            dot.className = 'status-dot online';
            txt.textContent = 'Server found';
            document.getElementById('analyzeBtn').disabled = !currentFile;
        } else {
            dot.className = 'status-dot offline';
            txt.textContent = 'Server offline';
        }
    } catch {
        dot.className = 'status-dot offline';
        txt.textContent = 'Server offline';
    }
}

// ============================================
// UPLOAD — Single Analysis
// ============================================
function initUpload() {
    const zone = document.getElementById('uploadZone');
    const input = document.getElementById('fileInput');
    const preview = document.getElementById('uploadPreview');
    const previewImg = document.getElementById('previewImg');
    const clearBtn = document.getElementById('clearBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        handleFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });

    clearBtn.addEventListener('click', () => {
        currentFile = null;
        preview.style.display = 'none';
        zone.style.display = 'flex';
        analyzeBtn.disabled = true;
    });

    analyzeBtn.addEventListener('click', () => runAnalysis());

    function handleFile(file) {
        if (!file) return;
        currentFile = file;
        zone.style.display = 'none';
        preview.style.display = 'block';
        if (file.type.startsWith('image/')) {
            previewImg.src = URL.createObjectURL(file);
        } else {
            previewImg.src = '';
            previewImg.alt = file.name;
        }
        analyzeBtn.disabled = !gradioUrl;
    }
}

// ============================================
// UPLOAD — A/B Test
// ============================================
function initABUpload() {
    ['a', 'b'].forEach(side => {
        const zone = document.getElementById(`uploadZone${side.toUpperCase()}`);
        const input = zone.querySelector('.ab-file-input');
        const preview = document.getElementById(`preview${side.toUpperCase()}`);
        const previewImg = preview.querySelector('.ab-preview-img');
        const clearBtn = preview.querySelector('.ab-clear');

        zone.addEventListener('click', () => input.click());
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('dragover');
            handleABFile(side, e.dataTransfer.files[0]);
        });
        input.addEventListener('change', () => { if (input.files[0]) handleABFile(side, input.files[0]); });
        clearBtn.addEventListener('click', () => {
            abFiles[side] = null;
            preview.style.display = 'none';
            zone.style.display = 'flex';
            updateABButton();
        });
    });

    document.getElementById('abCompareBtn').addEventListener('click', () => runABAnalysis());

    function handleABFile(side, file) {
        if (!file) return;
        abFiles[side] = file;
        const zone = document.getElementById(`uploadZone${side.toUpperCase()}`);
        const preview = document.getElementById(`preview${side.toUpperCase()}`);
        const previewImg = preview.querySelector('.ab-preview-img');
        zone.style.display = 'none';
        preview.style.display = 'block';
        if (file.type.startsWith('image/')) {
            previewImg.src = URL.createObjectURL(file);
        }
        updateABButton();
    }

    function updateABButton() {
        document.getElementById('abCompareBtn').disabled = !(abFiles.a && abFiles.b && gradioUrl);
    }
}

// ============================================
// API CALL
// ============================================
async function callGradioAPI(file) {
    // Upload file
    const uploadData = new FormData();
    uploadData.append('files', file);
    const uploadRes = await fetch(gradioUrl + '/upload', {
        method: 'POST',
        body: uploadData,
    });
    const uploadJson = await uploadRes.json();
    const filePath = uploadJson[0];

    // Call the JSON API endpoint (fn_index=1 for analisar_json)
    const predictRes = await fetch(gradioUrl + '/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            data: [{ path: filePath, orig_name: file.name, size: file.size, mime_type: file.type }],
            fn_index: 1,
        }),
    });
    const result = await predictRes.json();
    return JSON.parse(result.data[0]);
}

// ============================================
// SINGLE ANALYSIS
// ============================================
async function runAnalysis() {
    if (!currentFile || !gradioUrl) return;
    showLoading('Analyzing brain activation patterns...');
    try {
        const result = await callGradioAPI(currentFile);
        displayResults(result);
    } catch (err) {
        console.error(err);
        alert('Error connecting to the server. Make sure the Colab notebook is running.');
    } finally {
        hideLoading();
    }
}

function displayResults(data) {
    const scores = data.scores;
    const report = data.relatorio;
    const elapsed = data.elapsed;

    // Hide overlay
    document.getElementById('brainOverlay').classList.add('hidden');

    // Update brain
    updateBrainActivation(brainScene, scores);

    // Build metrics
    const grid = document.getElementById('metricsGrid');
    grid.innerHTML = '';
    REGIONS.forEach((r, i) => {
        const keys = Object.keys(scores);
        const val = scores[keys[i]];
        const level = val >= 65 ? 'high' : val >= 40 ? 'medium' : 'low';
        const levelText = val >= 65 ? 'High' : val >= 40 ? 'Medium' : 'Low';
        const color = val >= 65 ? '#D85A30' : val >= 40 ? '#EF9F27' : '#888780';

        const card = document.createElement('div');
        card.className = `metric-card level-${level}`;
        card.innerHTML = `
            <div class="metric-name">${r.name}</div>
            <div class="metric-region">${r.tag}</div>
            <div class="metric-value-row">
                <span class="metric-value">${val.toFixed(0)}</span>
                <span class="metric-unit">/100</span>
            </div>
            <span class="metric-level ${level}">${levelText}</span>
            <div class="metric-bar"><div class="metric-bar-fill" style="width:${val}%;background:${color}"></div></div>
        `;
        card.addEventListener('click', () => {
            document.querySelectorAll('.metric-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            isolateBrainRegion(brainScene, i);
            document.getElementById('brainRegionLabel').textContent = `${r.tag} — ${r.desc}`;
        });
        grid.appendChild(card);
    });

    // UX Score
    const allVals = Object.values(scores);
    const uxScore = (allVals.reduce((a, b) => a + b, 0) / allVals.length).toFixed(0);
    document.getElementById('scoreCard').style.display = 'block';
    document.getElementById('scoreValue').textContent = uxScore;
    document.getElementById('scoreBarFill').style.width = uxScore + '%';

    // Report
    if (report) {
        document.getElementById('reportCard').style.display = 'block';
        document.getElementById('reportMeta').textContent = `${elapsed.toFixed(1)}s inference`;
        document.getElementById('reportContent').innerHTML = formatReport(report);
    }
}

// ============================================
// A/B ANALYSIS
// ============================================
async function runABAnalysis() {
    if (!abFiles.a || !abFiles.b || !gradioUrl) return;
    showLoading('Analyzing Version A...');
    try {
        const resultA = await callGradioAPI(abFiles.a);
        abResults.a = resultA;
        displayABResults('a', resultA);

        document.getElementById('loadingText').textContent = 'Analyzing Version B...';
        const resultB = await callGradioAPI(abFiles.b);
        abResults.b = resultB;
        displayABResults('b', resultB);

        displayABComparison(resultA, resultB);
    } catch (err) {
        console.error(err);
        alert('Error connecting to the server. Make sure the Colab notebook is running.');
    } finally {
        hideLoading();
    }
}

function displayABResults(side, data) {
    const scores = data.scores;
    const scene = abBrainScenes[side];

    if (scene) updateBrainActivation(scene, scores);

    // Metrics
    const grid = document.getElementById(`metrics${side.toUpperCase()}`);
    grid.innerHTML = '';
    REGIONS.forEach((r, i) => {
        const keys = Object.keys(scores);
        const val = scores[keys[i]];
        const level = val >= 65 ? 'high' : val >= 40 ? 'medium' : 'low';
        const color = val >= 65 ? '#D85A30' : val >= 40 ? '#EF9F27' : '#888780';
        const card = document.createElement('div');
        card.className = `metric-card level-${level}`;
        card.innerHTML = `
            <div class="metric-name">${r.name}</div>
            <div class="metric-value-row">
                <span class="metric-value" style="font-size:24px">${val.toFixed(0)}</span>
                <span class="metric-unit">/100</span>
            </div>
            <div class="metric-bar"><div class="metric-bar-fill" style="width:${val}%;background:${color}"></div></div>
        `;
        card.addEventListener('click', () => {
            if (scene) isolateBrainRegion(scene, i);
            const label = document.querySelector(`.ab-region-label[data-side="${side}"]`);
            if (label) label.textContent = `${r.tag} — ${r.name}`;
        });
        grid.appendChild(card);
    });

    // Score
    const allVals = Object.values(scores);
    const uxScore = (allVals.reduce((a, b) => a + b, 0) / allVals.length).toFixed(0);
    const scoreCard = document.getElementById(`scoreCard${side.toUpperCase()}`);
    scoreCard.style.display = 'block';
    scoreCard.querySelector('.ab-score-value').textContent = uxScore;
    scoreCard.querySelector('.ab-score-fill').style.width = uxScore + '%';
}

function displayABComparison(a, b) {
    const card = document.getElementById('abReportCard');
    card.style.display = 'block';

    const grid = document.getElementById('abComparisonGrid');
    grid.innerHTML = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px"><span style="color:var(--accent);font-weight:600">A</span> vs <span style="color:#3478f6;font-weight:600">B</span></div><div></div>';

    const keysA = Object.keys(a.scores);
    REGIONS.forEach((r, i) => {
        const valA = a.scores[keysA[i]];
        const valB = b.scores[keysA[i]];
        const diff = valA - valB;
        const winner = diff > 0 ? 'A' : diff < 0 ? 'B' : 'tie';
        const item = document.createElement('div');
        item.className = 'ab-comparison-item';
        item.innerHTML = `
            <span class="region-name">${r.name} (${r.tag})</span>
            <span class="scores">
                <span class="score-a">${valA.toFixed(0)}</span>
                <span style="color:var(--text-muted)">vs</span>
                <span class="score-b">${valB.toFixed(0)}</span>
                <span style="font-size:12px;color:${winner === 'A' ? 'var(--accent)' : winner === 'B' ? '#3478f6' : 'var(--text-muted)'}">${winner === 'tie' ? '=' : winner + ' wins'}</span>
            </span>
        `;
        grid.appendChild(item);
    });

    // Overall comparison
    const avgA = Object.values(a.scores).reduce((x, y) => x + y, 0) / keysA.length;
    const avgB = Object.values(b.scores).reduce((x, y) => x + y, 0) / keysA.length;
    const reportEl = document.getElementById('abReportContent');
    reportEl.innerHTML = `
        <h2>Overall Comparison</h2>
        <p><strong>Version A:</strong> UX Score ${avgA.toFixed(0)}/100</p>
        <p><strong>Version B:</strong> UX Score ${avgB.toFixed(0)}/100</p>
        <p>${avgA > avgB ? 'Version A shows stronger overall brain engagement, suggesting a more effective UX design.' : avgB > avgA ? 'Version B shows stronger overall brain engagement, suggesting a more effective UX design.' : 'Both versions show similar brain engagement levels.'}</p>
        ${a.relatorio ? '<h2>Report A</h2>' + formatReport(a.relatorio) : ''}
        ${b.relatorio ? '<h2>Report B</h2>' + formatReport(b.relatorio) : ''}
    `;
}

// ============================================
// THREE.JS — BRAIN VISUALIZATION
// ============================================
function createBrainScene(canvasId, containerId) {
    const canvas = document.getElementById(canvasId);
    const container = document.getElementById(containerId);
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d0d);

    // Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.5, 3.5);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.minDistance = 2;
    controls.maxDistance = 6;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(3, 4, 5);
    scene.add(dirLight);
    const backLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    backLight.position.set(-3, -2, -3);
    scene.add(backLight);

    // Build brain
    const brainGroup = new THREE.Group();
    scene.add(brainGroup);

    // Hemispheres
    const brainMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xd4c9a8,
        transparent: true,
        opacity: 0.25,
        roughness: 0.7,
        metalness: 0.1,
        clearcoat: 0.3,
        side: THREE.DoubleSide,
    });

    const leftHemi = createHemisphere(-1);
    leftHemi.material = brainMaterial.clone();
    brainGroup.add(leftHemi);

    const rightHemi = createHemisphere(1);
    rightHemi.material = brainMaterial.clone();
    brainGroup.add(rightHemi);

    // Region hotspots
    const hotspots = [];
    const hotspotGroup = new THREE.Group();
    brainGroup.add(hotspotGroup);

    REGIONS.forEach((r, i) => {
        const geo = new THREE.SphereGeometry(0.18, 24, 24);
        const mat = new THREE.MeshPhysicalMaterial({
            color: 0x888780,
            emissive: 0x888780,
            emissiveIntensity: 0.2,
            transparent: true,
            opacity: 0.6,
            roughness: 0.4,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(r.pos[0], r.pos[1], r.pos[2]);
        mesh.userData = { regionIndex: i, region: r };
        hotspotGroup.add(mesh);
        hotspots.push(mesh);

        // Glow
        const glowGeo = new THREE.SphereGeometry(0.28, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0x888780,
            transparent: true,
            opacity: 0.08,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.copy(mesh.position);
        hotspotGroup.add(glow);
        mesh.userData.glow = glow;
    });

    // Raycaster for click
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(hotspots);
        if (intersects.length > 0) {
            const idx = intersects[0].object.userData.regionIndex;
            isolateBrainRegion(sceneData, idx);

            // Update label
            const r = REGIONS[idx];
            const label = container.closest('.card')?.querySelector('.card-badge')
                || document.getElementById('brainRegionLabel');
            if (label) label.textContent = `${r.tag} — ${r.desc}`;

            // Highlight metric card
            const metricCards = container.closest('.view')?.querySelectorAll('.metric-card') || [];
            metricCards.forEach((c, ci) => c.classList.toggle('active', ci === idx));
        }
    });

    // Resize
    const resizeObserver = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    // Animate
    function animate() {
        requestAnimationFrame(animate);
        controls.update();

        // Pulse hotspots
        const t = performance.now() * 0.001;
        hotspots.forEach((hs, i) => {
            const intensity = hs.userData.activation || 0;
            if (intensity > 0) {
                const pulse = 1 + Math.sin(t * 2 + i) * 0.08 * intensity;
                hs.scale.setScalar(pulse);
                if (hs.userData.glow) {
                    hs.userData.glow.scale.setScalar(pulse * 1.5);
                    hs.userData.glow.material.opacity = 0.05 + Math.sin(t * 1.5 + i) * 0.03 * intensity;
                }
            }
        });

        renderer.render(scene, camera);
    }
    animate();

    const sceneData = { scene, camera, renderer, controls, brainGroup, hotspots, hotspotGroup, leftHemi, rightHemi };
    return sceneData;
}

function createHemisphere(side) {
    const geo = new THREE.SphereGeometry(1, 64, 64);
    const positions = geo.attributes.position;

    for (let i = 0; i < positions.count; i++) {
        let x = positions.getX(i);
        let y = positions.getY(i);
        let z = positions.getZ(i);

        // Flatten into hemisphere
        if (side === -1 && x > 0.04) x = 0.04;
        if (side === 1 && x < -0.04) x = -0.04;

        // Shift apart
        x += side * 0.06;

        // Brain shape: elongate front-back, flatten top
        z *= 1.25;
        y *= 0.95;

        // Cortical folds (noise via sin combinations)
        const n = Math.sin(x * 8) * Math.cos(y * 6) * Math.sin(z * 7) * 0.04
                + Math.sin(x * 15 + y * 12) * 0.02
                + Math.cos(z * 18 + x * 10) * 0.015;

        const r = Math.sqrt(x * x + y * y + z * z);
        if (r > 0) {
            x += (x / r) * n;
            y += (y / r) * n;
            z += (z / r) * n;
        }

        positions.setXYZ(i, x, y, z);
    }

    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo);
    return mesh;
}

// ============================================
// BRAIN UPDATE
// ============================================
function updateBrainActivation(sceneData, scores) {
    if (!sceneData) return;
    const keys = Object.keys(scores);

    sceneData.hotspots.forEach((hs, i) => {
        const val = scores[keys[i]];
        const norm = val / 100;
        hs.userData.activation = norm;

        // Color: low=gray, medium=amber, high=red-orange
        let color;
        if (val >= 65) {
            const t = (val - 65) / 35;
            color = new THREE.Color().lerpColors(new THREE.Color(0xD85A30), new THREE.Color(0xff2200), t);
        } else if (val >= 40) {
            const t = (val - 40) / 25;
            color = new THREE.Color().lerpColors(new THREE.Color(0xEF9F27), new THREE.Color(0xD85A30), t);
        } else {
            const t = val / 40;
            color = new THREE.Color().lerpColors(new THREE.Color(0x555555), new THREE.Color(0xEF9F27), t);
        }

        hs.material.color.copy(color);
        hs.material.emissive.copy(color);
        hs.material.emissiveIntensity = 0.3 + norm * 0.7;
        hs.material.opacity = 0.5 + norm * 0.5;

        // Size based on activation
        const scale = 0.8 + norm * 0.6;
        hs.scale.setScalar(scale);

        // Glow
        if (hs.userData.glow) {
            hs.userData.glow.material.color.copy(color);
            hs.userData.glow.material.opacity = 0.05 + norm * 0.15;
            hs.userData.glow.scale.setScalar(scale * 1.6);
        }
    });
}

function isolateBrainRegion(sceneData, activeIndex) {
    if (!sceneData) return;

    sceneData.hotspots.forEach((hs, i) => {
        if (i === activeIndex) {
            // Highlight selected
            hs.material.opacity = 1;
            hs.material.emissiveIntensity = 1.2;
            const scale = 1.3;
            hs.scale.setScalar(scale);
            if (hs.userData.glow) {
                hs.userData.glow.material.opacity = 0.3;
                hs.userData.glow.scale.setScalar(scale * 2);
            }
        } else {
            // Dim others
            hs.material.opacity = 0.15;
            hs.material.emissiveIntensity = 0.05;
            hs.scale.setScalar(0.7);
            if (hs.userData.glow) {
                hs.userData.glow.material.opacity = 0.01;
                hs.userData.glow.scale.setScalar(0.7);
            }
        }
    });

    // Make brain shell more transparent
    sceneData.leftHemi.material.opacity = 0.12;
    sceneData.rightHemi.material.opacity = 0.12;

    // Stop auto-rotate and look at region
    sceneData.controls.autoRotate = false;
}

// ============================================
// HELPERS
// ============================================
function formatReport(text) {
    if (!text) return '';
    return text
        .replace(/## (.*)/g, '<h2>$1</h2>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}

function showLoading(msg) {
    document.getElementById('loadingText').textContent = msg;
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}
