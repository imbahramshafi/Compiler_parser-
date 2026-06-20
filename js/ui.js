/**
 * LL(1) Parser Visualizer - UI Controller
 * 5-Step workflow: Left Recursion → FIRST/FOLLOW → Parse Table → Stack → Parse Tree
 */

document.addEventListener("DOMContentLoaded", () => {

  // ── Core Instances ──
  const parser = new LL1Parser();
  const treeVisualizer = new ParseTreeVisualizer("tree-svg-container", "svg-tree-wrapper");

  // ── DOM Elements ──
  const grammarInput       = document.getElementById("grammar-input");
  const btnParseGrammar    = document.getElementById("btn-parse-grammar");
  const fileGrammarUpload  = document.getElementById("file-grammar-upload");
  const btnGrammarDownload = document.getElementById("btn-grammar-download");
  const diagnosticsLog     = document.getElementById("diagnostics-log");

  const firstSetsTable   = document.getElementById("first-sets-table");
  const followSetsTable  = document.getElementById("follow-sets-table");
  const parsingTableView = document.getElementById("parsing-table-view");
  const tableLL1Status   = document.getElementById("table-ll1-status");

  const stringInput        = document.getElementById("string-input");
  const btnInitSim         = document.getElementById("btn-init-sim");
  const simulatorWorkspace = document.getElementById("simulator-workspace");
  const btnSimReset        = document.getElementById("btn-sim-reset");
  const btnSimPrev         = document.getElementById("btn-sim-prev");
  const btnSimPlay         = document.getElementById("btn-sim-play");
  const btnSimNext         = document.getElementById("btn-sim-next");
  const simSpeed           = document.getElementById("sim-speed");
  const simStatusAlert     = document.getElementById("sim-status-alert");
  const stackTraceView     = document.getElementById("stack-trace-view");
  const simDetailsBox      = document.getElementById("sim-details-box");

  const btnTreeZoomIn      = document.getElementById("btn-tree-zoom-in");
  const btnTreeZoomOut     = document.getElementById("btn-tree-zoom-out");
  const btnTreeReset       = document.getElementById("btn-tree-reset");
  const btnGenerateTree    = document.getElementById("btn-generate-tree");
  const btnGenerateTreeAgain = document.getElementById("btn-generate-tree-again");
  const treePlaceholder    = document.getElementById("tree-placeholder");
  const treeCanvasArea     = document.getElementById("tree-canvas-area");

  // Step Pills
  const pills = [1,2,3,4,5].map(n => document.getElementById(`pill-${n}`));

  // Speed slider: higher position = faster = smaller delay
  // slider range 200–2000, invert so max slider = min delay
  function getSpeedDelay() {
    const min = +simSpeed.min, max = +simSpeed.max;
    return min + max - +simSpeed.value;
  }

  // ── Simulator State ──
  let simTokens = [];
  let simHistory = [];
  let simCurrentIndex = 0;
  let simTreeNodes = [];
  let simNextNodeId = { val: 1 };
  let playInterval = null;

  // ── Default Grammar on Load ──
  grammarInput.value =
`E  -> T E'
E' -> + T E' | ε
T  -> F T'
T' -> * F T' | ε
F  -> ( E ) | id`;

  parseAndBuildUI(); // Auto-run on load

  // ══════════════════════════════════════
  //  EVENT LISTENERS
  // ══════════════════════════════════════

  btnParseGrammar.addEventListener("click", () => parseAndBuildUI());

  fileGrammarUpload.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      grammarInput.value = evt.target.result;
      parseAndBuildUI();
    };
    reader.readAsText(file);
  });

  btnGrammarDownload.addEventListener("click", () => {
    const blob = new Blob([grammarInput.value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cfg_grammar.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  btnInitSim.addEventListener("click",  () => initializeSimulatorUI());
  btnSimNext.addEventListener("click",  () => stepForward());
  btnSimPrev.addEventListener("click",  () => stepBackward());
  btnSimReset.addEventListener("click", () => resetSimulatorState());
  btnSimPlay.addEventListener("click",  () => toggleSimulationPlayback());

  simSpeed.addEventListener("input", () => {
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = setInterval(stepForward, getSpeedDelay());
    }
  });

  btnTreeZoomIn.addEventListener("click",  () => { treeVisualizer.zoomScale *= 1.25; treeVisualizer.applyTransform(); });
  btnTreeZoomOut.addEventListener("click", () => { treeVisualizer.zoomScale /= 1.25; treeVisualizer.applyTransform(); });
  btnTreeReset.addEventListener("click",   () => treeVisualizer.resetZoom());

  btnGenerateTree.addEventListener("click",      () => showTreeCanvas());
  btnGenerateTreeAgain.addEventListener("click",  () => { treeVisualizer.render(simTreeNodes, simHistory[simCurrentIndex].step, simHistory[simCurrentIndex].stack); treeVisualizer.resetZoom(); });

  window.addEventListener("keydown", (e) => {
    if (simulatorWorkspace.style.display === "none") return;
    if (e.key === "ArrowRight") stepForward();
    else if (e.key === "ArrowLeft") stepBackward();
    else if (e.key === " ") { e.preventDefault(); toggleSimulationPlayback(); }
  });

  // ══════════════════════════════════════
  //  STEP PILL HIGHLIGHTER
  // ══════════════════════════════════════

  function activateStep(stepNum) {
    pills.forEach((pill, i) => {
      pill.classList.remove("active", "done");
      if (i + 1 < stepNum) pill.classList.add("done");
      else if (i + 1 === stepNum) pill.classList.add("active");
    });

    // Scroll the matching step panel into view smoothly
    const panel = document.getElementById(`step-panel-${stepNum}`);
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ══════════════════════════════════════
  //  STEP 1 + 2 + 3: Parse Grammar & Build Tables
  // ══════════════════════════════════════

  function parseAndBuildUI() {
    activateStep(1);

    const rawInput = grammarInput.value;
    const success = parser.parseGrammar(rawInput);

    // ── STEP 1: Left Recursion & Diagnostics ──
    diagnosticsLog.innerHTML = "";

    if (parser.errors.length > 0) {
      parser.errors.forEach(err => {
        diagnosticsLog.innerHTML += `
          <div class="diag-item error">
            <i class="fa-solid fa-circle-xmark"></i>
            <span>${err}</span>
          </div>`;
      });
      clearTables();
      disableSimulator();
      return;
    }

    // Check for left recursion specifically
    let hasLeftRecursion = false;
    parser.warnings.forEach(warn => {
      const isLR = warn.toLowerCase().includes("left recursion");
      hasLeftRecursion = hasLeftRecursion || isLR;
      diagnosticsLog.innerHTML += `
        <div class="diag-item ${isLR ? 'error' : 'warning'}">
          <i class="fa-solid fa-${isLR ? 'circle-xmark' : 'circle-exclamation'}"></i>
          <span>${warn}</span>
        </div>`;
    });

    if (hasLeftRecursion) {
      clearTables();
      disableSimulator();
      return;
    }

    diagnosticsLog.innerHTML += `
      <div class="diag-item success">
        <i class="fa-solid fa-circle-check"></i>
        <span>No left recursion detected. Grammar structure is valid for top-down parsing.</span>
      </div>`;

    diagnosticsLog.innerHTML += `
      <div class="diag-item success">
        <i class="fa-solid fa-circle-check"></i>
        <span>Grammar parsed: <strong>${parser.nonTerminals.size}</strong> Non-Terminals, 
        <strong>${parser.terminals.size}</strong> Terminals. 
        Start Symbol: <strong>${parser.startSymbol}</strong></span>
      </div>`;

    // ── STEP 2: FIRST & FOLLOW Sets ──
    activateStep(2);
    renderFirstAndFollowSets();

    // ── STEP 3: Parsing Table ──
    activateStep(3);
    renderParsingTable();

    // ── STEP 4: Ready for simulation ──
    enableSimulator();
  }

  // ══════════════════════════════════════
  //  TABLE RENDERERS
  // ══════════════════════════════════════

  function clearTables() {
    firstSetsTable.querySelector("tbody").innerHTML  = `<tr><td colspan="2" class="table-empty">No grammar parsed.</td></tr>`;
    followSetsTable.querySelector("tbody").innerHTML = `<tr><td colspan="2" class="table-empty">No grammar parsed.</td></tr>`;
    parsingTableView.innerHTML = `<tr><td colspan="2" class="table-empty">Parse a valid grammar first.</td></tr>`;
    tableLL1Status.textContent = "Pending";
    tableLL1Status.removeAttribute("style");
  }

  function renderFirstAndFollowSets() {
    const firstBody  = firstSetsTable.querySelector("tbody");
    const followBody = followSetsTable.querySelector("tbody");
    firstBody.innerHTML  = "";
    followBody.innerHTML = "";

    for (const nt of parser.nonTerminals) {
      const f = Array.from(parser.firstSets[nt]).join(", ");
      firstBody.innerHTML += `
        <tr>
          <td>${nt}</td>
          <td><span class="set-values-badge">{ ${f} }</span></td>
        </tr>`;

      const fw = Array.from(parser.followSets[nt]).join(", ");
      followBody.innerHTML += `
        <tr>
          <td>${nt}</td>
          <td><span class="set-values-badge">{ ${fw} }</span></td>
        </tr>`;
    }
  }

  function renderParsingTable() {
    const sortedTerminals = [...Array.from(parser.terminals).sort(), "$"];

    let html = `<thead><tr><th>M[A, a]</th>`;
    sortedTerminals.forEach(t => { html += `<th>${t}</th>`; });
    html += `</tr></thead><tbody>`;

    for (const nt of parser.nonTerminals) {
      html += `<tr><td>${nt}</td>`;
      sortedTerminals.forEach(t => {
        const cell = parser.parsingTable[nt][t];
        html += `<td>`;
        if (cell && cell.length > 0) {
          cell.forEach(prod => {
            const cls = cell.length > 1 ? "table-cell-conflict" : "table-cell-prod";
            html += `<span class="${cls}">${nt} &rarr; ${prod.rhs.join(" ")}</span>`;
          });
        } else {
          html += `<span style="color:var(--text-muted);">&mdash;</span>`;
        }
        html += `</td>`;
      });
      html += `</tr>`;
    }
    html += `</tbody>`;
    parsingTableView.innerHTML = html;

    // Status badge
    if (parser.isLL1) {
      tableLL1Status.textContent = "LL(1) Compliant ✓";
      tableLL1Status.style.cssText = "background:rgba(16,185,129,0.15);color:#34D399;border:1px solid var(--accent-emerald);";
    } else {
      tableLL1Status.textContent = "Conflict Detected ✗";
      tableLL1Status.style.cssText = "background:rgba(244,63,94,0.15);color:#FB7185;border:1px solid var(--accent-rose);";
    }
  }

  // ══════════════════════════════════════
  //  SIMULATOR HELPERS
  // ══════════════════════════════════════

  function showTreeCanvas() {
    treePlaceholder.style.display = "none";
    treeCanvasArea.style.display  = "flex";
    treeVisualizer.render(simTreeNodes, simHistory[simCurrentIndex].step, simHistory[simCurrentIndex].stack);
    treeVisualizer.resetZoom();
  }

  function hideTreeCanvas() {
    treeCanvasArea.style.display  = "none";
    treePlaceholder.style.display = "flex";
    btnGenerateTree.setAttribute("disabled", "true");
  }

  function enableSimulator() {
    btnInitSim.removeAttribute("disabled");
    stringInput.removeAttribute("disabled");
  }

  function disableSimulator() {
    btnInitSim.setAttribute("disabled", "true");
    stringInput.setAttribute("disabled", "true");
    simulatorWorkspace.style.display = "none";
    hideTreeCanvas();
    stopPlayback();
  }

  // ══════════════════════════════════════
  //  STEP 4: Simulation
  // ══════════════════════════════════════

  function initializeSimulatorUI() {
    stopPlayback();
    const inputVal = stringInput.value.trim();
    if (!inputVal) { alert("Please enter a string to parse."); return; }

    const initResult = parser.initSimulator(inputVal);
    if (!initResult.success) {
      alert(`Lexical Error:\n${initResult.errors.join("\n")}`);
      return;
    }

    simTokens       = initResult.tokens;
    simHistory      = initResult.history;
    simTreeNodes    = initResult.allTreeNodes;
    simNextNodeId   = { val: initResult.nextNodeId };
    simCurrentIndex = 0;

    simulatorWorkspace.style.display = "flex";
    stackTraceView.querySelector("tbody").innerHTML = "";
    hideTreeCanvas();
    updateSimGUI();

    // Activate step 4 pill
    activateStep(4);
  }

  function stepForward() {
    const state = simHistory[simCurrentIndex];
    if (state.status !== "parsing") { stopPlayback(); return; }

    if (simCurrentIndex === simHistory.length - 1) {
      simHistory.push(parser.nextStep(state, simTokens, simTreeNodes, simNextNodeId));
    }

    simCurrentIndex++;
    updateSimGUI();

    // When accepted/rejected, enable tree generation and activate step 5
    if (simHistory[simCurrentIndex].status !== "parsing") {
      stopPlayback();
      btnGenerateTree.removeAttribute("disabled");
      activateStep(5);
    }
  }

  function stepBackward() {
    if (simCurrentIndex > 0) {
      simCurrentIndex--;
      updateSimGUI();
      stopPlayback();
      activateStep(4);
    }
  }

  function resetSimulatorState() {
    stopPlayback();
    simCurrentIndex = 0;
    simHistory = [simHistory[0]];
    simTreeNodes.forEach(node => {
      if (node.id === 0) {
        node.children = [];
        node.stepExpanded = null;
        node.stepMatched = null;
        node.status = "pending";
      }
    });
    simTreeNodes.length = 1;
    simNextNodeId.val = 1;
    hideTreeCanvas();
    updateSimGUI();
    activateStep(4);
  }

  function toggleSimulationPlayback() {
    if (playInterval) {
      stopPlayback();
    } else {
      btnSimPlay.innerHTML = `<i class="fa-solid fa-pause"></i> Pause`;
      btnSimPlay.classList.replace("btn-primary", "btn-secondary");
      playInterval = setInterval(stepForward, getSpeedDelay());
    }
  }

  function stopPlayback() {
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = null;
      btnSimPlay.innerHTML = `<i class="fa-solid fa-play"></i> Play`;
      btnSimPlay.classList.replace("btn-secondary", "btn-primary");
    }
  }

  // ══════════════════════════════════════
  //  GUI SYNC
  // ══════════════════════════════════════

  function updateSimGUI() {
    const state = simHistory[simCurrentIndex];

    btnSimPrev.disabled = (simCurrentIndex === 0);
    btnSimNext.disabled = (state.status !== "parsing");

    simStatusAlert.textContent = `${state.status.toUpperCase()}: Step ${state.step}`;
    simStatusAlert.className   = `status-alert ${state.status}`;
    simDetailsBox.textContent  = state.details;

    const stackStr = renderStack(state.stack);
    const inputStr = renderInput(simTokens, state.inputIndex);

    const tbody = stackTraceView.querySelector("tbody");
    if (tbody.querySelectorAll("tr").length <= simCurrentIndex) {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${state.step}</td>
        <td class="stack-value">${stackStr}</td>
        <td class="input-value">${inputStr}</td>
        <td class="action-value">${state.action}</td>`;
      tbody.appendChild(row);
    }

    // Remove future rows on backward step
    const rows = tbody.querySelectorAll("tr");
    for (let i = rows.length - 1; i > simCurrentIndex; i--) rows[i].remove();

    // Highlight current row
    tbody.querySelectorAll("tr").forEach((row, idx) => {
      row.classList.toggle("active-row", idx === simCurrentIndex);
      if (idx === simCurrentIndex) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

    // ── STEP 5: Redraw Parse Tree ──
    treeVisualizer.render(simTreeNodes, state.step, state.stack);
  }

  function renderStack(stack) {
    if (!stack || stack.length === 0) return "&mdash;";
    return stack.map((item, idx) =>
      idx === stack.length - 1
        ? `<span class="top-symbol">${item.symbol}</span>`
        : item.symbol
    ).join(" ");
  }

  function renderInput(tokens, currentIdx) {
    if (!tokens || tokens.length === 0) return "&mdash;";
    return tokens.map((tok, idx) => {
      if (idx === currentIdx) return `<span class="current-token">${tok}</span>`;
      if (idx < currentIdx)   return `<span style="color:var(--text-muted);text-decoration:line-through;">${tok}</span>`;
      return tok;
    }).join(" ");
  }

});
