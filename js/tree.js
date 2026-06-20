/**
 * Parse Tree Visualizer
 * Renders the parse tree using SVG based on the simulator history state.
 * Implements a clean, centered tree layout algorithm and zoom/pan functionality.
 */

class ParseTreeVisualizer {
  constructor(svgElementId, containerElementId) {
    this.svg = document.getElementById(svgElementId);
    this.container = document.getElementById(containerElementId);
    this.g = this.svg.querySelector('g') || this.createMainGroup();
    
    this.zoomScale = 1.0;
    this.translateX = 0;
    this.translateY = 0;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;

    this.levelHeight = 80;
    this.nodeSpacing = 60;
    this.nodeRadius = 20;

    this.initEvents();
  }

  createMainGroup() {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.id = "tree-main-group";
    this.svg.appendChild(g);
    return g;
  }

  initEvents() {
    // Zoom on wheel
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = 1.1;
      const prevScale = this.zoomScale;
      
      if (e.deltaY < 0) {
        this.zoomScale *= zoomFactor;
      } else {
        this.zoomScale /= zoomFactor;
      }
      
      // Cap zoom scale
      this.zoomScale = Math.max(0.2, Math.min(this.zoomScale, 4.0));
      
      this.applyTransform();
    }, { passive: false });

    // Drag to pan
    this.container.addEventListener('mousedown', (e) => {
      // Only drag if left click
      if (e.button !== 0) return;
      this.isDragging = true;
      this.container.style.cursor = 'grabbing';
      this.startX = e.clientX - this.translateX;
      this.startY = e.clientY - this.translateY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.translateX = e.clientX - this.startX;
      this.translateY = e.clientY - this.startY;
      this.applyTransform();
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.container.style.cursor = 'grab';
      }
    });

    // Touch: pan with single finger, pinch-zoom with two fingers
    let lastTouchX = 0, lastTouchY = 0, lastPinchDist = null;

    this.container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        lastTouchX = e.touches[0].clientX - this.translateX;
        lastTouchY = e.touches[0].clientY - this.translateY;
        lastPinchDist = null;
      } else if (e.touches.length === 2) {
        lastPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    this.container.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && lastPinchDist === null) {
        this.translateX = e.touches[0].clientX - lastTouchX;
        this.translateY = e.touches[0].clientY - lastTouchY;
        this.applyTransform();
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (lastPinchDist) {
          this.zoomScale *= dist / lastPinchDist;
          this.zoomScale = Math.max(0.2, Math.min(this.zoomScale, 4.0));
          this.applyTransform();
        }
        lastPinchDist = dist;
      }
    }, { passive: false });

    this.container.addEventListener('touchend', () => {
      lastPinchDist = null;
    }, { passive: true });

    // Initial cursor
    this.container.style.cursor = 'grab';
  }

  applyTransform() {
    this.g.setAttribute('transform', `translate(${this.translateX}, ${this.translateY}) scale(${this.zoomScale})`);
  }

  resetZoom() {
    this.zoomScale = 1.0;
    
    // Center the camera
    const containerWidth = this.container.clientWidth;
    this.translateX = containerWidth / 2;
    this.translateY = 50; // Padding top
    
    this.applyTransform();
  }

  /**
   * Render the parse tree at a specific simulation step.
   * @param {Array} allNodes - Snapshot of all tree nodes
   * @param {number} currentStep - The current step number
   * @param {Array} activeStack - The current stack array of {symbol, treeNode}
   */
  render(allNodes, currentStep, activeStack) {
    // Clear previous drawing
    this.g.innerHTML = "";

    // 1. Filter nodes that exist at this step
    const stepNodes = allNodes.filter(n => n.stepCreated <= currentStep);
    if (stepNodes.length === 0) return;

    // Build quick lookup map and clean child lists to only include step-appropriate nodes
    const nodeMap = {};
    stepNodes.forEach(node => {
      nodeMap[node.id] = {
        ...node,
        visibleChildren: [] // Will populate next
      };
    });

    // Populate visibleChildren
    stepNodes.forEach(node => {
      if (node.parent !== null && nodeMap[node.parent]) {
        nodeMap[node.parent].visibleChildren.push(node.id);
      }
    });

    // Find root (usually node with parent === null)
    const root = stepNodes.find(n => n.parent === null);
    if (!root) return;

    // 2. Compute tree layout coordinates (x, y)
    let nextLeafX = 0;
    
    const computeCoordinates = (nodeId, depth) => {
      const node = nodeMap[nodeId];
      node.depth = depth;

      if (node.visibleChildren.length === 0) {
        // Leaf node in this step
        node.x = nextLeafX;
        nextLeafX++;
      } else {
        // Internal node - recurse children first
        node.visibleChildren.forEach(childId => {
          computeCoordinates(childId, depth + 1);
        });

        // Center parent over children
        const firstChild = nodeMap[node.visibleChildren[0]];
        const lastChild = nodeMap[node.visibleChildren[node.visibleChildren.length - 1]];
        node.x = (firstChild.x + lastChild.x) / 2;
      }
    };

    computeCoordinates(root.id, 0);

    // Get current top-of-stack tree node ID to highlight it
    let activeNodeId = null;
    if (activeStack && activeStack.length > 0) {
      const topStackItem = activeStack[activeStack.length - 1];
      if (topStackItem && topStackItem.treeNode) {
        activeNodeId = topStackItem.treeNode.id;
      }
    }

    // 3. Draw connection lines first (so they render behind node nodes)
    stepNodes.forEach(node => {
      const mappedNode = nodeMap[node.id];
      mappedNode.visibleChildren.forEach(childId => {
        const child = nodeMap[childId];
        this.drawLine(
          mappedNode.x * this.nodeSpacing,
          mappedNode.depth * this.levelHeight,
          child.x * this.nodeSpacing,
          child.depth * this.levelHeight
        );
      });
    });

    // 4. Draw nodes and labels
    stepNodes.forEach(node => {
      const mappedNode = nodeMap[node.id];
      const xReal = mappedNode.x * this.nodeSpacing;
      const yReal = mappedNode.depth * this.levelHeight;

      // Determine node status/styling
      let type = 'nonterminal';
      if (mappedNode.symbol === 'ε') {
        type = 'epsilon';
      } else if (mappedNode.isLeaf) {
        type = 'terminal';
      }

      let status = 'pending';
      if (mappedNode.status === 'error') {
        status = 'error';
      } else if (mappedNode.id === activeNodeId) {
        status = 'active';
      } else if (mappedNode.stepMatched !== null && mappedNode.stepMatched <= currentStep) {
        status = 'matched';
      } else if (mappedNode.stepExpanded !== null && mappedNode.stepExpanded <= currentStep) {
        status = 'expanded';
      }

      this.drawNode(xReal, yReal, mappedNode.symbol, type, status);
    });
  }

  drawLine(x1, y1, x2, y2) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("stroke", "#CBD5E1"); // Slate 300 — light theme
    line.setAttribute("stroke-width", "2");
    this.g.appendChild(line);
  }

  drawNode(x, y, symbol, type, status) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "tree-node-group");

    // Circle
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
    circle.setAttribute("r", this.nodeRadius);
    
    // Styling base class and properties based on type and status
    let fill = "#1F2937"; // Dark slate
    let stroke = "#9CA3AF"; // Grey border
    let strokeWidth = "2";
    let filter = "";

    // Node Type styling — light theme colours
    if (type === 'terminal') {
      fill = "#D1FAE5"; // Emerald 100
      stroke = "#059669"; // Emerald 600
    } else if (type === 'epsilon') {
      fill = "#F1F5F9"; // Slate 100
      stroke = "#94A3B8"; // Slate 400
    } else { // nonterminal
      fill = "#CCFBF1"; // Teal 100
      stroke = "#0D9488"; // Teal 600
    }

    // Node Status overlays
    if (status === 'active') {
      stroke = "#F59E0B"; // Gold active border
      strokeWidth = "3";
      // Add a CSS class for animation pulse
      circle.setAttribute("class", "pulse-node");
    } else if (status === 'matched') {
      fill = "#065F46"; // Rich forest green
      stroke = "#10B981"; // Glowing green
      strokeWidth = "2.5";
    } else if (status === 'error') {
      fill = "#7F1D1D"; // Dark red
      stroke = "#EF4444"; // Glowing red
      strokeWidth = "3";
    }

    circle.setAttribute("fill", fill);
    circle.setAttribute("stroke", stroke);
    circle.setAttribute("stroke-width", strokeWidth);
    group.appendChild(circle);

    // Text Label
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", x);
    // Align text vertically center
    text.setAttribute("y", y + 5); 
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#0F172A");
    text.setAttribute("font-family", "'Outfit', 'Inter', sans-serif");
    text.setAttribute("font-weight", "600");
    text.setAttribute("font-size", symbol.length > 3 ? "10px" : "12px");
    text.textContent = symbol;

    group.appendChild(text);

    // Small status indicator dots
    if (status === 'matched') {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", x + 13);
      dot.setAttribute("cy", y - 13);
      dot.setAttribute("r", 5);
      dot.setAttribute("fill", "#10B981");
      group.appendChild(dot);
    }

    this.g.appendChild(group);
  }
}

// Export class for browser environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ParseTreeVisualizer;
} else {
  window.ParseTreeVisualizer = ParseTreeVisualizer;
}
