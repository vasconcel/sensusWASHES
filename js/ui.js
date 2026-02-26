/**
 * sensus-WASHES | UI Orchestrator
 */

import { API } from './api.js';
import { buildPredicate } from './parser.js';

const store = {
    corpus:[],
    filtered: [],
    decisions: {},
    currentTerms: [],
    editions:[]
};

const dom = {
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    editionFilter: document.getElementById('editionFilter'),
    yearFilter: document.getElementById('yearFilter'),
    applyFiltersBtn: document.getElementById('applyFiltersBtn'),
    resultsContainer: document.getElementById('resultsContainer'),
    statusBox: document.getElementById('statusBox'),
    errorBox: document.getElementById('errorBox'),
    statTotal: document.getElementById('stat-total'),
    statFiltered: document.getElementById('stat-filtered'),
    statIncluded: document.getElementById('stat-included'),
    statExcluded: document.getElementById('stat-excluded'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    exportCsvBtn: document.getElementById('exportCsvBtn')
};

document.addEventListener('DOMContentLoaded', async () => {
    loadDecisions();
    setupEventListeners();
    
    try {
        updateStatus('Inicializando API...');
        store.editions = await API.editions.listAll();
        populateFilterSelectors();

        // Carrega os dados em background (não mostra na tela ainda)
        await syncDataWithAPI();
        
        // Garante que a tela comece vazia (Empty State do motor de busca)
        renderEmptyState();
        updateStatus('Pronto. Aguardando query de busca.');
    } catch (err) {
        showError(`Falha de inicialização: ${err.message}`);
    }
});

function setupEventListeners() {
    dom.searchBtn.onclick = handleSearch;
    dom.applyFiltersBtn.onclick = async () => {
        await syncDataWithAPI();
        // Se já havia uma busca feita, refaz a busca com os novos filtros
        if (dom.searchInput.value.trim()) handleSearch();
        else renderEmptyState();
    };
    
    dom.searchInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSearch();
        }
    };

    dom.exportJsonBtn.onclick = exportJSON;
    dom.exportCsvBtn.onclick = exportCSV;
}

async function syncDataWithAPI() {
    const year = dom.yearFilter.value;
    const editionId = dom.editionFilter.value;
    
    clearError();
    updateStatus('Baixando corpus científico...');

    try {
        let rawData;
        if (year !== 'all') rawData = await API.papers.getByYear(year);
        else if (editionId !== 'all') rawData = await API.editions.getPapers(editionId);
        else rawData = await API.papers.getAll(); // Chama /papers/ completo, não mais /abstracts

        // Normalização baseada estritamente na documentação fornecida
        store.corpus = rawData.map(p => ({
            id: p.Paper_id ?? p.paper_id ?? 'N/A',
            title: p.Title ?? p.title ?? 'Título não identificado',
            abstract: p.Abstract ?? p.Resumo ?? 'Resumo indisponível',
            year: p.Year ?? 'N/A',
            link: p.Download_link ?? null
        }));

        updateStats();
        updateStatus(`Corpus atualizado: ${store.corpus.length} artigos disponíveis.`);
    } catch (err) {
        showError(`Erro ao sincronizar: ${err.message}`);
    }
}

function populateFilterSelectors() {
    store.editions.forEach(ed => {
        const label = ed.Year ? `${ed.Edition_id} (${ed.Year})` : ed.Edition_id;
        dom.editionFilter.add(new Option(label, ed.Edition_id));
    });

    for (let y = 2024; y >= 2016; y--) {
        dom.yearFilter.add(new Option(y, y));
    }
}

function handleSearch() {
    const query = dom.searchInput.value.trim();
    clearError();

    // Se a busca estiver vazia, não mostre nada
    if (!query) {
        store.filtered = [];
        store.currentTerms =[];
        renderEmptyState();
        updateStats();
        updateStatus('Aguardando query de busca.');
        return;
    }

    try {
        const { predicate, terms } = buildPredicate(query);
        store.currentTerms = terms;
        store.filtered = store.corpus.filter(paper => 
            predicate(`${paper.title} ${paper.abstract}`)
        );

        renderResults();
        updateStats();
        updateStatus(`Busca retornou ${store.filtered.length} artigos.`);
    } catch (err) {
        showError(`Erro de Sintaxe: ${err.message}`);
    }
}

