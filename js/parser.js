/**
 * LL(1) Parser Engine
 * Handles grammar parsing, validation, FIRST/FOLLOW set computation,
 * LL(1) table construction, tokenization, and step-by-step parser simulation.
 */

class LL1Parser {
  constructor() {
    this.reset();
  }

  reset() {
    this.rawGrammar = "";
    this.rules = {}; // LHS -> Array of RHS arrays (e.g., {"E": [["T", "E'"]]})
    this.nonTerminals = new Set();
    this.terminals = new Set();
    this.startSymbol = null;
    this.firstSets = {};  // Symbol -> Set of terminals/epsilon
    this.followSets = {}; // NonTerminal -> Set of terminals/$
    this.parsingTable = {}; // NonTerminal -> { Terminal: productionIndex }
    this.errors = [];
    this.warnings = [];
    this.isLL1 = true;
    this.leftmostSets = {}; // For left recursion checking
  }

  /**
   * Parse a grammar string.
   * Format:
   * E -> T E'
   * E' -> + T E' | e
   */
  parseGrammar(grammarStr) {
    this.reset();
    this.rawGrammar = grammarStr;

    const lines = grammarStr.split('\n');
    let firstLHS = null;

    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const line = lines[lineNo].trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;

      // Split LHS and RHS
      const parts = line.split(/->|→|=/);
      if (parts.length < 2) {
        this.errors.push(`Line ${lineNo + 1}: Invalid format. Expected 'A -> alpha'.`);
        continue;
      }

      const lhs = parts[0].trim();
      if (!lhs) {
        this.errors.push(`Line ${lineNo + 1}: Left-hand side is empty.`);
        continue;
      }

      if (lhs.includes(' ')) {
        this.warnings.push(`Line ${lineNo + 1}: LHS '${lhs}' contains spaces. Usually LHS should be a single symbol.`);
      }

      if (!firstLHS) {
        firstLHS = lhs;
        this.startSymbol = lhs;
      }

      this.nonTerminals.add(lhs);

      const rhsRaw = parts.slice(1).join('->').trim();
      const productions = rhsRaw.split('|');

      if (!this.rules[lhs]) {
        this.rules[lhs] = [];
      }

      for (let prod of productions) {
        prod = prod.trim();
        // Split by whitespace to get individual symbols
        const symbols = prod.split(/\s+/).filter(s => s.length > 0).map(s => {
          // Normalize epsilon
          if (s === 'e' || s === 'ε' || s === 'epsilon' || s === 'λ') {
            return 'ε';
          }
          return s;
        });

        if (symbols.length === 0) {
          // Empty production is treated as epsilon
          this.rules[lhs].push(['ε']);
        } else {
          this.rules[lhs].push(symbols);
        }
      }
    }

    if (this.errors.length > 0) {
      return false;
    }

    if (!this.startSymbol) {
      this.errors.push("No valid production rules found.");
      return false;
    }

    // Infer terminals
    for (const lhs in this.rules) {
      for (const prod of this.rules[lhs]) {
        for (const sym of prod) {
          if (sym !== 'ε' && !this.nonTerminals.has(sym)) {
            this.terminals.add(sym);
          }
        }
      }
    }

    this.computeFirstSets();
    this.computeFollowSets();
    this.validateGrammar();
    this.buildParsingTable();

