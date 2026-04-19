import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================
// CONFIG
// ============================================
const GIST_ID = '397ef638ef931f3ace318e891a741312';

const REGIONS = [
    { key: 'v1',       name: 'Visual primario',      tag: 'V1',    pos: [0, 0.1, -1.15],   desc: 'Cortex visual primario — processa features visuais basicas' },
    { key: 'ffa',      name: 'Faces / avatares',     tag: 'FFA',   pos: [-1.05, -0.1, -0.4], desc: 'Area fusiforme facial — reconhecimento e processamento de faces' },
    { key: 'ppa',      name: 'Layouts / cenas',      tag: 'PPA',   pos: [1.05, -0.1, -0.4],  desc: 'Area parahipocampal — percepcao de layout espacial' },
    { key: 'v5',       name: 'Movimento / animacao',  tag: 'V5',    pos: [-1.0, 0.3, -0.7],  desc: 'Area de movimento visual — elementos dinamicos e animacoes' },
    { key: 'ips',      name: 'Atencao visual',       tag: 'IPS',   pos: [0, 0.9, -0.3],     desc: 'Sulco intraparietal — atencao e foco visual' },
    { key: 'broca',    name: 'Texto / labels',        tag: 'Broca', pos: [-0.9, 0.2, 0.65],  desc: 'Area de Broca — processamento de linguagem e texto' },
    { key: 'pfc',      name: 'Decisao / memoria',     tag: 'PFC',   pos: [0, 0.5, 1.05],     desc: 'Cortex pre-frontal — tomada de decisao e memoria de trabalho' },
    { key: 'semantic', name: 'Semantica / contexto',  tag: 'SEM',   pos: [0.9, 0.0, 0.3],    desc: 'Processamento semantico — compreensao de significado e contexto' },
];

const CONTEXT_LABELS = {
    generic: 'Genérico',
    banking: 'Banking / Fintech',
    ecommerce: 'E-commerce',
    gaming: 'Gaming / Entretenimento',
    content: 'Content / News',
    saas: 'SaaS / Produtividade',
    social: 'Social Media',
    health: 'Saúde / Health',
};

const REGION_ACTIONS = {
    v1: 'Aumente o contraste global e reduza o ruído visual do perdedor para igualar a clareza do vencedor.',
    ffa: 'Adicione rostos/elementos humanos no perdedor — o vencedor capturou mais conexão facial.',
    ppa: 'Reorganize o layout do perdedor em blocos mais definidos; o vencedor tem agrupamento mais legível.',
    v5: 'Insira micro-movimentos intencionais no perdedor (transições de CTA, feedback) para alcançar o V5 do vencedor.',
    ips: 'Fortaleça o foco no elemento principal do perdedor; o vencedor direciona melhor a atenção visual.',
    broca: 'Simplifique os textos e torne o CTA mais explícito no perdedor; o vencedor tem linguagem mais direta.',
    pfc: 'Reduza passos e ambiguidade no caminho de decisão do perdedor — o vencedor converte com menos fricção.',
    semantic: 'Reforce labels e pistas de contexto no perdedor; o vencedor comunica o propósito com mais clareza.',
};

// ============================================
// STATE
// ============================================
let gradioUrl = null;
let gradioReachable = false;
let currentFile = null;
let abFiles = { a: null, b: null };
let abResults = { a: null, b: null };
let brainScene = null;
let abBrainScenes = { a: null, b: null };

function isGradioReady() {
    return Boolean(gradioUrl && gradioReachable);
}

