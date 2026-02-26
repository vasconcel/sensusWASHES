/**
 * sensus-WASHES | UI Orchestrator (v3.0 - Scopus Paradigm)
 * Responsabilidade: Motor de Busca Científica, Seleção em Massa e Exportação.
 * Foco: Alta densidade de informação e reprodutibilidade científica.
 */

import { API } from './api.js';
import { buildPredicate } from './parser.js';

// --- 1. Estado Global da Aplicação ---
const store = {
    corpus: [],          // Base total carregada via API (conforme filtros)
    filtered: [],        // Subconjunto após processamento booleano
    selected: {},        // { [id]: true } - Itens marcados para exportação
    currentTerms: [],    // Termos para o Highlighter
    editions: []         // Cache de edições para a Sidebar
};

// --- 2. Cache de Elementos DOM ---
const dom = {
    // Busca
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    // Filtros
    editionFilter: document.getElementById('editionFilter'),
    yearFilter: document.getElementById('yearFilter'),
    applyFiltersBtn: document.getElementById('applyFiltersBtn'),
    // Interface
    resultsContainer: document.getElementById('resultsContainer'),
    resultsToolbar: document.getElementById('resultsToolbar'),
    selectAllCheckbox: document.getElementById('selectAllCheckbox'),
    selectAllText: document.getElementById('selectAllText'),
    statusBox: document.getElementById('statusBox'),
    errorBox: document.getElementById('errorBox'),
    // Métricas (Sidebar)
    statTotal: document.getElementById('stat-total'),
    statFiltered: document.getElementById('stat-filtered'),
    statSelected: document.getElementById('stat-included'), // Reutilizando ID do HTML
    // Exportação
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    exportCsvBtn: document.getElementById('exportCsvBtn')
};

// --- 3. Inicialização ---
document.addEventListener('DOMContentLoaded', async () => {
    loadSelection();
    setupEventListeners();
    
    try {
        updateStatus('Sincronizando metadados...');
        
        // Carrega edições para os filtros
        store.editions = await API.editions.listAll();
        populateFilterSelectors();

        // Sincronização inicial silenciosa
        await syncDataWithAPI(true); 
        
        updateStatus('Sistema pronto.');
    } catch (err) {
        showError(`Falha na inicialização: ${err.message}`);
    }
});

function setupEventListeners() {
    dom.searchBtn.onclick = handleSearch;
    dom.applyFiltersBtn.onclick = () => syncDataWithAPI(false);
    
    // Suporte a busca via Enter
    dom.searchInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSearch();
        }
    };

    dom.exportJsonBtn.onclick = exportJSON;
    dom.exportCsvBtn.onclick = exportCSV;
}

// --- 4. Sincronização e Normalização de Dados ---

async function syncDataWithAPI(isInitial = false) {
    const year = dom.yearFilter.value;
    const editionId = dom.editionFilter.value;
    
    clearError();
    updateStatus('Atualizando acervo...');

    try {
        let rawData;
        if (year !== 'all') rawData = await API.papers.getByYear(year);
        else if (editionId !== 'all') rawData = await API.editions.getPapers(editionId);
        else rawData = await API.papers.getAll();

        // Normalização Blindada: Resolve problemas de Case e Nomes de Campos da API
        store.corpus = normalizeData(rawData);
        updateStats();

        if (!isInitial) handleSearch();
        else renderEmptyState();

    } catch (err) {
        showError(`Erro ao sincronizar dados: ${err.message}`);
    }
}

