/**
 * sensus-WASHES | Boolean Search Engine (Parser)
 * Responsabilidade: Transformar strings complexas em predicados lógicos.
 * Suporta: AND, OR, NOT, (), "", e Wildcards (*)
 */

/**
 * Ponto de entrada principal
 * @param {string} searchString 
 * @returns {{predicate: function, terms: Array}}
 */
export function buildPredicate(searchString) {
    if (!searchString || typeof searchString !== 'string') {
        throw new Error('String de busca inválida.');
    }

    const normalized = normalizeQuery(searchString);
    validateParentheses(normalized);

    const tokens = tokenize(normalized);
    const ast = parseExpression(tokens);

    if (tokens.length > 0) {
        throw new Error('Erro de sintaxe: Verifique o final da sua string de busca.');
    }

    return {
        predicate: buildEvaluator(ast),
        terms: extractTermsFromAst(ast) // Para uso no Highlighter do UI
    };
}

/* =========================================================
 * 1. Lexer / Tokenizer
 * ======================================================= */

function tokenize(input) {
    const tokens = [];
    let i = 0;

    while (i < input.length) {
        const char = input[i];

        if (/\s/.test(char)) { i++; continue; }

        if (char === '(' || char === ')') {
            tokens.push({ type: char });
            i++;
            continue;
        }

        // Frases entre aspas: "software engineering"
        if (char === '"') {
            let j = i + 1;
            let phrase = '';
            while (j < input.length && input[j] !== '"') {
                phrase += input[j++];
            }
            if (j >= input.length) throw new Error('Aspas não fechadas.');
            tokens.push({ type: 'TERM', value: phrase });
            i = j + 1;
            continue;
        }

        // Operadores Lógicos
        const opMatch = input.slice(i).match(/^(AND|OR|NOT)\b/i);
        if (opMatch) {
            tokens.push({ type: opMatch[1].toUpperCase() });
            i += opMatch[0].length;
            continue;
        }

        // Termos simples e Wildcards: softw*
        let termMatch = input.slice(i).match(/^[^\s()"]+/);
        if (termMatch) {
            tokens.push({ type: 'TERM', value: termMatch[0] });
            i += termMatch[0].length;
            continue;
        }

        throw new Error(`Caractere inesperado na posição ${i}: ${char}`);
    }
    return tokens;
}

/* =========================================================
 * 2. Parser (Recursive Descent)
 * Grammar:
 *   Expr -> AndExpr (OR AndExpr)*
 *   AndExpr -> NotExpr (AND NotExpr)*
 *   NotExpr -> NOT? Primary
 *   Primary -> TERM | ( Expr )
 * ======================================================= */

function parseExpression(tokens) { return parseOr(tokens); }

function parseOr(tokens) {
    let node = parseAnd(tokens);
    while (tokens[0]?.type === 'OR') {
        tokens.shift();
        node = { type: 'OR', left: node, right: parseAnd(tokens) };
    }
    return node;
}

function parseAnd(tokens) {
    let node = parseNot(tokens);
    while (tokens[0]?.type === 'AND') {
        tokens.shift();
        node = { type: 'AND', left: node, right: parseNot(tokens) };
    }
    return node;
}

function parseNot(tokens) {
    if (tokens[0]?.type === 'NOT') {
        tokens.shift();
        return { type: 'NOT', expr: parseNot(tokens) };
    }
    return parsePrimary(tokens);
}

function parsePrimary(tokens) {
    const token = tokens.shift();
    if (!token) throw new Error('Expressão incompleta.');

    if (token.type === 'TERM') return { type: 'TERM', value: token.value };

    if (token.type === '(') {
        const expr = parseExpression(tokens);
        if (tokens.shift()?.type !== ')') throw new Error('Parênteses não fechados.');
        return expr;
    }

    throw new Error(`Erro de sintaxe: Token inesperado ${token.type}`);
}

/* =========================================================
 * 3. Evaluator (The Predicate Builder)
 * ======================================================= */

function buildEvaluator(node) {
    switch (node.type) {
        case 'TERM': {
            const regex = wildcardToRegex(node.value);
            return text => regex.test(text);
        }
        case 'AND': {
            const left = buildEvaluator(node.left);
            const right = buildEvaluator(node.right);
            return text => left(text) && right(text);
        }
        case 'OR': {
            const left = buildEvaluator(node.left);
            const right = buildEvaluator(node.right);
            return text => left(text) || right(text);
        }
        case 'NOT': {
            const expr = buildEvaluator(node.expr);
            return text => !expr(text);
        }
    }
}

/* =========================================================
 * 4. Utilities
 * ======================================================= */

function normalizeQuery(str) {
    return str.replace(/[“”]/g, '"').trim();
}

function validateParentheses(str) {
    let b = 0;
    for (const c of str) {
        if (c === '(') b++;
        if (c === ')') b--;
        if (b < 0) throw new Error('Parênteses fechados incorretamente.');
    }
    if (b !== 0) throw new Error('Parênteses não balanceados.');
}

/**
 * Converte asterisco em regex mantendo a segurança
 */
function wildcardToRegex(term) {
    const escaped = term.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const pattern = escaped.replace(/\*/g, '.*');
    return new RegExp(`\\b${pattern}`, 'i'); 
}

/**
 * Extrai termos das folhas da árvore para o Highlighter
 */
function extractTermsFromAst(node, list = []) {
    if (node.type === 'TERM') list.push(node.value.replace(/\*/g, ''));
    if (node.left) extractTermsFromAst(node.left, list);
    if (node.right) extractTermsFromAst(node.right, list);
    if (node.expr) extractTermsFromAst(node.expr, list);
    return [...new Set(list)]; // Retorna termos únicos
}