function updateActionButtonsState() {
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) {
        analyzeBtn.disabled = !(currentFile && isGradioReady());
    }

    const abCompareBtn = document.getElementById('abCompareBtn');
    if (abCompareBtn) {
        abCompareBtn.disabled = !(abFiles.a && abFiles.b && isGradioReady());
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const inheritedSignal = options.signal;

    if (inheritedSignal) {
        if (inheritedSignal.aborted) {
            controller.abort(inheritedSignal.reason);
        } else {
            inheritedSignal.addEventListener('abort', () => controller.abort(inheritedSignal.reason), { once: true });
        }
    }

    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

function buildNetworkErrorMessage(url, error) {
    if (error?.name === 'AbortError') {
        return `Tempo esgotado ao conectar com o servidor (${url}). Verifique se o link público do Colab ainda está ativo.`;
    }

    let mixedContentHint = '';
    try {
        const pageProtocol = window.location?.protocol;
        const targetProtocol = new URL(url).protocol;
        if (pageProtocol === 'https:' && targetProtocol === 'http:') {
            mixedContentHint = ' A página está em HTTPS e o backend em HTTP (mixed content).';
        }
    } catch {}

    return `Falha de rede ao acessar o servidor (${url}). Verifique se o Gradio está online, se a URL no Gist é válida e se o CORS está liberado.${mixedContentHint}`;
}

async function fetchOrThrowNetwork(url, options = {}, timeoutMs = 30000) {
    try {
        return await fetchWithTimeout(url, options, timeoutMs);
    } catch (error) {
        throw new Error(buildNetworkErrorMessage(url, error));
    }
}

async function readResponseSnippet(response, maxLength = 280) {
    try {
        const body = await response.text();
        return body ? body.slice(0, maxLength) : 'sem detalhes';
    } catch {
        return 'sem detalhes';
    }
}

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

function getRegionEvidenceRaw(data, regionKey, fallbackIndex) {
    return getIndexedRegionValue(
        data?.evidence_by_region ?? data?.evidenceByRegion ?? data?.evidence ?? data?.evidenceByRegion,
        regionKey,
        fallbackIndex
    );
}

function getRegionEvidence(data, regionKey, fallbackIndex) {
    return normalizeEvidenceValue(getRegionEvidenceRaw(data, regionKey, fallbackIndex));
}

function normalizeEvidenceSignal(signal) {
    if (!signal || typeof signal !== 'object') return null;
    const name = typeof signal.name === 'string' ? signal.name.trim() : '';
    if (!name) return null;
    const value = Number(signal.value);
    const weight = Number(signal.weight);
    const direction = typeof signal.direction === 'string' ? signal.direction.toLowerCase() : null;
    return {
        name,
        value: Number.isFinite(value) ? value : null,
        weight: Number.isFinite(weight) ? weight : null,
        direction: direction === 'positive' || direction === 'negative' ? direction : null,
    };
}

function getRegionEvidenceDetails(data, regionKey, fallbackIndex) {
    const raw = getRegionEvidenceRaw(data, regionKey, fallbackIndex);
    const compact = normalizeEvidenceValue(raw);
    const details = {
        summary: null,
        compact,
        primarySignals: [],
        supportingSignals: [],
        hasDetails: false,
    };
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        if (typeof raw.summary === 'string' && raw.summary.trim()) {
            details.summary = raw.summary.trim();
        }
        if (Array.isArray(raw.primary_signals)) {
            details.primarySignals = raw.primary_signals.map(normalizeEvidenceSignal).filter(Boolean);
        }
        if (Array.isArray(raw.supporting_signals)) {
            details.supportingSignals = raw.supporting_signals.map(normalizeEvidenceSignal).filter(Boolean);
        }
    }
    details.hasDetails = Boolean(
        details.summary || details.primarySignals.length || details.supportingSignals.length
    );
    return details;
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

function normalizeContextKey(rawContext) {
    const key = String(rawContext || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(CONTEXT_LABELS, key) ? key : 'generic';
}

function getContextLabel(rawContext) {
    return CONTEXT_LABELS[normalizeContextKey(rawContext)] || CONTEXT_LABELS.generic;
}

function initContextSelectors() {
    const analyzeSelect = document.getElementById('contextSelectAnalyze');
    const abSelect = document.getElementById('contextSelectAB');
    if (!analyzeSelect && !abSelect) return;

    const syncValue = value => {
        const normalized = normalizeContextKey(value);
        if (analyzeSelect && analyzeSelect.value !== normalized) analyzeSelect.value = normalized;
        if (abSelect && abSelect.value !== normalized) abSelect.value = normalized;
    };

    if (analyzeSelect) {
        analyzeSelect.addEventListener('change', () => syncValue(analyzeSelect.value));
    }
    if (abSelect) {
        abSelect.addEventListener('change', () => syncValue(abSelect.value));
    }

    syncValue(analyzeSelect?.value || abSelect?.value || 'generic');
}

function getSelectedContextKey() {
    const analyzeView = document.getElementById('viewAnalyze');
    const abView = document.getElementById('viewAbTest');
    const analyzeActive = analyzeView?.classList.contains('active');
    const abActive = abView?.classList.contains('active');
    const analyzeSelect = document.getElementById('contextSelectAnalyze');
    const abSelect = document.getElementById('contextSelectAB');

    if (abActive && abSelect) {
        return normalizeContextKey(abSelect.value);
    }
    if (analyzeActive && analyzeSelect) {
        return normalizeContextKey(analyzeSelect.value);
    }
    return normalizeContextKey(analyzeSelect?.value || abSelect?.value || 'generic');
}

function getResultUXScore(data) {
    const fromPayload = Number(data?.ux_score);
    const baseScore = Number(data?.base_ux_score);
    const vals = getAllRegionScores(data?.scores || {});
    const regionalAvg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    if (Number.isFinite(fromPayload) && fromPayload > 0) return clamp(fromPayload, 0, 100);
    if (Number.isFinite(baseScore) && baseScore > 0) return clamp(baseScore, 0, 100);
    if (regionalAvg > 0) return clamp(regionalAvg, 0, 100);
    return Number.isFinite(fromPayload) ? clamp(fromPayload, 0, 100) : 0;
}

function formatSignedDelta(value, decimals = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    const absValue = Math.abs(numeric);
    const precision = Number.isInteger(decimals) ? Math.max(0, decimals) : 1;
    const sign = numeric > 0 ? '+' : numeric < 0 ? '−' : '±';
    return `${sign}${absValue.toFixed(precision)}`;
}

function getABComparisonRowState(valA, valB) {
    const diff = Number(valA) - Number(valB);
    const absDiff = Math.abs(diff);
    const status = absDiff < 0.5 ? 'tie' : diff > 0 ? 'a' : 'b';
    const statusLabel = status === 'a' ? 'A melhor' : status === 'b' ? 'B melhor' : 'Empate';
    const statusClass = status === 'a' ? 'winner-a status-a' : status === 'b' ? 'winner-b status-b' : 'neutral status-tie';
    const deltaMeta = getDeltaMeta(diff, status === 'a' ? 'B' : 'A');

    return {
        diff,
        absDiff,
        status,
        statusLabel,
        statusClass,
        deltaMeta,
    };
}

function buildABComparisonSnapshot(a, b) {
    const rows = REGIONS.map((region, index) => {
        const valA = getScoreForRegion(a?.scores || {}, region.key, index);
        const valB = getScoreForRegion(b?.scores || {}, region.key, index);
        return {
            region,
            valA,
            valB,
            ...getABComparisonRowState(valA, valB),
        };
    });

    let aWins = 0;
    let bWins = 0;
    let ties = 0;
    let strongestA = null;
    let strongestB = null;

    rows.forEach(row => {
        if (row.status === 'a') {
            aWins += 1;
            if (!strongestA || row.diff > strongestA.diff) strongestA = row;
        } else if (row.status === 'b') {
            bWins += 1;
            if (!strongestB || row.diff < strongestB.diff) strongestB = row;
        } else {
            ties += 1;
        }
    });

    const avgA = getResultUXScore(a);
    const avgB = getResultUXScore(b);
    const overallDiff = avgA - avgB;
    const overallWinner = overallDiff > 0 ? 'a' : overallDiff < 0 ? 'b' : 'tie';
    const overallLabel = overallWinner === 'a' ? 'A melhor' : overallWinner === 'b' ? 'B melhor' : 'Empate';

    return {
        rows,
        aWins,
        bWins,
        ties,
        strongestA,
        strongestB,
        avgA,
        avgB,
        overallDiff,
        overallWinner,
        overallLabel,
    };
}

function buildABComparisonSummaryMarkup(snapshot, contextLabel) {
    const summaryToneClass = snapshot.overallWinner === 'a' ? 'winner-a' : snapshot.overallWinner === 'b' ? 'winner-b' : 'neutral';
    const winnerText = snapshot.overallWinner === 'tie'
        ? 'Empate técnico'
        : snapshot.overallLabel;
    const winnerDetail = snapshot.overallWinner === 'tie'
        ? 'As duas versões ficaram muito próximas no score global.'
        : `Vantagem de ${formatSignedDelta(snapshot.overallDiff, 1)} no score global.`;
    const strongestA = snapshot.strongestA
        ? `${snapshot.strongestA.region.tag} · ${snapshot.strongestA.region.name} (${formatSignedDelta(snapshot.strongestA.diff, snapshot.strongestA.absDiff >= 10 ? 0 : 1)})`
        : 'Sem vantagem clara';
    const strongestB = snapshot.strongestB
        ? `${snapshot.strongestB.region.tag} · ${snapshot.strongestB.region.name} (${formatSignedDelta(Math.abs(snapshot.strongestB.diff), snapshot.strongestB.absDiff >= 10 ? 0 : 1)})`
        : 'Sem vantagem clara';

    return `
        <div class="ab-comparison-summary">
            <div class="ab-comparison-summary-head">
                <div>
                    <h3>Leitura rápida</h3>
                    <p class="ab-comparison-summary-lead">${escapeHtml(winnerDetail)}</p>
                </div>
                <span class="ab-comparison-summary-context">${escapeHtml(contextLabel)}</span>
            </div>
            <div class="ab-comparison-summary-grid">
                <article class="ab-comparison-summary-card ${summaryToneClass}">
                    <span class="ab-comparison-summary-label">Visão global</span>
                    <strong>${escapeHtml(winnerText)}</strong>
                    <p>A ${snapshot.avgA.toFixed(0)} · B ${snapshot.avgB.toFixed(0)}</p>
                </article>
                <article class="ab-comparison-summary-card">
                    <span class="ab-comparison-summary-label">Ganhos por região</span>
                    <strong>A ${snapshot.aWins} · B ${snapshot.bWins} · Empates ${snapshot.ties}</strong>
                    <p>Resumo direto dos vencedores por eixo comparado.</p>
                </article>
                <article class="ab-comparison-summary-card">
                    <span class="ab-comparison-summary-label">Maior ganho de A</span>
                    <strong>${escapeHtml(strongestA)}</strong>
                    <p>Maior perda de B nessa linha.</p>
                </article>
                <article class="ab-comparison-summary-card">
                    <span class="ab-comparison-summary-label">Maior ganho de B</span>
                    <strong>${escapeHtml(strongestB)}</strong>
                    <p>Maior perda de A nessa linha.</p>
                </article>
            </div>
        </div>
    `;
}

function buildABComparisonTableMarkup(snapshot) {
    return `
        <div class="ab-comparison-table">
            <div class="ab-comparison-header" role="row">
                <span class="ab-comparison-header-cell">Métrica</span>
                <span class="ab-comparison-header-cell">A</span>
                <span class="ab-comparison-header-cell">B</span>
                <span class="ab-comparison-header-cell">Delta</span>
                <span class="ab-comparison-header-cell">Status</span>
            </div>
            ${snapshot.rows.map(row => `
                <div class="ab-comparison-item ab-comparison-row ${row.statusClass}" data-status="${row.status}" role="row" title="${escapeHtml(row.region.name)} · A ${Number(row.valA).toFixed(0)} vs B ${Number(row.valB).toFixed(0)}">
                    <div class="ab-comparison-region">
                        <span class="ab-region-tag">${escapeHtml(row.region.tag)}</span>
                        <span class="ab-region-name">${escapeHtml(row.region.name)}</span>
                    </div>
                    <div class="ab-comparison-value ab-comparison-value-a">${Number(row.valA).toFixed(0)}</div>
                    <div class="ab-comparison-value ab-comparison-value-b">${Number(row.valB).toFixed(0)}</div>
                    <div class="ab-comparison-delta ${row.deltaMeta.className}" title="${escapeHtml(row.deltaMeta.title)}">${escapeHtml(row.deltaMeta.text)}</div>
                    <div class="ab-comparison-status ${row.statusClass}">${escapeHtml(row.statusLabel)}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function getContextWeightMap(data) {
    const weights = data?.context?.weights;
    if (!weights || typeof weights !== 'object') {
        return Object.fromEntries(REGIONS.map(r => [r.key, 1.0]));
    }
    const out = {};
    REGIONS.forEach(r => {
        const w = Number(weights[r.key]);
        out[r.key] = Number.isFinite(w) ? w : 1.0;
    });
    return out;
}

function pickTopSignalForRegion(data, regionKey, fallbackIndex) {
    const details = getRegionEvidenceDetails(data, regionKey, fallbackIndex);
    const candidates = details.primarySignals.length ? details.primarySignals : details.supportingSignals;
    if (!candidates.length) return null;
    return candidates.reduce((best, s) => (best == null || (s.weight || 0) > (best.weight || 0) ? s : best), null);
}

function getABDecision(winnerData, loserData, contextWeights) {
    const weights = contextWeights || getContextWeightMap(winnerData) || getContextWeightMap(loserData);
    const ranked = REGIONS.map((region, index) => {
        const winnerScore = getScoreForRegion(winnerData?.scores || {}, region.key, index);
        const loserScore = getScoreForRegion(loserData?.scores || {}, region.key, index);
        const delta = winnerScore - loserScore;
        const ctxWeight = weights[region.key] ?? 1.0;
        const winnerSignal = pickTopSignalForRegion(winnerData, region.key, index);
        const loserSignal = pickTopSignalForRegion(loserData, region.key, index);
        const pairedSignal = winnerSignal && loserSignal && winnerSignal.name === loserSignal.name
            ? { name: winnerSignal.name, winnerValue: winnerSignal.value, loserValue: loserSignal.value, direction: winnerSignal.direction }
            : winnerSignal
                ? { name: winnerSignal.name, winnerValue: winnerSignal.value, loserValue: null, direction: winnerSignal.direction }
                : null;
        return {
            key: region.key,
            name: region.name,
            tag: region.tag,
            delta,
            relativeGain: loserScore > 0 ? (delta / loserScore) * 100 : null,
            winnerScore,
            loserScore,
            contextWeight: ctxWeight,
            priority: Math.max(delta, 0) * ctxWeight,
            pairedSignal,
            winnerEvidenceSummary: getRegionEvidenceDetails(winnerData, region.key, index).summary,
            action: REGION_ACTIONS[region.key] || 'Ajuste este eixo do perdedor com foco em clareza e intenção de uso.',
        };
    });

    const gains = ranked.filter(item => item.delta > 0);
    if (!gains.length) return [];

    gains.sort((a, b) => b.priority - a.priority || b.delta - a.delta);

    const relevant = gains.filter(item => item.contextWeight >= 0.7);
    const pool = relevant.length >= 3 ? relevant : gains;

    const limit = Math.min(5, Math.max(3, Math.min(gains.length, 5)));
    return pool.slice(0, limit);
}

function computeABDecisionConfidence(winnerData, loserData, snapshot, contextWeights) {
    const weights = contextWeights || getContextWeightMap(winnerData);
    const winnerIsA = snapshot.overallWinner === 'a';
    const winnerIsB = snapshot.overallWinner === 'b';
    if (!winnerIsA && !winnerIsB) {
        return { value: 0, level: 'low', breakdown: { magnitude: 0, consistency: 0, backendConfidence: 0 } };
    }

    const deltaMagnitude = Math.abs(snapshot.overallDiff);
    const magnitudeScore = Math.min(100, deltaMagnitude * 5);

    let weightedWins = 0;
    let weightedTotal = 0;
    snapshot.rows.forEach(row => {
        const w = weights[row.region.key] ?? 1.0;
        weightedTotal += w;
        const diffFavorsWinner = winnerIsA ? row.diff > 0 : row.diff < 0;
        if (diffFavorsWinner) weightedWins += w;
    });
    const consistencyScore = weightedTotal > 0 ? (weightedWins / weightedTotal) * 100 : 0;

    const winnerDataForConf = winnerIsA ? winnerData : loserData;
    const winnerConfidences = REGIONS
        .map((r, i) => getRegionConfidence(winnerDataForConf, r.key, i))
        .map(c => (c && typeof c.value === 'number' ? c.value : null))
        .filter(v => v != null);
    const backendConfidenceScore = winnerConfidences.length
        ? winnerConfidences.reduce((a, v) => a + v, 0) / winnerConfidences.length
        : 50;

    const value = Math.round(
        clamp(0.4 * magnitudeScore + 0.4 * consistencyScore + 0.2 * backendConfidenceScore, 5, 98)
    );
    const level = value >= 70 ? 'high' : value >= 45 ? 'moderate' : 'low';

    return {
        value,
        level,
        breakdown: {
            magnitude: Math.round(magnitudeScore),
            consistency: Math.round(consistencyScore),
            backendConfidence: Math.round(backendConfidenceScore),
        },
    };
}

function formatEvidenceSignalValue(value) {
    if (value == null) return '—';
    if (Math.abs(value) >= 10) return value.toFixed(0);
    if (Math.abs(value) >= 1) return value.toFixed(2);
    return value.toFixed(3);
}

function renderEvidenceSignals(signals, totalWeight) {
    if (!signals || !signals.length) return '';
    return signals
        .map(signal => {
            const valueText = formatEvidenceSignalValue(signal.value);
            const weightShare = signal.weight != null && totalWeight > 0
                ? Math.round((signal.weight / totalWeight) * 100)
                : null;
            const weightText = weightShare != null ? `${weightShare}%` : '—';
            const directionClass = signal.direction ? ` direction-${signal.direction}` : '';
            const directionGlyph = signal.direction === 'negative' ? '↓' : signal.direction === 'positive' ? '↑' : '•';
            return `
                <li class="evidence-signal${directionClass}">
                    <span class="evidence-signal-dir" aria-hidden="true">${directionGlyph}</span>
                    <span class="evidence-signal-name">${escapeHtml(signal.name)}</span>
                    <span class="evidence-signal-value" title="Feature value">${escapeHtml(valueText)}</span>
                    <span class="evidence-signal-weight" title="Contribuição relativa">${escapeHtml(weightText)}</span>
                </li>
            `;
        })
        .join('');
}

function renderEvidenceDetailsMarkup(evidenceDetails, detailsId) {
    if (!evidenceDetails || !evidenceDetails.hasDetails) return '';
    const { summary, primarySignals, supportingSignals } = evidenceDetails;
    const allSignals = [...primarySignals, ...supportingSignals];
    const totalWeight = allSignals.reduce((acc, s) => acc + (s.weight || 0), 0);
    const summaryBlock = summary ? `<p class="evidence-summary">${escapeHtml(summary)}</p>` : '';
    const primaryBlock = primarySignals.length ? `
        <div class="evidence-section">
            <span class="evidence-section-label">Primary signals</span>
            <ul class="evidence-signal-list">${renderEvidenceSignals(primarySignals, totalWeight)}</ul>
        </div>
    ` : '';
    const supportingBlock = supportingSignals.length ? `
        <div class="evidence-section">
            <span class="evidence-section-label">Supporting signals</span>
            <ul class="evidence-signal-list">${renderEvidenceSignals(supportingSignals, totalWeight)}</ul>
        </div>
    ` : '';
    return `
        <button type="button" class="metric-evidence-toggle" aria-expanded="false" aria-controls="${detailsId}" data-evidence-toggle>
            <span>Details</span>
            <span class="metric-evidence-chevron" aria-hidden="true">▾</span>
        </button>
        <div class="metric-evidence-details" id="${detailsId}" hidden>
            ${summaryBlock}
            ${primaryBlock}
            ${supportingBlock}
        </div>
    `;
}

function buildMetricCardMarkup({
    name,
    tag,
    desc,
    value,
    level,
    levelText,
    color,
    confidence,
    evidence,
    evidenceDetails,
    detailsId,
    delta,
    deltaSideLabel,
    valueFontSize = null,
}) {
    const confidenceText = getConfidenceBadgeText(confidence);
    const confidenceLevel = getConfidenceLevel(confidence);
    const summaryFallback = evidenceDetails?.summary || null;
    const evidenceCompact = evidence || (summaryFallback ? toCompactText(summaryFallback, 84) : null);
    const evidenceText = evidenceCompact ? toCompactText(evidenceCompact, 84) : 'Sem evidência extra';
    const evidenceTitle = evidenceCompact ? evidenceCompact : 'Backend não enviou evidência por região';
    const hasEvidence = Boolean(evidenceCompact);
    const deltaMeta = delta != null ? getDeltaMeta(delta, deltaSideLabel || 'outra versão') : null;
    const deltaClass = deltaMeta ? ` ${deltaMeta.className}` : '';
    const valueStyle = valueFontSize ? ` style="font-size:${valueFontSize}px"` : '';
    const detailsMarkup = detailsId ? renderEvidenceDetailsMarkup(evidenceDetails, detailsId) : '';

    return `
        <div class="metric-head">
            <div>
                <div class="metric-name">${escapeHtml(name)}</div>
                <div class="metric-region">${escapeHtml(tag)}${desc ? ` <span class="metric-desc">— ${escapeHtml(desc)}</span>` : ''}</div>
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
        ${detailsMarkup}
    `;
}

function setAnalyzeResultMode(enabled) {
    const analyzeView = document.getElementById('viewAnalyze');
    if (analyzeView) analyzeView.classList.toggle('result-mode', Boolean(enabled));
}

function resetAnalyzeState() {
    const overlay = document.getElementById('brainOverlay');
    const label = document.getElementById('brainRegionLabel');
    const grid = document.getElementById('metricsGrid');
    const scoreCard = document.getElementById('scoreCard');
    const reportCard = document.getElementById('reportCard');
    const reportMeta = document.getElementById('reportMeta');
    const reportContent = document.getElementById('reportContent');

    setAnalyzeResultMode(false);

    if (overlay) overlay.classList.remove('hidden');
    if (label) label.textContent = 'Select a region';
    if (grid) grid.innerHTML = '';
    if (scoreCard) scoreCard.style.display = 'none';
    if (reportCard) reportCard.style.display = 'none';
    if (reportMeta) reportMeta.textContent = '';
    if (reportContent) reportContent.innerHTML = '';

    document.querySelectorAll('.metric-card').forEach(card => card.classList.remove('active'));

    if (brainScene?.hotspots?.length) {
        const neutralScores = Object.fromEntries(REGIONS.map(region => [region.key, 0]));
        brainScene.lastScores = neutralScores;
        updateBrainActivation(brainScene, neutralScores);
    }
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initContextSelectors();
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
    gradioReachable = false;
    updateActionButtonsState();
    try {
        const res = await fetchWithTimeout(`https://api.github.com/gists/${GIST_ID}`, { cache: 'no-store' }, 8000);
        if (!res.ok) {
            throw new Error(`Falha ao carregar Gist (${res.status})`);
        }
        const data = await res.json();
        const gistContent = data?.files?.['gradio_url.json']?.content;
        if (!gistContent) {
            throw new Error('gradio_url.json não encontrado no Gist');
        }
        const content = JSON.parse(gistContent);
        if (content.url && !content.url.includes('placeholder')) {
            gradioUrl = content.url.replace(/\/$/, '');
            // Test if actually reachable
            try {
                const test = await fetchWithTimeout(gradioUrl + '/config', { mode: 'cors' }, 5000);
                if (test.ok) {
                    gradioReachable = true;
                    dot.className = 'status-dot online';
                    txt.textContent = 'Server online';
                    updateActionButtonsState();
                    return;
                }
            } catch {}

            gradioReachable = false;
            dot.className = 'status-dot offline';
            txt.textContent = 'Server unreachable';
        } else {
            gradioUrl = null;
            dot.className = 'status-dot offline';
            txt.textContent = 'Server offline';
        }
    } catch {
        gradioUrl = null;
        gradioReachable = false;
        dot.className = 'status-dot offline';
        txt.textContent = 'Server offline';
    }
    updateActionButtonsState();
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
        updateActionButtonsState();
        resetAnalyzeState();
    });

    analyzeBtn.addEventListener('click', () => runAnalysis());

    function handleFile(file) {
        if (!file) return;
        clearPreviewMedia();
        currentFile = file;
        zone.style.display = 'none';
        preview.style.display = 'block';
        resetAnalyzeState();

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
        updateActionButtonsState();
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
            updateActionButtonsState();
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
        updateActionButtonsState();
    }
}

// ============================================
// API CALL (Gradio v5 SSE protocol)
// ============================================
async function callGradioAPI(file, contextKey = 'generic') {
    // 1. Upload file
    const uploadData = new FormData();
    uploadData.append('files', file);
    const uploadRes = await fetchOrThrowNetwork(gradioUrl + '/gradio_api/upload', {
        method: 'POST',
        body: uploadData,
    }, 45000);
    if (!uploadRes.ok) {
        const body = await readResponseSnippet(uploadRes);
        throw new Error(`Erro no upload para o backend (${uploadRes.status}): ${body}`);
    }
    const uploadJson = await uploadRes.json();
    const filePath = Array.isArray(uploadJson) ? uploadJson[0] : null;
    if (!filePath) {
        throw new Error('Upload concluído sem caminho de arquivo retornado pelo backend.');
    }

    const filePayload = { path: filePath, orig_name: file.name, size: file.size, mime_type: file.type, meta: { _type: 'gradio.FileData' } };
    const normalizedContext = normalizeContextKey(contextKey);

    async function startCall(dataPayload) {
        const callRes = await fetchOrThrowNetwork(gradioUrl + '/gradio_api/call/analisar_json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: dataPayload }),
        }, 30000);
        if (!callRes.ok) {
            const body = await readResponseSnippet(callRes);
            throw new Error(`Erro ao iniciar chamada da API (${callRes.status}): ${body}`);
        }
        const callJson = await callRes.json();
        if (!callJson?.event_id) {
            throw new Error('Resposta sem event_id ao iniciar chamada da API.');
        }
        return callJson.event_id;
    }

    // 2. Start the call — tries contextual payload first, then legacy payload.
    let event_id;
    try {
        event_id = await startCall([filePayload, normalizedContext]);
    } catch (err) {
        console.warn('Context payload failed, falling back to legacy payload:', err);
        event_id = await startCall([filePayload]);
    }

    // 3. Stream SSE result
    const resultRes = await fetchOrThrowNetwork(gradioUrl + '/gradio_api/call/analisar_json/' + event_id, {}, 90000);
    if (!resultRes.ok) {
        const body = await readResponseSnippet(resultRes);
        throw new Error(`Erro ao consultar resultado da API (${resultRes.status}): ${body}`);
    }
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

    const parsedResult = typeof resultData[0] === 'string' ? JSON.parse(resultData[0]) : resultData[0];
    if (!parsedResult.context?.key) {
        parsedResult.context = {
            key: normalizedContext,
            label: getContextLabel(normalizedContext),
        };
    }
    return parsedResult;
}