function normalizeData(data) {
    if (!Array.isArray(data)) return [];
    
    // Função auxiliar para busca insensível a maiúsculas
    const getField = (obj, aliases) => {
        const keys = Object.keys(obj);
        for (let alias of aliases) {
            const found = keys.find(k => k.toLowerCase() === alias.toLowerCase());
            if (found && obj[found] !== null && obj[found] !== undefined) return obj[found];
        }
        return null;
    };

    return data.map(p => ({
        id: String(getField(p, ['Paper_id', 'paper_id', 'id']) ?? 'N/A'),
        title: getField(p, ['Title', 'title', 'paper_title']) ?? 'Título não identificado',
        abstract: getField(p, ['Abstract', 'abstract', 'Resumo', 'resumo']) ?? 'Resumo indisponível.',
        year: getField(p, ['Year', 'year', 'edition_year']) ?? 'N/A',
        link: getField(p, ['Download_link', 'download_link', 'url']) ?? '',
        authors: getField(p, ['Authors', 'authors', 'Author']) ?? [],
        keywords: getField(p, ['Keywords', 'keywords', 'Palavras-chave']) ?? '',
        type: getField(p, ['Type', 'type', 'Tipo']) ?? 'Conference Paper',
        language: getField(p, ['Language', 'language', 'Idioma']) ?? 'Portuguese'
    }));
}

function populateFilterSelectors() {
    // Limpa e popula Edições
    const sortedEditions = [...store.editions].sort((a, b) => (b.Year || 0) - (a.Year || 0));
    sortedEditions.forEach(ed => {
        const label = ed.Year ? `${ed.Edition_id} (${ed.Year})` : `Edição ${ed.Edition_id}`;
        dom.editionFilter.add(new Option(label, ed.Edition_id));
    });
    // Popular Anos
    for (let y = 2025; y >= 2016; y--) dom.yearFilter.add(new Option(y, y));
}

// --- 5. Motor de Busca e Highlighting ---

