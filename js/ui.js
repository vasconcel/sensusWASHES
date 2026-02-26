/**
 * sensus-WASHES | UI Orchestrator (v2.0)
 * Responsabilidade: Gerenciar o fluxo científico de busca, triagem e exportação.
 * Padrão: Metodologia SLR/MLR Auditável.
 */

import { API } from './api.js';
import { buildPredicate } from './parser.js';

// --- 1. Estado Global da Aplicação (Single Source of Truth) ---
const store = {
    corpus: [],          // Base carregada via API (Filtros de Edição/Ano)
    filtered: [],        // Artigos que passaram pela string booleana
    decisions: {},       // { [id]: 'IC' | 'EC' } - Persistido no LocalStorage
    currentTerms: [],    // Termos extraídos para o Highlighter
    editions: []         // Cache de edições para a Sidebar
};

// --- 2. Cache de Elementos DOM ---
const dom = {
    // Pesquisa
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    // Filtros
    editionFilter: document.getElementById('editionFilter'),
    yearFilter: document.getElementById('yearFilter'),
    applyFiltersBtn: document.getElementById('applyFiltersBtn'),
    // Resultados e Status
    resultsContainer: document.getElementById('resultsContainer'),
    statusBox: document.getElementById('statusBox'),
    errorBox: document.getElementById('errorBox'),
    // Estatísticas (PRISMA Logic)
    statTotal: document.getElementById('stat-total'),
    statFiltered: document.getElementById('stat-filtered'),
    statIncluded: document.getElementById('stat-included'),
    statExcluded: document.getElementById('stat-excluded'),
    // Exportação
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    exportCsvBtn: document.getElementById('exportCsvBtn')
};

// --- 3. Inicialização ---
document.addEventListener('DOMContentLoaded', async () => {
    loadDecisions();
    setupEventListeners();
    
    try {
        updateStatus('Sincronizando metadados da API...');
        
        // Carrega edições para os filtros da sidebar
        store.editions = await API.editions.listAll();
        populateFilterSelectors();

        // Carregamento inicial silencioso (Background)
        await syncDataWithAPI(true); 
        
        updateStatus('Pronto. Insira uma string de busca para iniciar a triagem.');
    } catch (err) {
        showError(`Erro na inicialização: ${err.message}`);
    }
});

function setupEventListeners() {
    dom.searchBtn.onclick = handleSearch;
    dom.applyFiltersBtn.onclick = () => syncDataWithAPI(false);
    
    // Atalho: Enter executa a busca
    dom.searchInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSearch();
        }
    };

    dom.exportJsonBtn.onclick = exportJSON;
    dom.exportCsvBtn.onclick = exportCSV;
}

// --- 4. Sincronização e Filtros da API ---

async function syncDataWithAPI(isInitial = false) {
    const year = dom.yearFilter.value;
    const editionId = dom.editionFilter.value;
    
    clearError();
    updateStatus('Atualizando corpus científico...');

    try {
        let rawData;
        if (year !== 'all') {
            rawData = await API.papers.getByYear(year);
        } else if (editionId !== 'all') {
            rawData = await API.editions.getPapers(editionId);
        } else {
            rawData = await API.papers.getAll();
        }

        store.corpus = normalizeData(rawData);
        updateStats();

        // Se não for o carregamento inicial, tenta re-aplicar a busca booleana
        if (!isInitial) {
            handleSearch();
        } else {
            renderEmptyState();
        }

    } catch (err) {
        showError(`Erro ao sincronizar dados: ${err.message}`);
    }
}

function populateFilterSelectors() {
    // Ordenar edições da mais recente para a mais antiga
    const sortedEditions = [...store.editions].sort((a, b) => (b.Year || 0) - (a.Year || 0));
    
    sortedEditions.forEach(ed => {
        const label = ed.Year ? `${ed.Edition_id} (${ed.Year})` : `Edição ${ed.Edition_id}`;
        dom.editionFilter.add(new Option(label, ed.Edition_id));
    });

    for (let y = 2025; y >= 2016; y--) {
        dom.yearFilter.add(new Option(y, y));
    }
}

// --- 5. Motor de Busca e Highlighting ---

function handleSearch() {
    const query = dom.searchInput.value.trim();
    clearError();

    if (!query) {
        store.filtered = [];
        store.currentTerms = [];
        renderEmptyState();
        updateStatus('Aguardando query de busca...');
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
        updateStatus(`Busca finalizada: ${store.filtered.length} resultados.`);
    } catch (err) {
        showError(`Erro de Sintaxe Booleana: ${err.message}`);
    }
}