// ============================================
// SINGLE ANALYSIS
// ============================================
async function runAnalysis() {
    if (!currentFile || !isGradioReady()) return;
    const contextKey = getSelectedContextKey();
    showLoading(`Analyzing brain activation patterns (${getContextLabel(contextKey)})...`);
    try {
        const result = await callGradioAPI(currentFile, contextKey);
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
    const contextLabel = getContextLabel(data?.context?.key || getSelectedContextKey());

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
        const evidenceDetails = getRegionEvidenceDetails(data, r.key, i);
        const level = val >= 65 ? 'high' : val >= 40 ? 'medium' : 'low';
        const levelText = val >= 65 ? 'High' : val >= 40 ? 'Medium' : 'Low';
        const color = val >= 65 ? '#5CA9FF' : val >= 40 ? '#F4B23E' : '#6480AB';
        const detailsId = `metric-evidence-details-${r.key}-${i}`;

        const card = document.createElement('div');
        card.className = `metric-card level-${level}`;
        card.innerHTML = buildMetricCardMarkup({
            name: r.name,
            tag: r.tag,
            desc: r.desc,
            value: val,
            level,
            levelText,
            color,
            confidence,
            evidence,
            evidenceDetails,
            detailsId,
        });
        card.addEventListener('click', event => {
            const toggle = event.target.closest('[data-evidence-toggle]');
            if (toggle && card.contains(toggle)) {
                event.stopPropagation();
                const panel = card.querySelector(`#${CSS.escape(detailsId)}`);
                if (!panel) return;
                const isOpen = card.classList.toggle('evidence-open');
                toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                if (isOpen) {
                    panel.removeAttribute('hidden');
                } else {
                    panel.setAttribute('hidden', '');
                }
                return;
            }
            document.querySelectorAll('.metric-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            isolateBrainRegion(brainScene, i);
            document.getElementById('brainRegionLabel').textContent = `${r.tag} — ${r.desc}`;
        });
        grid.appendChild(card);
    });

    // UX Score
    const uxScore = getResultUXScore(data).toFixed(0);
    document.getElementById('scoreCard').style.display = 'block';
    document.getElementById('scoreValue').textContent = uxScore;
    document.getElementById('scoreBarFill').style.width = uxScore + '%';

    // Report
    if (report) {
        document.getElementById('reportCard').style.display = 'block';
        document.getElementById('reportMeta').textContent = `${elapsed.toFixed(1)}s inference · ${contextLabel}`;
        document.getElementById('reportContent').innerHTML = formatReport(report);
        updateReportSourceBadge(data);
    }
}