function handleSearch() {
    const query = dom.searchInput.value.trim();
    clearError();

    if (!query) {
        store.filtered = [];
        store.currentTerms = [];
        renderEmptyState();
        updateStatus('Aguardando busca...');
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
        updateStatus(`${store.filtered.length} resultados encontrados.`);
    } catch (err) {
        showError(`Sintaxe: ${err.message}`);
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

// --- 6. Renderização e Toolbar ---

function renderResults() {
    dom.resultsContainer.innerHTML = '';

    if (store.filtered.length === 0) {
        dom.resultsToolbar.classList.add('hidden');
        dom.resultsContainer.innerHTML = `<p class="text-center py-10 text-slate-500 text-sm italic">Nenhum documento satisfaz os critérios.</p>`;
        return;
    }

    // Gerenciar Toolbar de Seleção em Massa
    dom.resultsToolbar.classList.remove('hidden');
    const allVisibleIds = store.filtered.map(p => String(p.id));
    const isAllSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => store.selected[id]);
    dom.selectAllCheckbox.checked = isAllSelected;
    dom.selectAllText.textContent = isAllSelected ? "Desmarcar todos os resultados" : `Selecionar todos os ${store.filtered.length} resultados`;

    store.filtered.forEach(paper => {
        const isSelected = store.selected[paper.id];
        const card = document.createElement('article');
        card.id = `card-${paper.id}`;
        card.className = `paper-card transition-all duration-200 ${isSelected ? 'ring-2 ring-sky-500 bg-sky-50/30 shadow-md' : ''}`;
        
        card.innerHTML = `
            <div class="paper-meta flex justify-between">
                <div>
                    <span><strong>ID:</strong> #${paper.id}</span>
                    <span class="ml-3"><strong>ANO:</strong> ${paper.year}</span>
                </div>
                ${paper.link ? `<a href="${paper.link}" target="_blank" class="text-sky-600 hover:underline font-medium">SBC OpenLib ↗</a>` : ''}
            </div>
            <h2 class="paper-title mt-2 mb-2">${highlightText(paper.title, store.currentTerms)}</h2>
            <p class="paper-abstract">${highlightText(paper.abstract, store.currentTerms)}</p>
            <div class="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2">
                <input type="checkbox" id="check-${paper.id}" class="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500 cursor-pointer" 
                       onchange="window.toggleSelection('${paper.id}')" ${isSelected ? 'checked' : ''}>
                <label for="check-${paper.id}" class="text-xs font-semibold text-slate-700 cursor-pointer select-none">
                    Selecionar para Exportação
                </label>
            </div>
        `;
        dom.resultsContainer.appendChild(card);
    });
}

function renderEmptyState() {
    dom.resultsToolbar.classList.add('hidden');
    dom.resultsContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20 text-slate-400">
            <svg class="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p class="text-sm italic">Aguardando string de busca...</p>
        </div>`;
}

// --- 7. Lógica de Seleção ---

window.toggleSelection = (id) => {
    id = String(id);
    if (store.selected[id]) delete store.selected[id];
    else store.selected[id] = true;

    // Atualização visual reativa (sem re-render total)
    const card = document.getElementById(`card-${id}`);
    if (card) {
        if (store.selected[id]) card.classList.add('ring-2', 'ring-sky-500', 'bg-sky-50/30', 'shadow-md');
        else card.classList.remove('ring-2', 'ring-sky-500', 'bg-sky-50/30', 'shadow-md');
    }
    
    // Atualiza o checkbox de "Selecionar Todos" conforme a mudança individual
    const allVisibleIds = store.filtered.map(p => String(p.id));
    dom.selectAllCheckbox.checked = allVisibleIds.every(id => store.selected[id]);

    saveSelection();
    updateStats();
};

window.toggleSelectAll = () => {
    if (store.filtered.length === 0) return;
    const allVisibleIds = store.filtered.map(p => String(p.id));
    const isAllSelected = allVisibleIds.every(id => store.selected[id]);

    if (isAllSelected) {
        allVisibleIds.forEach(id => delete store.selected[id]);
    } else {
        allVisibleIds.forEach(id => store.selected[id] = true);
    }

    saveSelection();
    renderResults();
    updateStats();
};

// --- 8. Exportação e Persistência ---

function exportCSV() {
    updateStatus('Preparando exportação Scopus...');
    
    // 1. Cabeçalhos no Padrão Scopus
    const headers = [
        "Authors", "Title", "Year", "Source title", "Link", 
        "Abstract", "Author Keywords", "Language of Original Document", "Document Type"
    ];

    // 2. Determina o que exportar: Marcados ou, se nenhum marcado, todos os retornados na busca
    const selectedIds = Object.keys(store.selected);
    const papersToExport = selectedIds.length > 0 
        ? store.filtered.filter(p => selectedIds.includes(String(p.id)))
        : store.filtered;

    if (papersToExport.length === 0) {
        showError("Nada para exportar.");
        return;
    }

    // 3. Formatação
    const csvContent = [
        headers.map(h => `"${h}"`).join(","),
        ...papersToExport.map(p => {
            const authorsStr = (p.authors && Array.isArray(p.authors)) 
                ? p.authors.map(a => a.Name || a.name || "Unknown").join("; ") 
                : "N/A";
            
            const fields = [
                authorsStr,
                p.title,
                p.year,
                "Anais do Workshop sobre Aspectos Sociais, Humanos e Econômicos de Software (WASHES)",
                p.link,
                p.abstract,
                p.keywords,
                p.language,
                p.type
            ];
            return fields.map(f => `"${String(f || '').replace(/"/g, '""')}"`).join(",");
        })
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sensusWASHES_Scopus_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    updateStatus(`Exportados ${papersToExport.length} documentos.`);
}

function exportJSON() {
    const data = { metadata: { tool: "sensus-WASHES", date: new Date() }, selected: store.selected };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sensus-backup.json`;
    a.click();
}

function updateStats() {
    if(dom.statTotal) dom.statTotal.textContent = store.corpus.length;
    if(dom.statFiltered) dom.statFiltered.textContent = store.filtered.length;
    if(dom.statSelected) dom.statSelected.textContent = Object.keys(store.selected).length;
}

function saveSelection() { localStorage.setItem('sensus_w_selection', JSON.stringify(store.selected)); }
function loadSelection() { 
    const saved = localStorage.getItem('sensus_w_selection');
    if (saved) store.selected = JSON.parse(saved); 
}

function updateStatus(m) { dom.statusBox.textContent = m; }
function showError(m) { dom.errorBox.textContent = m; dom.errorBox.classList.remove('hidden'); }
function clearError() { dom.errorBox.classList.add('hidden'); }