function highlightText(text, terms) {
    if (!terms || terms.length === 0 || !text) return text;
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

// --- 6. Renderização de Resultados (High-Density UI) ---

function renderResults() {
    dom.resultsContainer.innerHTML = '';

    if (store.filtered.length === 0) {
        dom.resultsContainer.innerHTML = `<p class="text-center py-10 text-slate-500 text-sm italic">Nenhum artigo corresponde aos critérios booleanos neste filtro.</p>`;
        return;
    }

    store.filtered.forEach(paper => {
        const decision = store.decisions[paper.id];
        const card = document.createElement('article');
        
        card.className = `paper-card ${decision === 'IC' ? 'paper-included' : ''} ${decision === 'EC' ? 'paper-excluded' : ''}`;
        
        const hTitle = highlightText(paper.title, store.currentTerms);
        const hAbstract = highlightText(paper.abstract, store.currentTerms);

        card.innerHTML = `
            <div class="paper-meta">
                <span><strong>ID:</strong> #${paper.id}</span>
                <span><strong>ANO:</strong> ${paper.year}</span>
                ${paper.link ? `<a href="${paper.link}" target="_blank" class="hover:underline">SOL ↗</a>` : ''}
            </div>
            <h2 class="paper-title">${hTitle}</h2>
            <p class="paper-abstract">${hAbstract}</p>
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

function renderEmptyState() {
    dom.resultsContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20 text-slate-400">
            <svg class="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p class="text-sm italic">Aguardando string de busca para triagem científica...</p>
        </div>`;
}

// --- 7. Utilitários de Normalização Blindada ---

function getField(obj, aliases) {
    const keys = Object.keys(obj);
    for (let alias of aliases) {
        const found = keys.find(k => k.toLowerCase() === alias.toLowerCase());
        if (found && obj[found] !== null && obj[found] !== undefined) return obj[found];
    }
    return null;
}

function normalizeData(data) {
    if (!Array.isArray(data)) return [];
    return data.map(p => ({
        id: getField(p, ['Paper_id', 'paper_id', 'id']) ?? 'N/A',
        title: getField(p, ['Title', 'title', 'paper_title']) ?? 'Título não identificado',
        abstract: getField(p, ['Abstract', 'abstract', 'Resumo', 'resumo']) ?? 'Resumo indisponível.',
        year: getField(p, ['Year', 'year', 'edition_year']) ?? 'N/A',
        link: getField(p, ['Download_link', 'download_link', 'url']),
        authors: getField(p, ['Authors', 'authors', 'Author'])
    }));
}

// --- 8. Persistência e Decisões ---

window.updateDecision = (id, type) => {
    if (store.decisions[id] === type) {
        delete store.decisions[id];
    } else {
        store.decisions[id] = type;
    }
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

function saveDecisions() { localStorage.setItem('sensus_w_decisions', JSON.stringify(store.decisions)); }
function loadDecisions() { 
    const saved = localStorage.getItem('sensus_w_decisions');
    if (saved) store.decisions = JSON.parse(saved); 
}

// --- 9. Exportação Profissional (Padrão Scopus/MLR) ---

function exportCSV() {
    updateStatus('Preparando exportação enriquecida...');
    
    const headers = ["Paper ID", "Decision", "Year", "Title", "Authors", "Abstract", "URL", "Source", "Export Date"];

    const exportRows = Object.entries(store.decisions).map(([id, decision]) => {
        const p = store.corpus.find(item => String(item.id) === String(id));
        
        let authStr = "N/A";
        if (p?.authors && Array.isArray(p.authors)) {
            authStr = p.authors.map(a => a.Name || a.name || "Unknown").join("; ");
        }

        return [
            id,
            decision,
            p?.year || "N/A",
            p?.title || "Untitled",
            authStr,
            p?.abstract || "No abstract",
            p?.link || "",
            "Workshop WASHES (via sensus-WASHES)",
            new Date().toISOString().split('T')[0]
        ];
    });

    if (exportRows.length === 0) {
        showError("Nenhuma decisão para exportar.");
        return;
    }

    const csvContent = [
        headers.join(","),
        ...exportRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `sensus-washes-audit-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    updateStatus('Exportação concluída.');
}

function exportJSON() {
    const data = { metadata: { tool: "sensus-WASHES", date: new Date() }, decisions: store.decisions };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `sensus-washes-backup.json`;
    link.click();
}

// --- 10. Feedback de Interface ---
function updateStatus(m) { dom.statusBox.textContent = m; }
function showError(m) { dom.errorBox.textContent = m; dom.errorBox.classList.remove('hidden'); }
function clearError() { dom.errorBox.classList.add('hidden'); }