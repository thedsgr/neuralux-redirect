import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

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

function getScoreForRegion(scores, regionKey, fallbackIndex = null) {
    if (scores && Object.prototype.hasOwnProperty.call(scores, regionKey)) {
        const byKey = Number(scores[regionKey]);
        return Number.isFinite(byKey) ? byKey : 0;
    }
    if (fallbackIndex !== null) {
        const keys = Object.keys(scores || {});
        const fallbackKey = keys[fallbackIndex];
        const byIndex = Number(fallbackKey ? scores[fallbackKey] : 0);
        return Number.isFinite(byIndex) ? byIndex : 0;
    }
    return 0;
}

function getAllRegionScores(scores) {
    return REGIONS.map((r, i) => getScoreForRegion(scores, r.key, i));
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toCompactText(value, maxLength = 72) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeLevelLabel(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    if (['high', 'alta', 'alto', 'strong', 'good', 'verde'].includes(raw)) return 'high';
    if (['medium', 'med', 'média', 'media', 'moderate', 'mid', 'warning', 'amarelo'].includes(raw)) return 'medium';
    if (['low', 'baixa', 'baixo', 'weak', 'poor', 'red', 'vermelho'].includes(raw)) return 'low';
    return null;
}

function getIndexedRegionValue(source, regionKey, fallbackIndex) {
    if (source == null) return undefined;

    if (Array.isArray(source)) {
        return source[fallbackIndex];
    }

    if (typeof source !== 'object') {
        return source;
    }

    const lookupKeys = [
        regionKey,
        String(regionKey),
        fallbackIndex,
        String(fallbackIndex),
        REGIONS[fallbackIndex]?.tag,
    ].filter(value => value !== undefined && value !== null);

    for (const key of lookupKeys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            return source[key];
        }
    }

    for (const nestedKey of ['regions', 'by_region', 'confidence_by_region', 'evidence_by_region', 'items']) {
        if (source[nestedKey] != null) {
            const nested = getIndexedRegionValue(source[nestedKey], regionKey, fallbackIndex);
            if (nested !== undefined) {
                return nested;
            }
        }
    }

    return source;
}

function normalizeConfidenceValue(raw) {
    if (raw == null) return null;

    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) return null;
        const numeric = raw <= 1 ? raw * 100 : raw;
        const clamped = clamp(numeric, 0, 100);
        return {
            value: clamped,
            label: clamped >= 75 ? 'high' : clamped >= 45 ? 'medium' : 'low',
            text: `${Math.round(clamped)}%`,
        };
    }

    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return null;

        const numeric = Number(trimmed.replace('%', '').replace(',', '.'));
        if (Number.isFinite(numeric)) {
            return normalizeConfidenceValue(numeric);
        }

        const level = normalizeLevelLabel(trimmed);
        if (level) {
            return {
                value: null,
                label: level,
                text: level,
            };
        }

        return {
            value: null,
            label: null,
            text: trimmed,
        };
    }

    if (typeof raw === 'object') {
        const level = normalizeLevelLabel(
            raw.level ?? raw.label ?? raw.confidence_level ?? raw.confidenceLevel ?? raw.rank
        );
        const candidate =
            raw.value ??
            raw.score ??
            raw.percent ??
            raw.percentage ??
            raw.confidence ??
            raw.probability ??
            raw.pct;

        const numeric = candidate != null ? normalizeConfidenceValue(candidate) : null;
        if (numeric) {
            return {
                ...numeric,
                label: level || numeric.label,
            };
        }

        if (level) {
            return {
                value: null,
                label: level,
                text: level,
            };
        }

        const text =
            raw.text ??
            raw.summary ??
            raw.description ??
            raw.message ??
            raw.value ??
            raw.label ??
            null;

        if (text != null) {
            return {
                value: null,
                label: null,
                text: String(text),
            };
        }
    }

    return null;
}