function highlightText(text, terms) {
    if (!terms || !text) return text;
    let result = text;
    const sortedTerms = [...terms].sort((a, b) => b.length - a.length);

    sortedTerms.forEach(term => {
        if (term.length < 3) return;
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        result = result.replace(regex, '<mark>$1</mark>');
    });
    return result;
}

function renderEmptyState() {
    dom.resultsContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20 text-slate-400">
            <svg class="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p class="text-sm">Aguardando string de busca para triagem...</p>
        </div>`;
}

function renderResults() {
    dom.resultsContainer.innerHTML = '';

    if (store.filtered.length === 0) {
        dom.resultsContainer.innerHTML = `<p class="text-center py-10 text-slate-500 text-sm">Nenhum resultado corresponde à query.</p>`;
        return;
    }

    store.filtered.forEach(paper => {
        const decision = store.decisions[paper.id];
        const card = document.createElement('article');
        
        card.className = `paper-card ${decision === 'IC' ? 'paper-included' : ''} ${decision === 'EC' ? 'paper-excluded' : ''}`;
        
        card.innerHTML = `
            <div class="paper-meta">
                <span><strong>ID:</strong> #${paper.id}</span>
                <span><strong>ANO:</strong> ${paper.year}</span>
                ${paper.link ? `<a href="${paper.link}" target="_blank">SOL ↗</a>` : ''}
            </div>
            <h2 class="paper-title">${highlightText(paper.title, store.currentTerms)}</h2>
            <p class="paper-abstract">${highlightText(paper.abstract, store.currentTerms)}</p>
            <div class="paper-actions">
                <button class="btn-action btn-ic ${decision === 'IC' ? 'active' : ''}" onclick="window.updateDecision('${paper.id}', 'IC')">
                    ${decision === 'IC' ? '✓ Incluído' : 'Incluir (IC)'}
                </button>
                <button class="btn-action btn-ec ${decision === 'EC' ? 'active' : ''}" onclick="window.updateDecision('${paper.id}', 'EC')">
                    ${decision === 'EC' ? '✕ Excluído' : 'Excluir (EC)'}
                </button>
            </div>
        `;
        dom.resultsContainer.appendChild(card);
    });
}

window.updateDecision = (id, type) => {
    if (store.decisions[id] === type) delete store.decisions[id];
    else store.decisions[id] = type;
    saveDecisions();
    renderResults();
    updateStats();
};

function updateStats() {
    dom.statTotal.textContent = store.corpus.length;
    dom.statFiltered.textContent = store.filtered.length;
    const decs = Object.values(store.decisions);
    dom.statIncluded.textContent = decs.filter(v => v === 'IC').length;
    dom.statExcluded.textContent = decs.filter(v => v === 'EC').length;
}

function saveDecisions() { localStorage.setItem('sensus_w_dec', JSON.stringify(store.decisions)); }
function loadDecisions() { 
    const saved = localStorage.getItem('sensus_w_dec');
    if (saved) store.decisions = JSON.parse(saved); 
}

function exportJSON() {
    const blob = new Blob([JSON.stringify({ metadata: { date: new Date() }, decisions: store.decisions }, null, 2)], { type: 'application/json' });
    download(blob, 'sensus-backup.json');
}

function exportCSV() {
    let csv = 'paper_id;decision\n';
    Object.entries(store.decisions).forEach(([id, dec]) => csv += `${id};${dec}\n`);
    download(new Blob([csv], { type: 'text/csv' }), 'sensus-audit.csv');
}

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
}

function updateStatus(m) { dom.statusBox.textContent = m; }
function showError(m) { dom.errorBox.textContent = m; dom.errorBox.classList.remove('hidden'); }
function clearError() { dom.errorBox.classList.add('hidden'); }