    return this.errors.length === 0;
  }

  /**
   * Calculate FIRST sets for all symbols.
   */
  computeFirstSets() {
    // Initialize empty sets for non-terminals
    for (const nt of this.nonTerminals) {
      this.firstSets[nt] = new Set();
    }

    let changed = true;
    let iterations = 0;
    const maxIterations = 100;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const lhs in this.rules) {
        for (const prod of this.rules[lhs]) {
          const firstOfProd = this.getFirstOfSequence(prod);
          const sizeBefore = this.firstSets[lhs].size;

          for (const sym of firstOfProd) {
            this.firstSets[lhs].add(sym);
          }

          if (this.firstSets[lhs].size > sizeBefore) {
            changed = true;
          }
        }
      }
    }
  }

  /**
   * Helper to get FIRST set of a sequence of symbols.
   */
  getFirstOfSequence(symbols) {
    const firstSet = new Set();
    if (symbols.length === 0) {
      firstSet.add('ε');
      return firstSet;
    }

    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i];

      if (sym === 'ε') {
        firstSet.add('ε');
        break;
      }

      if (this.terminals.has(sym)) {
        firstSet.add(sym);
        break;
      }

      // It's a non-terminal
      const symFirst = this.firstSets[sym];
      if (!symFirst) {
        // Fallback for symbols that have no production
        firstSet.add(sym);
        break;
      }

      let hasEpsilon = false;
      for (const f of symFirst) {
        if (f === 'ε') {
          hasEpsilon = true;
        } else {
          firstSet.add(f);
        }
      }

      // If this symbol doesn't derive epsilon, we stop
      if (!hasEpsilon) {
        break;
      }

      // If we are at the last symbol and all derived epsilon, add epsilon
      if (i === symbols.length - 1) {
        firstSet.add('ε');
      }
    }

    return firstSet;
  }

  /**
   * Calculate FOLLOW sets for all non-terminals.
   */
  computeFollowSets() {
    for (const nt of this.nonTerminals) {
      this.followSets[nt] = new Set();
    }

    // Start symbol gets $
    if (this.startSymbol) {
      this.followSets[this.startSymbol].add('$');
    }

    let changed = true;
    let iterations = 0;
    const maxIterations = 100;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const lhs in this.rules) {
        for (const prod of this.rules[lhs]) {
          for (let i = 0; i < prod.length; i++) {
            const B = prod[i];

            if (!this.nonTerminals.has(B)) continue;

            const beta = prod.slice(i + 1);
            const firstBeta = this.getFirstOfSequence(beta);
            const sizeBefore = this.followSets[B].size;

            // Rule 2: If A -> a B b, then FIRST(b) (except epsilon) is in FOLLOW(B)
            for (const sym of firstBeta) {
              if (sym !== 'ε') {
                this.followSets[B].add(sym);
              }
            }

            // Rule 3: If A -> a B or A -> a B b where FIRST(b) contains epsilon,
            // then FOLLOW(A) is in FOLLOW(B)
            if (firstBeta.has('ε') || beta.length === 0) {
              const followLHS = this.followSets[lhs];
              for (const sym of followLHS) {
                this.followSets[B].add(sym);
              }
            }

            if (this.followSets[B].size > sizeBefore) {
              changed = true;
            }
          }
        }
      }
    }
  }

  /**
   * Check for grammar violations: Left Recursion, Left Factoring.
   */
  validateGrammar() {
    // 1. Check for Left Recursion (Direct and Indirect)
    // Build Leftmost dependency
    this.leftmostSets = {};
    for (const nt of this.nonTerminals) {
      this.leftmostSets[nt] = new Set();
    }

    // Direct dependencies
    for (const lhs in this.rules) {
      for (const prod of this.rules[lhs]) {
        for (const sym of prod) {
          if (this.nonTerminals.has(sym)) {
            this.leftmostSets[lhs].add(sym);
          }
          // If sym cannot derive epsilon, stop looking at subsequent symbols
          if (sym === 'ε' || !this.firstSets[sym] || !this.firstSets[sym].has('ε')) {
            break;
          }
        }
      }
    }

    // Transitive closure (Warshall's algorithm style)
    let changed = true;
    while (changed) {
      changed = false;
      for (const nt of this.nonTerminals) {
        const sizeBefore = this.leftmostSets[nt].size;
        for (const dep of Array.from(this.leftmostSets[nt])) {
          for (const transDep of this.leftmostSets[dep]) {
            this.leftmostSets[nt].add(transDep);
          }
        }
        if (this.leftmostSets[nt].size > sizeBefore) {
          changed = true;
        }
      }
    }

    // Check cycles
    for (const nt of this.nonTerminals) {
      if (this.leftmostSets[nt].has(nt)) {
        // Left recursion detected!
        // Check if direct
        let isDirect = false;
        for (const prod of this.rules[nt]) {
          if (prod[0] === nt) {
            isDirect = true;
            break;
          }
        }
        if (isDirect) {
          this.warnings.push(`Direct left recursion detected in Non-Terminal '${nt}'.`);
        } else {
          // Trace cycle
          this.warnings.push(`Indirect left recursion detected involving Non-Terminal '${nt}'.`);
        }
      }
    }

    // 2. Check for Left Factoring
    for (const nt of this.nonTerminals) {
      const prods = this.rules[nt];
      const prefixes = {};
      for (const prod of prods) {
        const firstSym = prod[0];
        if (!firstSym) continue;
        if (!prefixes[firstSym]) {
          prefixes[firstSym] = 0;
        }
        prefixes[firstSym]++;
      }
      for (const sym in prefixes) {
        if (prefixes[sym] > 1 && sym !== 'ε') {
          this.warnings.push(`Left-factoring warning: Non-Terminal '${nt}' has multiple rules starting with '${sym}'.`);
        }
      }
    }
  }

  /**
   * Build the LL(1) parsing table.
   */
  buildParsingTable() {
    this.isLL1 = true;
    this.parsingTable = {};

    for (const nt of this.nonTerminals) {
      this.parsingTable[nt] = {};
      for (const t of this.terminals) {
        this.parsingTable[nt][t] = [];
      }
      this.parsingTable[nt]['$'] = [];
    }

    for (const lhs in this.rules) {
      const productions = this.rules[lhs];
      for (let idx = 0; idx < productions.length; idx++) {
        const prod = productions[idx];
        const firstProd = this.getFirstOfSequence(prod);

        // Rule 1: For each terminal a in FIRST(alpha), add A -> alpha to M[A, a]
        for (const a of firstProd) {
          if (a !== 'ε') {
            this.parsingTable[lhs][a].push({ index: idx, rhs: prod });
          }
        }

        // Rule 2: If epsilon is in FIRST(alpha), for each terminal b in FOLLOW(A), add A -> alpha to M[A, b]
        if (firstProd.has('ε')) {
          const followLHS = this.followSets[lhs];
          for (const b of followLHS) {
            this.parsingTable[lhs][b].push({ index: idx, rhs: prod });
          }
        }
      }
    }

    // Check for LL(1) table conflicts
    for (const nt in this.parsingTable) {
      for (const t in this.parsingTable[nt]) {
        if (this.parsingTable[nt][t].length > 1) {
          this.isLL1 = false;
          // We don't block visualizer parsing if user wants to try it,
          // but we highlight conflicts.
        }
      }
    }

    if (!this.isLL1) {
      this.warnings.push("Grammar is NOT LL(1) because of parsing table conflicts (cells with multiple productions).");
    }
  }

  /**
   * Tokenize input string.
   * Matches terminals in a greedy manner.
   */
  tokenize(inputStr) {
    const tokens = [];
    let position = 0;
    const errors = [];

    // Sort terminals by length descending to match longer terminals first (e.g. 'id' before 'i')
    const sortedTerminals = Array.from(this.terminals).sort((a, b) => b.length - a.length);

    while (position < inputStr.length) {
      // Skip whitespace
      if (/\s/.test(inputStr[position])) {
        position++;
        continue;
      }

      let matched = false;
      for (const term of sortedTerminals) {
        if (inputStr.slice(position, position + term.length) === term) {
          tokens.push({
            value: term,
            start: position,
            end: position + term.length
          });
          position += term.length;
          matched = true;
          break;
        }
      }

      if (!matched) {
        // Lexical error: unsupported symbol
        let errorChar = inputStr[position];
        errors.push({
          message: `Lexical error: Unexpected character '${errorChar}' at position ${position + 1}`,
          position: position
        });
        position++; // Advance to prevent infinite loop
      }
    }

    return { tokens, errors };
  }

  /**
   * Initialize a new step-by-step simulator execution.
   */
  initSimulator(inputString) {
    const lexResult = this.tokenize(inputString);
    if (lexResult.errors.length > 0) {
      return {
        success: false,
        errors: lexResult.errors.map(e => e.message)
      };
    }

    const tokens = lexResult.tokens.map(t => t.value);
    tokens.push('$'); // End marker

    // Create root tree node
    const rootNode = {
      id: 0,
      symbol: this.startSymbol,
      children: [],
      parent: null,
      stepCreated: 0,
      stepMatched: null,
      stepExpanded: null,
      isLeaf: !this.nonTerminals.has(this.startSymbol)
    };

    const initialStack = [
      { symbol: '$', treeNode: null },
      { symbol: this.startSymbol, treeNode: rootNode }
    ];

    const allTreeNodes = [rootNode];
    let nextNodeId = 1;

    // Simulation history state
    const history = [];
    const initialState = {
      step: 0,
      stack: initialStack.map(item => ({ ...item })),
      inputIndex: 0,
      action: "Initialize parser",
      status: "parsing", // parsing, accepted, rejected
      details: "Initialized parser stack with $ and start symbol.",
      treeNodesSnapshot: JSON.parse(JSON.stringify(allTreeNodes))
    };

    history.push(initialState);

    return {
      success: true,
      tokens: tokens,
      history: history,
      allTreeNodes: allTreeNodes,
      nextNodeId: nextNodeId
    };
  }

  /**
   * Run one step of LL(1) parsing.
   * Returns the new state object.
   */
  nextStep(currentState, tokens, allTreeNodes, nextNodeIdObj) {
    if (currentState.status !== "parsing") {
      return currentState; // Already finished
    }

    const step = currentState.step + 1;
    const stack = currentState.stack.map(item => ({ ...item })); // Clone
    const inputIndex = currentState.inputIndex;
    const currentInput = tokens[inputIndex];

    if (stack.length === 0) {
      return {
        step,
        stack,
        inputIndex,
        action: "Error",
        status: "rejected",
        details: "Stack is empty, but input remains.",
        treeNodesSnapshot: JSON.parse(JSON.stringify(allTreeNodes))
      };
    }

    const top = stack[stack.length - 1];
    const topSymbol = top.symbol;

    // Case 1: Match end of input
    if (topSymbol === '$' && currentInput === '$') {
      stack.pop();
      return {
        step,
        stack,
        inputIndex: inputIndex + 1,
        action: "Accept",
        status: "accepted",
        details: "Stack and input are both empty. String accepted!",
        treeNodesSnapshot: JSON.parse(JSON.stringify(allTreeNodes))
      };
    }

    // Case 2: Terminal match
    if (this.terminals.has(topSymbol)) {
      if (topSymbol === currentInput) {
        stack.pop();
        // Mark tree node as matched
        if (top.treeNode) {
          const node = allTreeNodes.find(n => n.id === top.treeNode.id);
          if (node) {
            node.stepMatched = step;
          }
        }
        return {
          step,
          stack,
          inputIndex: inputIndex + 1,
          action: `Match '${topSymbol}'`,
          status: "parsing",
          details: `Successfully matched terminal '${topSymbol}'.`,
          treeNodesSnapshot: JSON.parse(JSON.stringify(allTreeNodes))
        };
      } else {
        // Mismatch error
        if (top.treeNode) {
          const node = allTreeNodes.find(n => n.id === top.treeNode.id);
          if (node) node.status = 'error';
        }
        return {
          step,
          stack,
          inputIndex,
          action: "Error (Mismatch)",
          status: "rejected",
          details: `Mismatch error: expected '${topSymbol}', but got '${currentInput}'.`,
          treeNodesSnapshot: JSON.parse(JSON.stringify(allTreeNodes))
        };
      }
    }

    // Case 3: Non-Terminal expansion
    if (this.nonTerminals.has(topSymbol)) {
      const cell = this.parsingTable[topSymbol][currentInput];

      if (!cell || cell.length === 0) {
        // No parse table entry
        if (top.treeNode) {
          const node = allTreeNodes.find(n => n.id === top.treeNode.id);
          if (node) node.status = 'error';
        }
        return {
          step,
          stack,
          inputIndex,
          action: "Error (No entry)",
          status: "rejected",
          details: `Parsing error: No entry in Table[${topSymbol}, ${currentInput}].`,
          treeNodesSnapshot: JSON.parse(JSON.stringify(allTreeNodes))
        };
      }

      if (cell.length > 1) {
        // Table conflict
        return {
          step,
          stack,
          inputIndex,
          action: "Error (Conflict)",
          status: "rejected",
          details: `Conflict error: Multiple entries in Table[${topSymbol}, ${currentInput}] - Ambiguous Grammar!`,
          treeNodesSnapshot: JSON.parse(JSON.stringify(allTreeNodes))
        };
      }

      // Valid expansion
      const prodIdx = cell[0].index;
      const rhs = cell[0].rhs;

      // Pop the non-terminal
      stack.pop();

      // Mark the popped node as expanded in this step
      const parentNode = allTreeNodes.find(n => n.id === top.treeNode.id);
      if (parentNode) {
        parentNode.stepExpanded = step;
      }

      // Create child nodes and push to stack in reverse order
      const newChildren = [];
      const stackItemsToPush = [];

      for (let i = 0; i < rhs.length; i++) {
        const symbol = rhs[i];
        const childNode = {
          id: nextNodeIdObj.val++,
          symbol: symbol,
          children: [],
          parent: parentNode ? parentNode.id : null,
          stepCreated: step,
          stepMatched: symbol === 'ε' ? step : null, // Epsilon is matched immediately
          stepExpanded: null,
          isLeaf: symbol === 'ε' || !this.nonTerminals.has(symbol)
        };
        allTreeNodes.push(childNode);
        newChildren.push(childNode.id);

        if (symbol !== 'ε') {
          stackItemsToPush.push({ symbol: symbol, treeNode: childNode });
        }
      }

      if (parentNode) {
        parentNode.children = newChildren;
      }

      // Push items in reverse order onto the stack so that left-most is on top
      for (let i = stackItemsToPush.length - 1; i >= 0; i--) {
        stack.push(stackItemsToPush[i]);
      }

      const prodString = `${topSymbol} -> ${rhs.join(' ')}`;

      return {
        step,
        stack,
        inputIndex,
        action: `Expand ${prodString}`,
        status: "parsing",
        details: `Expanded non-terminal '${topSymbol}' using production: ${prodString}.`,
        treeNodesSnapshot: JSON.parse(JSON.stringify(allTreeNodes))
      };
    }

    // Edge case error (unknown stack symbol)
    return {
      step,
      stack,
      inputIndex,
      action: "Error",
      status: "rejected",
      details: `Unexpected symbol on stack: '${topSymbol}'`,
      treeNodesSnapshot: JSON.parse(JSON.stringify(allTreeNodes))
    };
  }
}

// Export class for browser environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LL1Parser;
} else {
  window.LL1Parser = LL1Parser;
}
