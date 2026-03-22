// ==UserScript==
// @name         TORN Stock Market - Keep Graphs Open
// @namespace    https://www.torn.com/
// @version      1.0.0
// @description  Keeps stock price graphs open when switching stocks. Pinned graphs have interactive hover tooltips.
// @author       Fogest [2254826]
// @match        https://www.torn.com/page.php?sid=stocks*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ─── CSS ──────────────────────────────────────────────────────────────────
    GM_addStyle(`
        .tsm-pinned-panel {
            position: relative;
            border-top: 2px solid #555;
            opacity: 0.95;
        }

        .tsm-pinned-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #1a1a1a;
            padding: 4px 10px;
            font-size: 12px;
            color: #aaa;
            font-family: sans-serif;
        }

        .tsm-pinned-header span {
            font-weight: bold;
            color: #ccc;
        }

        .tsm-close-btn {
            background: none;
            border: 1px solid #555;
            color: #aaa;
            cursor: pointer;
            border-radius: 3px;
            padding: 1px 7px;
            font-size: 14px;
            line-height: 1.4;
            transition: background 0.15s, color 0.15s;
        }

        .tsm-close-btn:hover {
            background: #c0392b;
            border-color: #c0392b;
            color: #fff;
        }

        /* Tooltip shown on hover over pinned charts */
        .tsm-hover-tooltip {
            position: absolute;
            background: #1a1a1a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 11px;
            font-family: 'Fjalla One', sans-serif;
            color: #eee;
            pointer-events: none;
            white-space: nowrap;
            z-index: 1000;
            transform: translateX(-50%);
            box-shadow: 0 2px 6px rgba(0,0,0,0.5);
        }

        .tsm-hover-tooltip .tsm-tt-price {
            font-size: 13px;
            font-weight: bold;
            color: #4dabf7;
        }

        .tsm-hover-tooltip .tsm-tt-time {
            color: #999;
            font-size: 10px;
        }

        /* Vertical crosshair line */
        .tsm-crosshair {
            position: absolute;
            width: 1px;
            background: rgba(255, 255, 255, 0.35);
            pointer-events: none;
        }

        /* Dot on the line */
        .tsm-dot {
            position: absolute;
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #4dabf7;
            border: 2px solid #fff;
            pointer-events: none;
            transform: translate(-50%, -50%);
        }
    `);

    // ─── Chart Data Extraction ────────────────────────────────────────────────

    /**
     * Parses all (x, y) coordinate pairs from a Google Charts SVG stroke path.
     * The stroke path is identified by fill="none" and a non-"none" stroke.
     * @param {Element} svgEl
     * @returns {Array<{x: number, y: number}>}
     */
    function parseSVGPathCoords(svgEl) {
        const strokePath = Array.from(svgEl.querySelectorAll('path')).find(
            p => p.getAttribute('fill') === 'none' && p.getAttribute('stroke') && p.getAttribute('stroke') !== 'none'
        );
        if (!strokePath) return [];

        const d = strokePath.getAttribute('d') || '';
        const coords = [];
        const regex = /([0-9.]+),([0-9.]+)/g;
        let m;
        while ((m = regex.exec(d)) !== null) {
            coords.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
        }
        return coords;
    }

    /**
     * Extracts time+price rows from Google Charts' hidden accessible table.
     * @param {Element} panelEl  - The panel div (original or clone)
     * @returns {Array<{time: string, price: number}>}
     */
    function parseAccessibleTable(panelEl) {
        const hiddenDiv = panelEl.querySelector('div[style*="-10000px"]');
        if (!hiddenDiv) return [];
        const rows = hiddenDiv.querySelectorAll('tbody tr');
        return Array.from(rows).map(r => ({
            time:  r.cells[0]?.textContent?.trim() ?? '',
            price: parseFloat(r.cells[1]?.textContent ?? '0')
        }));
    }

    /**
     * Merges SVG coordinates with table data into one array of data points.
     * If lengths differ (live chart updated between clone and parse), we use
     * the minimum length to stay in sync.
     * @returns {Array<{x: number, y: number, time: string, price: number}>}
     */
    function buildDataPoints(svgEl, panelEl) {
        const coords = parseSVGPathCoords(svgEl);
        const tableData = parseAccessibleTable(panelEl);
        const len = Math.min(coords.length, tableData.length);
        const points = [];
        for (let i = 0; i < len; i++) {
            points.push({
                x:     coords[i].x,
                y:     coords[i].y,
                time:  tableData[i].time,
                price: tableData[i].price
            });
        }
        return points;
    }

    // ─── Chart Area Detection ─────────────────────────────────────────────────

    /**
     * Finds the chart area bounding rect from the SVG.
     * Google Charts renders a transparent background rect defining the plot area.
     * We detect it as the largest rect with no fill (or no stroke).
     * Falls back to guessing from SVG dimensions.
     * @param {Element} svgEl
     * @returns {{x: number, y: number, width: number, height: number}}
     */
    function getChartArea(svgEl) {
        const rects = Array.from(svgEl.querySelectorAll('rect'));
        // The chart area rect: largest area, no fill set, no stroke
        let best = null;
        let bestArea = 0;
        for (const r of rects) {
            const fill = r.getAttribute('fill');
            const stroke = r.getAttribute('stroke');
            if (fill === null && stroke === null) {
                const w = parseFloat(r.getAttribute('width') || '0');
                const h = parseFloat(r.getAttribute('height') || '0');
                if (w * h > bestArea) {
                    bestArea = w * h;
                    best = { x: parseFloat(r.getAttribute('x') || '0'), y: parseFloat(r.getAttribute('y') || '0'), width: w, height: h };
                }
            }
        }
        if (best) return best;
        // Fallback: infer from SVG size (typical margins)
        const svgW = parseFloat(svgEl.getAttribute('width') || '570');
        const svgH = parseFloat(svgEl.getAttribute('height') || '170');
        return { x: 40, y: 10, width: svgW - 46, height: svgH - 40 };
    }

    // ─── Interactive Hover Setup ──────────────────────────────────────────────

    /**
     * Adds interactive hover (crosshair + tooltip) to a pinned panel clone.
     * @param {Element} clonedPanel  - The cloned panel element
     */
    function addHoverToClone(clonedPanel) {
        const svgEl = clonedPanel.querySelector('svg');
        if (!svgEl) return;

        const dataPoints = buildDataPoints(svgEl, clonedPanel);
        if (dataPoints.length === 0) return;

        const chartArea = getChartArea(svgEl);

        // The SVG sits inside a container div. We need the div that wraps the SVG
        // for correct relative positioning of our overlay elements.
        const svgWrapper = svgEl.parentElement; // position:absolute div
        const chartSizeDiv = svgWrapper?.parentElement; // position:relative 570x170 div
        if (!chartSizeDiv) return;

        // Make the chartSizeDiv the positioning parent for our overlays
        chartSizeDiv.style.position = 'relative';
        chartSizeDiv.style.cursor = 'crosshair';

        // Create crosshair vertical line
        const crosshair = document.createElement('div');
        crosshair.className = 'tsm-crosshair';
        crosshair.style.top    = chartArea.y + 'px';
        crosshair.style.height = chartArea.height + 'px';
        crosshair.style.display = 'none';
        chartSizeDiv.appendChild(crosshair);

        // Create dot
        const dot = document.createElement('div');
        dot.className = 'tsm-dot';
        dot.style.display = 'none';
        chartSizeDiv.appendChild(dot);

        // Create tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'tsm-hover-tooltip';
        tooltip.style.display = 'none';
        tooltip.innerHTML = `<div class="tsm-tt-price"></div><div class="tsm-tt-time"></div>`;
        chartSizeDiv.appendChild(tooltip);

        // Get SVG bounding box relative to chartSizeDiv for coordinate mapping
        // The SVG is position:absolute left:0 top:0 inside svgWrapper which is also abs left:0 top:0
        // So the SVG origin matches chartSizeDiv origin exactly.

        function findNearestPoint(mouseX) {
            // mouseX is relative to chartSizeDiv
            // Map to SVG coordinate space (they share the same pixel space since SVG width = chartSizeDiv width)
            const svgX = mouseX;

            let nearest = null;
            let minDist = Infinity;
            for (const pt of dataPoints) {
                const dist = Math.abs(pt.x - svgX);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = pt;
                }
            }
            return nearest;
        }

        function onMouseMove(e) {
            const rect = chartSizeDiv.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Only show tooltip when hovering within the chart plot area
            if (mouseX < chartArea.x || mouseX > chartArea.x + chartArea.width ||
                mouseY < chartArea.y || mouseY > chartArea.y + chartArea.height) {
                crosshair.style.display = 'none';
                dot.style.display = 'none';
                tooltip.style.display = 'none';
                return;
            }

            const pt = findNearestPoint(mouseX);
            if (!pt) return;

            // Position crosshair
            crosshair.style.left    = pt.x + 'px';
            crosshair.style.display = 'block';

            // Position dot at the data point y coordinate
            dot.style.left    = pt.x + 'px';
            dot.style.top     = pt.y + 'px';
            dot.style.display = 'block';

            // Format price like "$877.60"
            const formattedPrice = '$' + pt.price.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });

            // Update tooltip content
            tooltip.querySelector('.tsm-tt-price').textContent = formattedPrice;
            tooltip.querySelector('.tsm-tt-time').textContent  = pt.time;

            // Position tooltip above the dot, centered on x
            // Keep it inside the panel horizontally
            const tooltipW = 110; // approximate
            let tooltipX = pt.x;
            // Clamp so tooltip doesn't overflow left/right
            tooltipX = Math.max(tooltipW / 2 + chartArea.x, Math.min(tooltipX, chartArea.x + chartArea.width - tooltipW / 2));

            const tooltipY = Math.max(chartArea.y, pt.y - 44); // above dot
            tooltip.style.left    = tooltipX + 'px';
            tooltip.style.top     = tooltipY + 'px';
            tooltip.style.display = 'block';
        }

        function onMouseLeave() {
            crosshair.style.display = 'none';
            dot.style.display = 'none';
            tooltip.style.display = 'none';
        }

        chartSizeDiv.addEventListener('mousemove', onMouseMove);
        chartSizeDiv.addEventListener('mouseleave', onMouseLeave);
    }

    // ─── Core Pinning Logic ───────────────────────────────────────────────────

    function getStockNameFromRow(stockRow) {
        const nameTab = stockRow.querySelector('[aria-label^="Stock:"]');
        if (!nameTab) return `Stock #${stockRow.id}`;
        return nameTab.getAttribute('aria-label').replace('Stock: ', '');
    }

    function getActiveStockRow() {
        const activeTab = document.querySelector('.stockPrice___WCQuw.active___IUYLC');
        return activeTab ? activeTab.closest('[role="tablist"]') : null;
    }

    function pinPanelClone(stockRow, panel) {
        const stockName = getStockNameFromRow(stockRow);
        const stockId   = stockRow.id;

        // Clone the entire panel
        const clone = panel.cloneNode(true);
        clone.id = `tsm-pinned-panel-${stockId}`;
        clone.removeAttribute('aria-labelledby');
        clone.setAttribute('role', 'region');
        clone.classList.add('tsm-pinned-panel');

        // Disable interactive elements that would confuse React
        clone.querySelectorAll('input, button, [tabindex]').forEach(el => {
            el.disabled = true;
            el.tabIndex = -1;
        });

        // Add header with stock name and close button
        const header = document.createElement('div');
        header.className = 'tsm-pinned-header';
        header.innerHTML = `
            <span>📌 Pinned: ${stockName}</span>
            <button class="tsm-close-btn" title="Close pinned graph">×</button>
        `;
        header.querySelector('.tsm-close-btn').addEventListener('click', () => clone.remove());
        clone.insertBefore(header, clone.firstChild);

        // Insert clone immediately after the stock row
        stockRow.insertAdjacentElement('afterend', clone);

        // Add interactive hover to the cloned chart
        addHoverToClone(clone);
    }

    function onCaptureClick(event) {
        let target = event.target;
        let priceTab = null;
        while (target && target !== document) {
            if (target.matches?.('[role="tab"]') && target.classList.contains('stockPrice___WCQuw')) {
                priceTab = target;
                break;
            }
            target = target.parentElement;
        }
        if (!priceTab) return;

        const clickedStockRow = priceTab.closest('[role="tablist"]');
        if (!clickedStockRow) return;

        const activeStockRow = getActiveStockRow();
        if (!activeStockRow) return;
        if (activeStockRow === clickedStockRow) return;

        const panel = document.getElementById('panel-priceTab');
        if (!panel) return;

        if (document.getElementById(`tsm-pinned-panel-${activeStockRow.id}`)) return;

        pinPanelClone(activeStockRow, panel);
    }

    // ─── Initialise ───────────────────────────────────────────────────────────

    function init() {
        const stockMarket = document.querySelector('.stockMarket___iB18v');
        if (!stockMarket) {
            setTimeout(init, 500);
            return;
        }
        stockMarket.addEventListener('click', onCaptureClick, true);
        console.log('[TORN Stock Pinner v2] Initialized — pinned graphs have interactive hover.');
    }

    init();
})();