function normalizeEvidenceValue(raw) {
    if (raw == null) return null;

    if (typeof raw === 'string') {
        return toCompactText(raw);
    }

    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) return null;
        return `${raw}`;
    }

    if (Array.isArray(raw)) {
        const parts = raw
            .map(item => normalizeEvidenceValue(item))
            .filter(Boolean);
        if (!parts.length) return null;
        if (parts.length <= 2) return parts.join(' · ');
        return `${parts.slice(0, 2).join(' · ')} +${parts.length - 2}`;
    }

    if (typeof raw === 'object') {
        const prioritizedTextKeys = [
            'summary',
            'text',
            'label',
            'description',
            'desc',
            'insight',
            'message',
            'note',
            'notes',
        ];

        for (const key of prioritizedTextKeys) {
            if (typeof raw[key] === 'string' && raw[key].trim()) {
                return toCompactText(raw[key]);
            }
        }

        const countMappings = [
            ['faces_detected', 'face'],
            ['face_count', 'face'],
            ['faces', 'face'],
            ['people_detected', 'pessoa'],
            ['person_count', 'pessoa'],
            ['people', 'pessoa'],
            ['text_blocks', 'blocos de texto'],
            ['text_elements', 'elementos de texto'],
            ['text_count', 'elementos de texto'],
            ['text_density', 'densidade de texto'],
            ['buttons', 'botões'],
            ['button_count', 'botões'],
            ['images', 'imagens'],
            ['image_count', 'imagens'],
            ['icons', 'ícones'],
            ['icon_count', 'ícones'],
            ['cards', 'cards'],
            ['card_count', 'cards'],
            ['inputs', 'inputs'],
            ['input_count', 'inputs'],
            ['labels', 'labels'],
            ['label_count', 'labels'],
        ];

        const phrases = [];
        countMappings.forEach(([key, noun]) => {
            const value = raw[key];
            if (value == null) return;
            if (typeof value === 'number' && Number.isFinite(value)) {
                if (key === 'text_density') {
                    const densityValue = value <= 1 ? value * 100 : value;
                    if (densityValue >= 75) {
                        phrases.push('alta densidade de texto');
                    } else if (densityValue >= 40) {
                        phrases.push('densidade de texto moderada');
                    } else {
                        phrases.push('baixa densidade de texto');
                    }
                    return;
                }
                const count = Math.round(value);
                const plural = count === 1 ? noun : `${noun}s`;
                phrases.push(`${count} ${plural} detectados`);
                return;
            }

            if (typeof value === 'string' && value.trim()) {
                const compact = toCompactText(value, 36);
                if (key === 'text_density') {
                    phrases.push(`densidade de texto ${compact}`);
                } else {
                    phrases.push(compact);
                }
            }
        });

        if (phrases.length) {
            return phrases.slice(0, 2).join(' · ');
        }

        const listLike = raw.highlights || raw.items || raw.evidence || raw.details;
        if (Array.isArray(listLike)) {
            return normalizeEvidenceValue(listLike);
        }
    }

    return null;
}

function getRegionConfidence(data, regionKey, fallbackIndex) {
    const raw = getIndexedRegionValue(
        data?.confidence_by_region ?? data?.confidenceByRegion ?? data?.confidence ?? data?.confidence_byRegion,
        regionKey,
        fallbackIndex
    );
    return normalizeConfidenceValue(raw);
}

function getRegionEvidence(data, regionKey, fallbackIndex) {
    const raw = getIndexedRegionValue(
        data?.evidence_by_region ?? data?.evidenceByRegion ?? data?.evidence ?? data?.evidenceByRegion,
        regionKey,
        fallbackIndex
    );
    return normalizeEvidenceValue(raw);
}

function getConfidenceBadgeText(confidence) {
    if (!confidence) return 'n/a';
    if (confidence.text) return confidence.text;
    if (confidence.value != null) return `${Math.round(confidence.value)}%`;
    if (confidence.label) return confidence.label;
    return 'n/a';
}

function getConfidenceLevel(confidence) {
    return confidence?.label || (confidence?.value != null
        ? confidence.value >= 75 ? 'high' : confidence.value >= 45 ? 'medium' : 'low'
        : null);
}

function getDeltaMeta(delta, sideLabel) {
    const value = Number(delta);
    if (!Number.isFinite(value)) {
        return { text: 'Δ --', className: 'neutral', title: `Sem referência para ${sideLabel}` };
    }

    const absValue = Math.abs(value);
    const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
    const colorClass = value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
    return {
        text: `Δ ${sign}${absValue.toFixed(absValue >= 10 ? 0 : 1)}`,
        className: colorClass,
        title: value > 0
            ? `Acima da outra versão em ${absValue.toFixed(1)} pontos`
            : value < 0
                ? `Abaixo da outra versão em ${absValue.toFixed(1)} pontos`
                : 'Sem diferença entre as versões',
    };
}

function buildMetricCardMarkup({
    name,
    tag,
    value,
    level,
    levelText,
    color,
    confidence,
    evidence,
    delta,
    deltaSideLabel,
    valueFontSize = null,
}) {
    const confidenceText = getConfidenceBadgeText(confidence);
    const confidenceLevel = getConfidenceLevel(confidence);
    const evidenceText = evidence ? toCompactText(evidence, 84) : 'Sem evidência extra';
    const evidenceTitle = evidence ? evidence : 'Backend não enviou evidência por região';
    const deltaMeta = delta != null ? getDeltaMeta(delta, deltaSideLabel || 'outra versão') : null;
    const deltaClass = deltaMeta ? ` ${deltaMeta.className}` : '';
    const valueStyle = valueFontSize ? ` style="font-size:${valueFontSize}px"` : '';
    const hasEvidence = Boolean(evidence);

    return `
        <div class="metric-head">
            <div>
                <div class="metric-name">${escapeHtml(name)}</div>
                <div class="metric-region">${escapeHtml(tag)}</div>
            </div>
            ${deltaMeta ? `<div class="metric-delta${deltaClass}" title="${escapeHtml(deltaMeta.title)}">${escapeHtml(deltaMeta.text)}</div>` : ''}
        </div>
        <div class="metric-value-row">
            <span class="metric-value"${valueStyle}>${Number(value).toFixed(0)}</span>
            <span class="metric-unit">/100</span>
        </div>
        <div class="metric-meta-row">
            <span class="metric-confidence ${confidenceLevel ? escapeHtml(confidenceLevel) : 'unset'}" title="Confidence ${escapeHtml(confidenceText)}">
                <span class="metric-meta-label">Confidence</span>
                <span>${escapeHtml(confidenceText)}</span>
            </span>
            <span class="metric-evidence ${hasEvidence ? 'has-data' : 'fallback'}" title="${escapeHtml(evidenceTitle)}">
                <span class="metric-meta-label">Evidence</span>
                <span>${escapeHtml(evidenceText)}</span>
            </span>
        </div>
        <span class="metric-level ${level}">${escapeHtml(levelText)}</span>
        <div class="metric-bar"><div class="metric-bar-fill" style="width:${clamp(Number(value), 0, 100)}%;background:${color}"></div></div>
    `;
}

