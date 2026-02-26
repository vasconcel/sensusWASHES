/**
 * sensus-WASHES | dataWASHES API Client
 * Responsável pela comunicação técnica com o servidor.
 * Resolve a paginação e garante o retorno correto de Metadados (Títulos/Anos).
 */

const BASE_URL = 'https://datawashes.pythonanywhere.com';

/**
 * Wrapper privado para requisições fetch.
 * Lida com formatação de JSON e desempacotamento de dados paginados.
 */
async function apiRequest(endpoint) {
    const url = `${BASE_URL}${endpoint}`;
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 
                'Accept': 'application/json' 
            }
        });

        if (!response.ok) {
            throw new Error(`Erro HTTP ${response.status} ao acessar ${endpoint}`);
        }

        const json = await response.json();
        
        // --- TRATAMENTO DE SCHEMA DA API ---
        // Se a API retornar objeto paginado { data: [...], paging: {...} }, extrai apenas o array de dados.
        // Isso acontece nos endpoints /papers/ e /editions/{id}/papers
        if (json && json.data && Array.isArray(json.data)) {
            return json.data;
        }

        // Se retornar direto um array (ex: /papers/by-year/ ou /editions/), retorna ele mesmo.
        // Se for um objeto único, transforma em array para não quebrar os mapas no ui.js.
        return Array.isArray(json) ? json : [json];

    } catch (error) {
        console.error(`[dataWASHES API Error]`, error);
        throw error;
    }
}

/**
 * Objeto unificado exportado para o ui.js consumir os dados
 */
export const API = {
    
    // --- Módulo de Artigos (Papers) ---
    papers: {
        /** 
         * Carrega o corpus completo. 
         * Usa um per_page alto (2000) para trazer todos os metadados (Títulos, Anos, Resumos) de uma vez.
         */
        getAll: () => apiRequest('/papers/?per_page=2000'),
        
        /** Filtra artigos por ano específico */
        getByYear: (year) => apiRequest(`/papers/by-year/${year}`),
        
        /** Busca detalhes de um artigo específico (para futuras expansões) */
        getById: (id) => apiRequest(`/papers/${id}`),
        
        /** Busca métricas de citações (Para análise de Snowballing em SLR) */
        getCitations: (id) => apiRequest(`/papers/${id}/citations`),
        
        /** Busca referências citadas no artigo */
        getReferences: (id) => apiRequest(`/papers/${id}/references`)
    },

    // --- Módulo de Edições (Editions) ---
    editions: {
        /** Lista todas as edições do Workshop (usado para popular o menu lateral) */
        listAll: () => apiRequest('/editions/'),
        
        /** Busca metadados de uma edição específica */
        getById: (id) => apiRequest(`/editions/${id}`),
        
        /** Lista todos os artigos de uma edição específica (com limite alto para evitar cortes) */
        getPapers: (id) => apiRequest(`/editions/${id}/papers?per_page=2000`)
    },

    // --- Módulo de Autores (Authors) ---
    authors: {
        /** Lista geral de autores paginada */
        listAll: () => apiRequest('/authors/?per_page=2000'),
        
        /** Busca autor por ID */
        getById: (id) => apiRequest(`/authors/${id}`),
        
        /** Lista a produção de um autor no WASHES */
        getPapers: (id) => apiRequest(`/authors/${id}/papers`)
    }
};