function updateReportSourceBadge(data) {
    const badge = document.getElementById('reportSource');
    if (!badge) return;
    const source = typeof data?.report_source === 'string' ? data.report_source : null;
    if (!source) {
        badge.hidden = true;
        badge.removeAttribute('title');
        badge.className = 'report-source-badge';
        badge.textContent = '';
        return;
    }
    const model = typeof data?.report_model === 'string' ? data.report_model : '';
    const error = typeof data?.report_error === 'string' ? data.report_error : '';
    badge.hidden = false;
    badge.className = `report-source-badge source-${source}`;
    badge.textContent = formatReportSource(source, model);
    badge.title = formatReportSourceTitle(source, model, error);
}

function formatReportSource(source, model) {
    if (source === 'cache') return 'cache';
    if (source === 'fallback') return 'fallback';
    if (source === 'anthropic') {
        const short = shortenModelName(model);
        return short ? `IA · ${short}` : 'IA';
    }
    return source;
}

function formatReportSourceTitle(source, model, error) {
    if (source === 'cache') return 'Relatório servido do cache (mesma entrada, mesmo contexto).';
    if (source === 'fallback') {
        return error
            ? `Fallback determinístico ativado. Motivo: ${error}`
            : 'Fallback determinístico — a IA externa não respondeu.';
    }
    if (source === 'anthropic') {
        return model ? `Gerado pela IA externa (${model}).` : 'Gerado pela IA externa.';
    }
    return '';
}