function setAnalyzeResultMode(enabled) {
    const analyzeView = document.getElementById('viewAnalyze');
    if (analyzeView) analyzeView.classList.toggle('result-mode', Boolean(enabled));
}

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
            document.querySelectorAll('.nav-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
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
                const test = await fetch(gradioUrl + '/config', { mode: 'cors', signal: AbortSignal.timeout(5000) });
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
    const previewVideo = document.getElementById('previewVideo');
    const clearBtn = document.getElementById('clearBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    let previewUrl = null;

    function clearPreviewMedia() {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }
        previewImg.src = '';
        previewImg.style.display = 'none';
        previewVideo.pause();
        previewVideo.removeAttribute('src');
        previewVideo.load();
        previewVideo.style.display = 'none';
    }

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
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
        clearPreviewMedia();
        preview.style.display = 'none';
        zone.style.display = 'flex';
        analyzeBtn.disabled = true;
        setAnalyzeResultMode(false);
    });

    analyzeBtn.addEventListener('click', () => runAnalysis());

    function handleFile(file) {
        if (!file) return;
        clearPreviewMedia();
        currentFile = file;
        zone.style.display = 'none';
        preview.style.display = 'block';
        setAnalyzeResultMode(false);

        previewUrl = URL.createObjectURL(file);
        if (file.type.startsWith('image/')) {
            previewImg.src = previewUrl;
            previewImg.style.display = 'block';
            previewVideo.style.display = 'none';
        } else if (file.type.startsWith('video/')) {
            previewVideo.src = previewUrl;
            previewVideo.style.display = 'block';
            previewImg.style.display = 'none';
            previewVideo.play().catch(() => {});
        } else {
            previewImg.alt = file.name;
        }
        analyzeBtn.disabled = !gradioUrl;
    }
}

// ============================================
// UPLOAD — A/B Test
// ============================================
function initABUpload() {
    const abPreviewUrls = { a: null, b: null };

    function clearABPreviewMedia(side) {
        const preview = document.getElementById(`preview${side.toUpperCase()}`);
        const previewImg = preview.querySelector('.ab-preview-img');
        const previewVideo = preview.querySelector('.ab-preview-video');
        if (abPreviewUrls[side]) {
            URL.revokeObjectURL(abPreviewUrls[side]);
            abPreviewUrls[side] = null;
        }
        previewImg.src = '';
        previewImg.style.display = 'none';
        previewVideo.pause();
        previewVideo.removeAttribute('src');
        previewVideo.load();
        previewVideo.style.display = 'none';
    }

    ['a', 'b'].forEach(side => {
        const zone = document.getElementById(`uploadZone${side.toUpperCase()}`);
        const input = zone.querySelector('.ab-file-input');
        const preview = document.getElementById(`preview${side.toUpperCase()}`);
        const previewImg = preview.querySelector('.ab-preview-img');
        const previewVideo = preview.querySelector('.ab-preview-video');
        const clearBtn = preview.querySelector('.ab-clear');

        zone.addEventListener('click', () => input.click());
        zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
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
            clearABPreviewMedia(side);
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
        const previewVideo = preview.querySelector('.ab-preview-video');
        clearABPreviewMedia(side);

        zone.style.display = 'none';
        preview.style.display = 'block';

        abPreviewUrls[side] = URL.createObjectURL(file);
        if (file.type.startsWith('image/')) {
            previewImg.src = abPreviewUrls[side];
            previewImg.style.display = 'block';
            previewVideo.style.display = 'none';
        } else if (file.type.startsWith('video/')) {
            previewVideo.src = abPreviewUrls[side];
            previewVideo.style.display = 'block';
            previewImg.style.display = 'none';
            previewVideo.play().catch(() => {});
        }
        updateABButton();
    }

    function updateABButton() {
        document.getElementById('abCompareBtn').disabled = !(abFiles.a && abFiles.b && gradioUrl);
    }
}

// ============================================
// API CALL (Gradio v5 SSE protocol)
// ============================================
async function callGradioAPI(file) {
    // 1. Upload file
    const uploadData = new FormData();
    uploadData.append('files', file);
    const uploadRes = await fetch(gradioUrl + '/gradio_api/upload', {
        method: 'POST',
        body: uploadData,
    });
    const uploadJson = await uploadRes.json();
    const filePath = uploadJson[0];

    // 2. Start the call — returns event_id
    const callRes = await fetch(gradioUrl + '/gradio_api/call/analisar_json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            data: [{ path: filePath, orig_name: file.name, size: file.size, mime_type: file.type, meta: { _type: 'gradio.FileData' } }],
        }),
    });
    const { event_id } = await callRes.json();

    // 3. Stream SSE result
    const resultRes = await fetch(gradioUrl + '/gradio_api/call/analisar_json/' + event_id);
    const text = await resultRes.text();

    // Parse SSE: find "event: complete" followed by "data: [...]"
    const lines = text.split('\n');
    let resultData = null;
    let hasError = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === 'event: error') {
            hasError = true;
        }
        if (lines[i].startsWith('data: ')) {
            try {
                const parsed = JSON.parse(lines[i].slice(6));
                if (Array.isArray(parsed)) {
                    resultData = parsed;
                }
            } catch {}
        }
    }

    if (hasError && !resultData) {
        throw new Error('O backend do Colab retornou erro. Verifique se todas as células do notebook foram executadas e a GPU está ativa.');
    }

    if (!resultData) {
        throw new Error('Resposta inválida do servidor.');
    }

    return typeof resultData[0] === 'string' ? JSON.parse(resultData[0]) : resultData[0];
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
        alert(err.message || 'Erro ao conectar com o servidor.');
    } finally {
        hideLoading();
    }
}

function displayResults(data) {
    setAnalyzeResultMode(true);

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
        const val = getScoreForRegion(scores, r.key, i);
        const confidence = getRegionConfidence(data, r.key, i);
        const evidence = getRegionEvidence(data, r.key, i);
        const level = val >= 65 ? 'high' : val >= 40 ? 'medium' : 'low';
        const levelText = val >= 65 ? 'High' : val >= 40 ? 'Medium' : 'Low';
        const color = val >= 65 ? '#5CA9FF' : val >= 40 ? '#F4B23E' : '#6480AB';

        const card = document.createElement('div');
        card.className = `metric-card level-${level}`;
        card.innerHTML = buildMetricCardMarkup({
            name: r.name,
            tag: r.tag,
            value: val,
            level,
            levelText,
            color,
            confidence,
            evidence,
        });
        card.addEventListener('click', () => {
            document.querySelectorAll('.metric-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            isolateBrainRegion(brainScene, i);
            document.getElementById('brainRegionLabel').textContent = `${r.tag} — ${r.desc}`;
        });
        grid.appendChild(card);
    });

    // UX Score
    const allVals = getAllRegionScores(scores);
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
        displayABResults('a', resultA);
        displayABResults('b', resultB);

        displayABComparison(resultA, resultB);
    } catch (err) {
        console.error(err);
        alert(err.message || 'Erro ao conectar com o servidor.');
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
        const val = getScoreForRegion(scores, r.key, i);
        const confidence = getRegionConfidence(data, r.key, i);
        const evidence = getRegionEvidence(data, r.key, i);
        const level = val >= 65 ? 'high' : val >= 40 ? 'medium' : 'low';
        const color = val >= 65 ? '#5CA9FF' : val >= 40 ? '#F4B23E' : '#6480AB';
        const otherScores = side === 'a' ? abResults.b?.scores : abResults.a?.scores;
        const compareVal = otherScores ? val - getScoreForRegion(otherScores, r.key, i) : null;
        const card = document.createElement('div');
        card.className = `metric-card level-${level}`;
        card.innerHTML = buildMetricCardMarkup({
            name: r.name,
            tag: r.tag,
            value: val,
            level,
            levelText: level === 'high' ? 'High' : level === 'medium' ? 'Medium' : 'Low',
            color,
            confidence,
            evidence,
            delta: compareVal,
            deltaSideLabel: side === 'a' ? 'B' : 'A',
            valueFontSize: 24,
        });
        card.addEventListener('click', () => {
            if (scene) isolateBrainRegion(scene, i);
            const label = document.querySelector(`.ab-region-label[data-side="${side}"]`);
            if (label) label.textContent = `${r.tag} — ${r.name}`;
        });
        grid.appendChild(card);
    });

    // Score
    const allVals = getAllRegionScores(scores);
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
    grid.innerHTML = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px"><span style="color:var(--accent);font-weight:600">A</span> vs <span style="color:#63d5ff;font-weight:600">B</span></div><div></div>';

    REGIONS.forEach((r, i) => {
        const valA = getScoreForRegion(a.scores, r.key, i);
        const valB = getScoreForRegion(b.scores, r.key, i);
        const diff = valA - valB;
        const deltaClass = diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral';
        const absDiff = Math.abs(diff);
        const deltaText = diff > 0 ? `+${absDiff.toFixed(absDiff >= 10 ? 0 : 1)}` : diff < 0 ? `−${absDiff.toFixed(absDiff >= 10 ? 0 : 1)}` : '±0';
        const item = document.createElement('div');
        item.className = `ab-comparison-item ${deltaClass}`;
        item.innerHTML = `
            <span class="region-name">${r.name} (${r.tag})</span>
            <span class="scores">
                <span class="score-a">${valA.toFixed(0)}</span>
                <span class="ab-delta-badge ${deltaClass}" title="Delta A-B">${deltaText}</span>
                <span class="score-b">${valB.toFixed(0)}</span>
            </span>
        `;
        grid.appendChild(item);
    });

    // Overall comparison
    const valsA = getAllRegionScores(a.scores);
    const valsB = getAllRegionScores(b.scores);
    const avgA = valsA.reduce((x, y) => x + y, 0) / valsA.length;
    const avgB = valsB.reduce((x, y) => x + y, 0) / valsB.length;
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
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mobileViewport = window.matchMedia('(max-width: 768px)').matches;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040812);
    scene.fog = new THREE.FogExp2(0x040812, 0.08);

    // Camera
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    camera.position.set(0, 0.86, 4.2);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobileViewport ? 1.45 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;

    // Post-processing
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.72, 0.58, 0.16);
    composer.addPass(bloomPass);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = 2.45;
    controls.maxDistance = 6.2;
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = 0.28;
    controls.maxPolarAngle = Math.PI * 0.75;
    controls.minPolarAngle = Math.PI * 0.2;

    // Lights
    const ambient = new THREE.AmbientLight(0x5f7bb2, 0.85);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xc7dcff, 1.4);
    keyLight.position.set(2, 5, 3);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x5fd0f4, 0.56);
    fillLight.position.set(-4, 1, -2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x4a82ff, 0.34);
    rimLight.position.set(0, -2, -4);
    scene.add(rimLight);

    const bottomLight = new THREE.DirectionalLight(0x25395f, 0.35);
    bottomLight.position.set(0, -4, 0);
    scene.add(bottomLight);

    // Subtle point light that follows camera for specular highlights
    const cameraLight = new THREE.PointLight(0xffffff, 0.38, 10);
    scene.add(cameraLight);

    // Build brain
    const brainGroup = new THREE.Group();
    scene.add(brainGroup);

    // Hemispheres
    const brainMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xaeb8cd,
        transparent: true,
        opacity: 0.82,
        roughness: 0.62,
        metalness: 0.0,
        clearcoat: 0.34,
        clearcoatRoughness: 0.22,
        side: THREE.FrontSide,
    });

    const leftHemi = createHemisphere(-1);
    leftHemi.material = brainMaterial.clone();
    brainGroup.add(leftHemi);

    const rightHemi = createHemisphere(1);
    rightHemi.material = brainMaterial.clone();
    brainGroup.add(rightHemi);

    // Subtle sulci darkening via wireframe
    const wireMatL = new THREE.MeshBasicMaterial({ color: 0x85a8e0, wireframe: true, transparent: true, opacity: 0.045 });
    const wireL = new THREE.Mesh(leftHemi.geometry.clone(), wireMatL);
    wireL.position.copy(leftHemi.position);
    brainGroup.add(wireL);

    const wireR = new THREE.Mesh(rightHemi.geometry.clone(), wireMatL.clone());
    wireR.position.copy(rightHemi.position);
    brainGroup.add(wireR);

    // Region hotspots
    const hotspots = [];
    const hotspotGroup = new THREE.Group();
    brainGroup.add(hotspotGroup);

    // Neural connections group
    const connectionsGroup = new THREE.Group();
    brainGroup.add(connectionsGroup);

    REGIONS.forEach((r, i) => {
        // Core sphere
        const geo = new THREE.SphereGeometry(0.15, 32, 32);
        const mat = new THREE.MeshPhysicalMaterial({
            color: 0x6b8fc9,
            emissive: 0x6b8fc9,
            emissiveIntensity: 0.3,
            transparent: true,
            opacity: 0.75,
            roughness: 0.3,
            metalness: 0.2,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(r.pos[0], r.pos[1], r.pos[2]);
        mesh.userData = { regionIndex: i, region: r, baseScale: 1 };
        hotspotGroup.add(mesh);
        hotspots.push(mesh);

        // Inner glow — renders on top of brain
        const glowGeo = new THREE.SphereGeometry(0.25, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0x6b8fc9,
            transparent: true,
            opacity: 0.06,
            depthTest: false,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.copy(mesh.position);
        glow.renderOrder = 1;
        hotspotGroup.add(glow);

        // Outer halo ring
        const ringGeo = new THREE.RingGeometry(0.22, 0.28, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x6b8fc9,
            transparent: true,
            opacity: 0.0,
            side: THREE.DoubleSide,
            depthTest: false,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(mesh.position);
        ring.renderOrder = 1;
        hotspotGroup.add(ring);

        mesh.userData.glow = glow;
        mesh.userData.ring = ring;
    });

    // Create neural connections between nearby regions
    const connectionLines = [];
    for (let i = 0; i < REGIONS.length; i++) {
        for (let j = i + 1; j < REGIONS.length; j++) {
            const pi = new THREE.Vector3(...REGIONS[i].pos);
            const pj = new THREE.Vector3(...REGIONS[j].pos);
            const dist = pi.distanceTo(pj);
            if (dist < 2.0) {
                // Create curved connection
                const mid = new THREE.Vector3().addVectors(pi, pj).multiplyScalar(0.5);
                mid.y += dist * 0.15; // slight arc upward
                const curve = new THREE.QuadraticBezierCurve3(pi, mid, pj);
                const points = curve.getPoints(20);
                const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
                const lineMat = new THREE.LineBasicMaterial({
                    color: 0x3e5d8f,
                    transparent: true,
                    opacity: 0.09,
                });
                const line = new THREE.Line(lineGeo, lineMat);
                connectionsGroup.add(line);
                connectionLines.push({ line, i, j, baseDist: dist });
            }
        }
    }

    // Floating particles around brain
    const particleCount = mobileViewport ? 94 : 150;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCount * 3);
    const particleSpeeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const radius = 1.45 + Math.random() * 1.4;
        particlePos[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        particlePos[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * 0.8;
        particlePos[i * 3 + 2] = radius * Math.cos(phi) * 1.1;
        particleSpeeds[i] = 0.18 + Math.random() * 0.58;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    const particleMat = new THREE.PointsMaterial({
        color: 0x9bc3ff,
        size: 0.018,
        transparent: true,
        opacity: 0.38,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    brainGroup.add(particles);

    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    container.addEventListener('pointermove', e => {
        const rect = container.getBoundingClientRect();
        pointer.targetX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.targetY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    });
    container.addEventListener('pointerleave', () => {
        pointer.targetX = 0;
        pointer.targetY = 0;
    });

    // Raycaster for click
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let pointerDown = null;

    canvas.addEventListener('pointerdown', e => {
        pointerDown = { x: e.clientX, y: e.clientY, ts: performance.now() };
    });

    canvas.addEventListener('dblclick', e => {
        // Prevent browser double-click zoom behavior on some devices.
        e.preventDefault();
    });

    canvas.addEventListener('click', (e) => {
        if (pointerDown) {
            const dist = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
            const elapsed = performance.now() - pointerDown.ts;
            pointerDown = null;
            if (dist > 6 || elapsed > 450) {
                return;
            }
        }

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
        } else if (sceneData.lastScores) {
            // Click outside hotspots resets focus visuals.
            updateBrainActivation(sceneData, sceneData.lastScores);
            const label = container.closest('.card')?.querySelector('.card-badge')
                || document.getElementById('brainRegionLabel');
            if (label) label.textContent = 'Select a region';
            const metricCards = container.closest('.view')?.querySelectorAll('.metric-card') || [];
            metricCards.forEach(c => c.classList.remove('active'));
        }
    });

    // Resize
    const resizeObserver = new ResizeObserver(() => {
        const w = Math.max(1, container.clientWidth);
        const h = Math.max(1, container.clientHeight);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        composer.setSize(w, h);
        bloomPass.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.matchMedia('(max-width: 768px)').matches ? 1.45 : 2));
    });
    resizeObserver.observe(container);

    // Animate
    function animate() {
        requestAnimationFrame(animate);

        const t = performance.now() * 0.001;
        pointer.x += (pointer.targetX - pointer.x) * 0.065;
        pointer.y += (pointer.targetY - pointer.y) * 0.065;

        if (!reducedMotion) {
            brainGroup.rotation.y += 0.0014;
            brainGroup.rotation.x = pointer.y * 0.14;
            brainGroup.position.x = pointer.x * 0.14;
            brainGroup.position.y = pointer.y * 0.03;
        }

        controls.update();

        // Camera light follows camera
        cameraLight.position.copy(camera.position);

        // Pulse hotspots
        hotspots.forEach((hs, i) => {
            const intensity = hs.userData.activation || 0;
            if (intensity > 0) {
                const pulse = 1 + Math.sin(t * 2.5 + i * 0.7) * 0.1 * intensity;
                const baseScale = hs.userData.baseScale || 1;
                hs.scale.setScalar(baseScale * pulse);
                if (hs.userData.glow) {
                    hs.userData.glow.scale.setScalar(baseScale * pulse * 1.6);
                    hs.userData.glow.material.opacity = 0.04 + Math.sin(t * 1.8 + i) * 0.04 * intensity;
                }
                if (hs.userData.ring) {
                    hs.userData.ring.lookAt(camera.position);
                    hs.userData.ring.material.opacity = 0.05 + Math.sin(t * 1.2 + i * 0.5) * 0.05 * intensity;
                    hs.userData.ring.scale.setScalar(baseScale * (1 + Math.sin(t * 1.5 + i) * 0.15 * intensity));
                }
            }
        });

        // Animate neural connections based on activation
        connectionLines.forEach(({ line, i, j }) => {
            const actI = hotspots[i]?.userData.activation || 0;
            const actJ = hotspots[j]?.userData.activation || 0;
            const avgAct = (actI + actJ) / 2;
            if (avgAct > 0) {
                const pulse = 0.035 + avgAct * 0.22 + Math.sin(t * 2.6 + i + j) * 0.03 * avgAct;
                line.material.opacity = pulse;
                const col = avgAct > 0.5 ? 0x5ca9ff : 0x4b6593;
                line.material.color.setHex(col);
            } else {
                line.material.opacity = 0.04;
            }
        });

        // Rotate particles slowly
        const positions = particles.geometry.attributes.position;
        const posArray = positions.array;
        for (let i = 0; i < particleCount; i++) {
            const ii = i * 3;
            const x = posArray[ii];
            const z = posArray[ii + 2];
            const speed = particleSpeeds[i] * 0.0035;
            const cos = Math.cos(speed);
            const sin = Math.sin(speed);
            posArray[ii] = x * cos - z * sin;
            posArray[ii + 2] = x * sin + z * cos;
        }
        positions.needsUpdate = true;

        composer.render();
    }
    animate();

    const sceneData = {
        scene,
        camera,
        renderer,
        composer,
        bloomPass,
        controls,
        brainGroup,
        hotspots,
        hotspotGroup,
        leftHemi,
        rightHemi,
        connectionLines,
        particles,
    };
    return sceneData;
}

function createHemisphere(side) {
    const geo = new THREE.SphereGeometry(1, 80, 80);
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

        // Brain shape: elongate front-back, flatten top, widen temporal
        z *= 1.3;
        y *= 0.9;
        // Temporal lobe bulge
        const temporal = Math.exp(-((y + 0.3) * (y + 0.3)) / 0.3) * 0.08 * Math.abs(x);
        x += (x > 0 ? 1 : -1) * temporal;

        // Cortical folds — more complex noise for realistic sulci
        const n = Math.sin(x * 8) * Math.cos(y * 6) * Math.sin(z * 7) * 0.05
                + Math.sin(x * 15 + y * 12) * 0.025
                + Math.cos(z * 18 + x * 10) * 0.018
                + Math.sin(x * 25 + z * 20 + y * 15) * 0.012
                + Math.cos(y * 22 + x * 18) * 0.01;

        // Sylvian fissure — horizontal groove on side
        const sylvian = Math.exp(-((y - 0.05) * (y - 0.05)) / 0.02) * Math.abs(x) * -0.04;

        // Central sulcus — vertical groove on top
        const central = Math.exp(-((z + 0.1) * (z + 0.1)) / 0.04) * Math.max(0, y) * -0.03;

        const r = Math.sqrt(x * x + y * y + z * z);
        if (r > 0) {
            const totalDisp = n + sylvian + central;
            x += (x / r) * totalDisp;
            y += (y / r) * totalDisp;
            z += (z / r) * totalDisp;
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
    sceneData.lastScores = scores;

    sceneData.hotspots.forEach((hs, i) => {
        const val = getScoreForRegion(scores, REGIONS[i].key, i);
        const norm = val / 100;
        hs.userData.activation = norm;

        // Color: low=steel blue, medium=amber, high=cyan-blue
        let color;
        if (val >= 65) {
            const t = (val - 65) / 35;
            color = new THREE.Color().lerpColors(new THREE.Color(0x5ca9ff), new THREE.Color(0x63d5ff), t);
        } else if (val >= 40) {
            const t = (val - 40) / 25;
            color = new THREE.Color().lerpColors(new THREE.Color(0xf4b23e), new THREE.Color(0x5ca9ff), t);
        } else {
            const t = val / 40;
            color = new THREE.Color().lerpColors(new THREE.Color(0x5a7094), new THREE.Color(0xf4b23e), t);
        }

        hs.material.color.copy(color);
        hs.material.emissive.copy(color);
        hs.material.emissiveIntensity = 0.4 + norm * 0.8;
        hs.material.opacity = 0.6 + norm * 0.4;

        // Size based on activation
        const scale = 0.8 + norm * 0.7;
        hs.userData.baseScale = scale;
        hs.scale.setScalar(scale);

        // Glow
        if (hs.userData.glow) {
            hs.userData.glow.material.color.copy(color);
            hs.userData.glow.material.opacity = 0.04 + norm * 0.18;
            hs.userData.glow.scale.setScalar(scale * 1.7);
        }

        // Ring halo
        if (hs.userData.ring) {
            hs.userData.ring.material.color.copy(color);
            hs.userData.ring.material.opacity = norm > 0.5 ? 0.15 : 0;
        }
    });

    // Make brain shell semi-transparent when activated so hotspots are visible inside
    const allVals = getAllRegionScores(scores);
    const avgActivation = (allVals.reduce((a, b) => a + b, 0) / allVals.length) / 100;
    sceneData.leftHemi.material.transparent = true;
    sceneData.rightHemi.material.transparent = true;
    const shellOpacity = 0.75 - avgActivation * 0.2;
    sceneData.leftHemi.material.opacity = shellOpacity;
    sceneData.rightHemi.material.opacity = shellOpacity;

    if (sceneData.bloomPass) {
        sceneData.bloomPass.strength = 0.58 + avgActivation * 0.52;
    }

    // Particles react to activation
    if (sceneData.particles) {
        sceneData.particles.material.opacity = 0.2 + avgActivation * 0.5;
        sceneData.particles.material.size = 0.015 + avgActivation * 0.02;
    }
}

function isolateBrainRegion(sceneData, activeIndex) {
    if (!sceneData) return;

    sceneData.hotspots.forEach((hs, i) => {
        const activation = hs.userData.activation || 0;
        const baseScale = 0.8 + activation * 0.7;
        const baseOpacity = 0.6 + activation * 0.4;
        if (i === activeIndex) {
            // Subtle highlight only (no aggressive isolate zoom effect).
            hs.material.opacity = Math.min(1, baseOpacity + 0.1);
            hs.material.emissiveIntensity = Math.max(0.9, 0.55 + activation * 1.1);
            const scale = baseScale * 1.08;
            hs.userData.baseScale = scale;
            hs.scale.setScalar(scale);
            if (hs.userData.glow) {
                hs.userData.glow.material.opacity = 0.14 + activation * 0.18;
                hs.userData.glow.scale.setScalar(scale * 1.85);
            }
            if (hs.userData.ring) {
                hs.userData.ring.material.opacity = 0.18;
                hs.userData.ring.scale.setScalar(scale * 1.35);
            }
        } else {
            // Keep context visible, only lightly de-emphasize.
            hs.material.opacity = Math.max(0.5, baseOpacity - 0.15);
            hs.material.emissiveIntensity = Math.max(0.28, 0.32 + activation * 0.55);
            hs.scale.setScalar(baseScale);
            hs.userData.baseScale = baseScale;
            if (hs.userData.glow) {
                hs.userData.glow.material.opacity = 0.02 + activation * 0.06;
                hs.userData.glow.scale.setScalar(baseScale * 1.5);
            }
            if (hs.userData.ring) {
                hs.userData.ring.material.opacity = 0.03;
                hs.userData.ring.scale.setScalar(baseScale * 1.15);
            }
        }
    });

    // Highlight connections to selected region
    if (sceneData.connectionLines) {
        sceneData.connectionLines.forEach(({ line, i, j }) => {
            if (i === activeIndex || j === activeIndex) {
                line.material.opacity = 0.2;
                line.material.color.setHex(0x63d5ff);
            } else {
                line.material.opacity = 0.05;
                line.material.color.setHex(0x334c73);
            }
        });
    }
}

// ============================================
// HELPERS
// ============================================
function formatReport(text) {
    if (!text) return '';

    // Section icons mapping
    const sectionIcons = {
        'DIAGNÓSTICO GERAL': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
        'DIAGNOSTICO GERAL': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
        'PONTOS FORTES': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,
        'PONTOS DE ATENÇÃO': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
        'PONTOS DE ATENCAO': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
        'RECOMENDAÇÕES DE UX': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
        'RECOMENDACOES DE UX': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>`,
        'SCORE GERAL': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>`,
    };

    const sectionColors = {
        'DIAGNÓSTICO GERAL': 'var(--accent)',
        'DIAGNOSTICO GERAL': 'var(--accent)',
        'PONTOS FORTES': '#34a853',
        'PONTOS DE ATENÇÃO': '#EF9F27',
        'PONTOS DE ATENCAO': '#EF9F27',
        'RECOMENDAÇÕES DE UX': '#63d5ff',
        'RECOMENDACOES DE UX': '#63d5ff',
        'SCORE GERAL': 'var(--accent)',
    };

    // Split into sections by ## headings
    const sections = text.split(/^## /m).filter(Boolean);

    // Build nav tabs
    const nav = document.getElementById('reportNav');
    if (nav) {
        nav.innerHTML = '';
    }

    let html = '';
    const navItems = [];

    sections.forEach((section, idx) => {
        const lines = section.split('\n');
        const title = lines[0].trim();
        const body = lines.slice(1).join('\n').trim();
        const sectionId = `report-section-${idx}`;

        // Find matching icon
        const iconKey = Object.keys(sectionIcons).find(k => title.toUpperCase().includes(k));
        const icon = iconKey ? sectionIcons[iconKey] : '';
        const color = iconKey ? sectionColors[iconKey] : 'var(--text-secondary)';

        // Nav item
        navItems.push({ title: title.replace(/[*#]/g, '').trim(), sectionId, color });

        // Format body content
        let formattedBody = body
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/^\s*(\d+)\.\s+/gm, '<span class="report-list-num">$1</span> ')
            .replace(/^\s*[-•]\s+/gm, '<span class="report-list-bullet"></span> ')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');

        formattedBody = '<p>' + formattedBody + '</p>';

        html += `
            <div class="report-section" id="${sectionId}">
                <div class="report-section-header" style="--section-color: ${color}">
                    <span class="report-section-icon" style="color: ${color}">${icon}</span>
                    <h3>${title.replace(/[*#]/g, '').trim()}</h3>
                </div>
                <div class="report-section-body">${formattedBody}</div>
            </div>
        `;
    });

    // Build nav
    if (nav && navItems.length > 1) {
        nav.innerHTML = navItems.map(({ title, sectionId, color }) =>
            `<button class="report-nav-btn" onclick="document.getElementById('${sectionId}').scrollIntoView({behavior:'smooth',block:'nearest'})" style="--nav-color: ${color}">
                ${title.split(' ').slice(0, 2).join(' ')}
            </button>`
        ).join('');
    }

    return html;
}

function showLoading(msg) {
    document.getElementById('loadingText').textContent = msg;
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}