function shortenModelName(model) {
    if (!model) return '';
    return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

// ============================================
// A/B ANALYSIS
// ============================================
async function runABAnalysis() {
    if (!abFiles.a || !abFiles.b || !isGradioReady()) return;
    const contextKey = getSelectedContextKey();
    showLoading(`Analyzing Version A (${getContextLabel(contextKey)})...`);
    try {
        const resultA = await callGradioAPI(abFiles.a, contextKey);
        abResults.a = resultA;
        displayABResults('a', resultA);

        document.getElementById('loadingText').textContent = `Analyzing Version B (${getContextLabel(contextKey)})...`;
        const resultB = await callGradioAPI(abFiles.b, contextKey);
        abResults.b = resultB;
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
            desc: r.desc,
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
    const uxScore = getResultUXScore(data).toFixed(0);
    const scoreCard = document.getElementById(`scoreCard${side.toUpperCase()}`);
    scoreCard.style.display = 'block';
    scoreCard.querySelector('.ab-score-value').textContent = uxScore;
    scoreCard.querySelector('.ab-score-fill').style.width = uxScore + '%';
}

function displayABComparison(a, b) {
    const card = document.getElementById('abReportCard');
    card.style.display = 'block';
    const contextLabel = getContextLabel(a?.context?.key || b?.context?.key || getSelectedContextKey());
    const snapshot = buildABComparisonSnapshot(a, b);

    const grid = document.getElementById('abComparisonGrid');
    grid.innerHTML = `
        ${buildABComparisonSummaryMarkup(snapshot, contextLabel)}
        ${buildABComparisonTableMarkup(snapshot)}
    `;

    // Overall comparison
    const avgA = snapshot.avgA;
    const avgB = snapshot.avgB;
    const winner = snapshot.overallWinner === 'a' ? 'A' : snapshot.overallWinner === 'b' ? 'B' : 'Empate';
    const diff = snapshot.overallDiff;
    const absDiff = Math.abs(diff);
    const winnerData = winner === 'A' ? a : b;
    const loserData = winner === 'A' ? b : a;
    const contextWeights = getContextWeightMap(winnerData);
    const confidence = winner === 'Empate'
        ? { value: 0, level: 'low', breakdown: { magnitude: 0, consistency: 0, backendConfidence: 0 } }
        : computeABDecisionConfidence(winnerData, loserData, snapshot, contextWeights);
    const decisions = winner === 'Empate' ? [] : getABDecision(winnerData, loserData, contextWeights);
    const overallToneClass = winner === 'A' ? 'winner-a' : winner === 'B' ? 'winner-b' : 'neutral';
    const deltaClass = diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral';
    const deltaText = diff === 0 ? 'Δ 0.0' : `Δ ${diff > 0 ? '+' : '−'}${absDiff.toFixed(1)}`;
    const overallNarrative =
        winner === 'A'
            ? 'Version A shows stronger overall brain engagement for this context.'
            : winner === 'B'
                ? 'Version B shows stronger overall brain engagement for this context.'
                : 'Both versions show similar overall brain engagement.';

    const relativeGain = winner !== 'Empate' && Math.min(avgA, avgB) > 0
        ? (absDiff / Math.min(avgA, avgB)) * 100
        : null;
    const gainSuffix = relativeGain != null && Number.isFinite(relativeGain)
        ? ` (+${relativeGain.toFixed(relativeGain >= 10 ? 0 : 1)}%)`
        : '';

    const confidenceTitle = winner === 'Empate'
        ? 'Sem vencedor definido'
        : `Magnitude ${confidence.breakdown.magnitude} · Consistência ${confidence.breakdown.consistency} · Backend ${confidence.breakdown.backendConfidence}`;

    const decisionMarkup = winner === 'Empate'
        ? `
            <div class="ab-decision-card neutral">
                <h3>Decisão sugerida</h3>
                <p>As versões estão tecnicamente empatadas no contexto <strong>${contextLabel}</strong>. Priorize teste com tráfego real.</p>
            </div>
        `
        : `
            <div class="ab-decision-card ${winner === 'A' ? 'winner-a' : 'winner-b'}">
                <div class="ab-decision-head">
                    <h3>Decisão sugerida: versão ${winner}</h3>
                    <span class="ab-decision-confidence level-${confidence.level}" title="${escapeHtml(confidenceTitle)}">
                        <span class="ab-decision-confidence-label">Confiança</span>
                        <span class="ab-decision-confidence-value">${confidence.value}%</span>
                        <span class="ab-decision-confidence-level">${confidence.level === 'high' ? 'Alta' : confidence.level === 'moderate' ? 'Moderada' : 'Baixa'}</span>
                    </span>
                </div>
                <p class="ab-decision-summary">
                    No contexto <strong>${contextLabel}</strong>, a versão ${winner} apresentou melhor score global
                    (${Math.max(avgA, avgB).toFixed(0)}/100) com ganho de ${absDiff.toFixed(1)} pontos${gainSuffix}.
                </p>
                <div class="ab-decision-actions">
                    ${decisions.map(item => {
                        const deltaLabel = `+${item.delta.toFixed(item.delta >= 10 ? 0 : 1)} pts`;
                        const relLabel = item.relativeGain != null && Number.isFinite(item.relativeGain)
                            ? ` · +${item.relativeGain.toFixed(item.relativeGain >= 10 ? 0 : 1)}%`
                            : '';
                        const weightBadge = item.contextWeight >= 1.2
                            ? `<span class="ab-decision-action-weight" title="Alta relevância neste contexto">crítica no contexto</span>`
                            : item.contextWeight <= 0.7
                                ? `<span class="ab-decision-action-weight muted" title="Baixa relevância neste contexto">secundária no contexto</span>`
                                : '';
                        let evidenceLine = '';
                        if (item.pairedSignal) {
                            const sig = item.pairedSignal;
                            const wVal = formatEvidenceSignalValue(sig.winnerValue);
                            const lVal = sig.loserValue != null ? formatEvidenceSignalValue(sig.loserValue) : '—';
                            evidenceLine = `Sinal <code>${escapeHtml(sig.name)}</code>: vencedor ${escapeHtml(wVal)} vs perdedor ${escapeHtml(lVal)}`;
                        } else if (item.winnerEvidenceSummary) {
                            evidenceLine = escapeHtml(item.winnerEvidenceSummary);
                        } else {
                            evidenceLine = 'Sem evidência estruturada do backend.';
                        }
                        return `
                            <div class="ab-decision-action">
                                <div class="ab-decision-action-title">
                                    <span>${escapeHtml(item.tag)} · ${deltaLabel}${relLabel}</span>
                                    ${weightBadge}
                                </div>
                                <p>${escapeHtml(item.action)}</p>
                                <small class="ab-decision-action-evidence">${evidenceLine}</small>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

    const overallMarkup = `
        <section class="overall-comparison-card ${overallToneClass}">
            <div class="overall-comparison-head">
                <h2>Overall Comparison</h2>
                <span class="overall-context">Context: ${contextLabel}</span>
            </div>
            <div class="overall-score-grid">
                <div class="overall-score-card ${winner === 'A' ? 'winner' : ''}">
                    <div class="overall-score-label">Version A</div>
                    <div class="overall-score-value">${avgA.toFixed(0)}<span>/100</span></div>
                </div>
                <div class="overall-delta ${deltaClass}" title="Diferença de score A-B">${deltaText}</div>
                <div class="overall-score-card ${winner === 'B' ? 'winner' : ''}">
                    <div class="overall-score-label">Version B</div>
                    <div class="overall-score-value">${avgB.toFixed(0)}<span>/100</span></div>
                </div>
            </div>
            <div class="overall-bars">
                <div class="overall-bar-row">
                    <span class="overall-bar-label">A</span>
                    <div class="overall-bar-track"><div class="overall-bar-fill version-a" style="width:${avgA.toFixed(1)}%"></div></div>
                    <span class="overall-bar-num">${avgA.toFixed(0)}</span>
                </div>
                <div class="overall-bar-row">
                    <span class="overall-bar-label">B</span>
                    <div class="overall-bar-track"><div class="overall-bar-fill version-b" style="width:${avgB.toFixed(1)}%"></div></div>
                    <span class="overall-bar-num">${avgB.toFixed(0)}</span>
                </div>
            </div>
            <p class="overall-insight">${overallNarrative}</p>
        </section>
    `;

    const reportEl = document.getElementById('abReportContent');
    reportEl.innerHTML = `
        ${decisionMarkup}
        ${overallMarkup}
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

    // Placeholder hemispheres (replaced when GLB loads)
    let leftHemi = new THREE.Mesh(new THREE.SphereGeometry(0.01), new THREE.MeshBasicMaterial({ visible: false }));
    let rightHemi = leftHemi.clone();
    brainGroup.add(leftHemi);
    brainGroup.add(rightHemi);

    // Store brain meshes for region vertex coloring
    const brainMeshes = [];

    // Load GLB brain model
    const gltfLoader = new GLTFLoader();
    gltfLoader.load('assets/brain.glb', (gltf) => {
        const model = gltf.scene;

        // Compute bounding box to center and scale the model
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2.2 / maxDim; // fit to ~2.2 units

        model.position.sub(center);
        model.scale.setScalar(scale);
        model.position.y += 0.1; // slight upward offset

        // Process each mesh in the model
        model.traverse((child) => {
            if (child.isMesh) {
                brainMeshes.push(child);

                // Apply translucent brain material preserving original textures
                const origMap = child.material.map;
                const origNormal = child.material.normalMap;
                child.material = new THREE.MeshPhysicalMaterial({
                    map: origMap,
                    normalMap: origNormal,
                    color: 0x8aacd4,
                    transparent: true,
                    opacity: 0.85,
                    roughness: 0.55,
                    metalness: 0.05,
                    clearcoat: 0.4,
                    clearcoatRoughness: 0.2,
                    side: THREE.FrontSide,
                    vertexColors: true,
                });

                // Initialize vertex colors (neutral blue-gray)
                const geo = child.geometry;
                const count = geo.attributes.position.count;
                const colors = new Float32Array(count * 3);
                const baseColor = new THREE.Color(0x8aacd4);
                for (let i = 0; i < count; i++) {
                    colors[i * 3] = baseColor.r;
                    colors[i * 3 + 1] = baseColor.g;
                    colors[i * 3 + 2] = baseColor.b;
                }
                geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            }
        });

        brainGroup.add(model);
        sceneData.brainMeshes = brainMeshes;
        sceneData.brainModel = model;

        // If scores were already set before model loaded, apply them
        if (sceneData.lastScores) {
            updateBrainActivation(sceneData, sceneData.lastScores);
        }
    });

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
        brainMeshes,
        brainModel: null,
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

    // Paint brain model vertices by proximity to activated regions
    if (sceneData.brainMeshes && sceneData.brainMeshes.length > 0) {
        const baseColor = new THREE.Color(0x8aacd4);
        const regionPositions = REGIONS.map(r => new THREE.Vector3(...r.pos));
        const regionActivations = REGIONS.map((r, i) => {
            const val = getScoreForRegion(scores, r.key, i);
            return val / 100;
        });
        const regionColors = REGIONS.map((r, i) => {
            const val = getScoreForRegion(scores, r.key, i);
            if (val >= 65) {
                const t = (val - 65) / 35;
                return new THREE.Color().lerpColors(new THREE.Color(0x5ca9ff), new THREE.Color(0x63d5ff), t);
            } else if (val >= 40) {
                const t = (val - 40) / 25;
                return new THREE.Color().lerpColors(new THREE.Color(0xf4b23e), new THREE.Color(0x5ca9ff), t);
            } else {
                const t = val / 40;
                return new THREE.Color().lerpColors(new THREE.Color(0x5a7094), new THREE.Color(0xf4b23e), t);
            }
        });

        const influenceRadius = 1.2; // how far each region's glow extends
        const vertexPos = new THREE.Vector3();

        sceneData.brainMeshes.forEach(mesh => {
            const geo = mesh.geometry;
            const positions = geo.attributes.position;
            const colors = geo.attributes.color;
            if (!colors) return;

            // Get world matrix to transform vertices
            mesh.updateWorldMatrix(true, false);
            const worldMatrix = mesh.matrixWorld;

            for (let v = 0; v < positions.count; v++) {
                vertexPos.set(positions.getX(v), positions.getY(v), positions.getZ(v));
                vertexPos.applyMatrix4(worldMatrix);

                // Accumulate color influence from all regions
                let totalWeight = 0;
                const blended = new THREE.Color(0, 0, 0);

                for (let ri = 0; ri < regionPositions.length; ri++) {
                    const dist = vertexPos.distanceTo(regionPositions[ri]);
                    if (dist < influenceRadius && regionActivations[ri] > 0.05) {
                        const falloff = 1 - (dist / influenceRadius);
                        const weight = falloff * falloff * regionActivations[ri];
                        blended.r += regionColors[ri].r * weight;
                        blended.g += regionColors[ri].g * weight;
                        blended.b += regionColors[ri].b * weight;
                        totalWeight += weight;
                    }
                }

                if (totalWeight > 0) {
                    // Blend between base color and activated color
                    const intensity = Math.min(totalWeight, 1);
                    blended.r /= totalWeight;
                    blended.g /= totalWeight;
                    blended.b /= totalWeight;
                    colors.setXYZ(v,
                        baseColor.r * (1 - intensity) + blended.r * intensity,
                        baseColor.g * (1 - intensity) + blended.g * intensity,
                        baseColor.b * (1 - intensity) + blended.b * intensity
                    );
                } else {
                    colors.setXYZ(v, baseColor.r, baseColor.g, baseColor.b);
                }
            }
            colors.needsUpdate = true;
        });
    }

    // Make brain shell semi-transparent when activated
    const allVals = getAllRegionScores(scores);
    const avgActivation = (allVals.reduce((a, b) => a + b, 0) / allVals.length) / 100;

    // Adjust GLB model opacity based on activation
    if (sceneData.brainMeshes) {
        sceneData.brainMeshes.forEach(mesh => {
            mesh.material.opacity = 0.85 - avgActivation * 0.15;
            mesh.material.emissive = new THREE.Color(0x2a4a7a);
            mesh.material.emissiveIntensity = avgActivation * 0.4;
        });
    }

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
