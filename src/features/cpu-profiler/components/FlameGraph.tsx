import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import * as d3 from 'd3';
import type { FlameFrame } from '../../../shared/types';
import { useI18n } from '../../../shared/i18n/useI18n';

interface FlameGraphProps {
  flameTree: FlameFrame;
  totalTime: number;
}

interface Rect {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  frame: FlameFrame;
  color: string;
  path: string;
}

const COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ef4444', '#f97316', '#eab308', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
];

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function getMaxDepth(frame: FlameFrame): number {
  let max = frame.depth;
  for (const child of frame.children) {
    max = Math.max(max, getMaxDepth(child));
  }
  return max;
}

function collectFunctionNames(frame: FlameFrame): string[] {
  const names = new Set<string>();
  function walk(node: FlameFrame) {
    names.add(node.name);
    for (const child of node.children) {
      walk(child);
    }
  }
  walk(frame);
  return Array.from(names).sort();
}

function findFrame(frame: FlameFrame, name: string): FlameFrame | null {
  if (frame.name === name) return frame;
  for (const child of frame.children) {
    const found = findFrame(child, name);
    if (found) return found;
  }
  return null;
}

function countFrames(frame: FlameFrame): number {
  let count = 1;
  for (const child of frame.children) {
    count += countFrames(child);
  }
  return count;
}

export function FlameGraph({ flameTree, totalTime }: FlameGraphProps) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rectsRef = useRef<Rect[]>([]);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [zoomStack, setZoomStack] = useState<FlameFrame[]>([flameTree]);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  // New state for enhancements
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [viewMode, setViewMode] = useState<'flame' | 'icicle'>('flame');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const currentFrame = zoomStack[zoomStack.length - 1];

  // Reset zoom/filter/view when the flame tree is replaced (live streaming updates)
  useEffect(() => {
    setZoomStack([flameTree]);
    setActiveFilter(null);
    setSearchQuery('');
    setSearchResults([]);
    setCurrentMatchIndex(-1);
  }, [flameTree]);

  // Compute effective frame (filtered by name if activeFilter is set)
  const effectiveFrame = useMemo(() => {
    if (activeFilter) {
      return findFrame(currentFrame, activeFilter) ?? currentFrame;
    }
    return currentFrame;
  }, [currentFrame, activeFilter]);

  // Collect unique function names for the filter dropdown
  const functionNames = useMemo(() => {
    return collectFunctionNames(flameTree);
  }, [flameTree]);

  // Compute max depth of the effective frame
  const effectiveDepth = useMemo(() => {
    return getMaxDepth(effectiveFrame) + 1;
  }, [effectiveFrame]);

  // Compute frame counts for summary
  const totalFrames = useMemo(() => countFrames(currentFrame), [currentFrame]);
  const filteredFrames = useMemo(() => countFrames(effectiveFrame), [effectiveFrame]);

  // Flatten the tree into rectangles
  const layoutRects = useCallback((frame: FlameFrame, availableWidth: number, mode: 'flame' | 'icicle'): Rect[] => {
    const rects: Rect[] = [];
    const barHeight = 24;
    const depthMap = new Map<number, number>();
    const maxDepth = getMaxDepth(frame);

    function walk(node: FlameFrame, depth: number, xOffset: number, parentWidth: number, currentPath: string) {
      const currentDepth = depthMap.get(depth) ?? 0;
      depthMap.set(depth, currentDepth + 1);

      const width = node.value > 0 ? (node.value / totalTime) * availableWidth : 1;
      const y = mode === 'flame'
        ? (maxDepth - depth) * barHeight + 4
        : depth * barHeight + 4;

      const path = currentPath ? `${currentPath} → ${node.name}` : node.name;

      const rect: Rect = {
        name: node.name,
        x: xOffset,
        y,
        width: Math.max(width, 1),
        height: barHeight - 4,
        depth,
        frame: node,
        color: hashColor(node.name),
        path,
      };
      rects.push(rect);

      let childX = xOffset;
      for (const child of node.children) {
        walk(child, depth + 1, childX, width, path);
        childX += (child.value / totalTime) * availableWidth;
      }
    }

    walk(frame, 0, 0, availableWidth, '');
    return rects;
  }, [totalTime]);

  // Compute rects as a memo
  const rects = useMemo(() => {
    if (!dimensions) return [];
    return layoutRects(effectiveFrame, dimensions.width - 2, viewMode);
  }, [effectiveFrame, dimensions, layoutRects, viewMode]);

  // Store rects in ref for search
  rectsRef.current = rects;

  // Compute search results
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setCurrentMatchIndex(-1);
      return;
    }
    const query = searchQuery.toLowerCase();
    const matches = rects
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.name.toLowerCase().includes(query))
      .map(({ i }) => i);
    setSearchResults(matches);
    setCurrentMatchIndex(prev => {
      if (matches.length === 0) return -1;
      if (prev >= matches.length) return 0;
      return prev >= 0 ? prev : 0;
    });
  }, [searchQuery, rects]);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const h = Math.min(800, Math.max(200, effectiveDepth * 28 + 30));
    setDimensions({ width: rect.width, height: h });
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = Math.min(800, Math.max(200, effectiveDepth * 28 + 30));
        setDimensions({ width: w, height: h });
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [effectiveDepth]);

  // D3 rendering
  useEffect(() => {
    if (!svgRef.current || !dimensions || rects.length === 0) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g');

    const bars = g.selectAll('g.bar')
      .data(rects)
      .enter()
      .append('g')
      .attr('class', 'bar')
      .style('cursor', 'pointer');

    bars.append('rect')
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .attr('width', d => d.width)
      .attr('height', d => d.height)
      .attr('rx', 2)
      .attr('fill', d => d.color)
      .attr('opacity', 0.85)
      .on('mouseenter', function (event, d) {
        const [mx, my] = d3.pointer(event, containerRef.current!);
        d3.select(this).attr('opacity', 1);
        d3.select(this).attr('class', 'flame-hover-outline');
        setTooltip({
          x: mx + 10,
          y: my - 10,
          text: `${d.path}\n${d.frame.value.toFixed(2)}ms (${(d.frame.value / totalTime * 100).toFixed(1)}%)`,
        });
      })
      .on('mouseleave', function (event) {
        d3.select(this).attr('opacity', 0.85);
        d3.select(this).attr('class', null);
        setTooltip(null);
      })
      .on('click', (_event, d) => {
        if (d.frame.children.length > 0) {
          setZoomStack(prev => [...prev, d.frame]);
        }
      });

    // Add text labels for rectangles wider than 40px
    bars.append('text')
      .attr('x', d => d.x + 4)
      .attr('y', d => d.y + d.height / 2 + 4)
      .attr('font-size', '11px')
      .attr('font-family', 'monospace')
      .attr('fill', '#fff')
      .attr('pointer-events', 'none')
      .text(d => d.width > 40 ? d.name : '')
      .each(function (d) {
        const el = d3.select(this);
        const textLength = (this as SVGTextElement).getComputedTextLength();
        if (textLength > d.width - 8) {
          let truncated = d.name;
          while (truncated.length > 0 && (this as SVGTextElement).getComputedTextLength() > d.width - 8) {
            truncated = truncated.slice(0, -1);
          }
          el.text(truncated.length < d.name.length ? truncated + '…' : truncated);
        }
      });

  }, [rects, dimensions, totalTime]);

  // Apply search highlight classes
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    // Clear all highlight classes first
    svg.selectAll('rect').attr('class', null);

    if (searchResults.length > 0) {
      svg.selectAll('g.bar rect')
        .attr('class', (_d, i) => {
          if (searchResults.includes(i)) {
            if (i === searchResults[currentMatchIndex]) {
              return 'flame-search-current';
            }
            return 'flame-search-match';
          }
          return null;
        });
    }
  }, [searchResults, currentMatchIndex]);

  // Auto-scroll to current match
  useEffect(() => {
    if (currentMatchIndex < 0 || !svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const rectEl = svg.selectAll('g.bar rect')
      .filter((_d, i) => i === currentMatchIndex)
      .node();
    if (rectEl) {
      const container = containerRef.current;
      if (container) {
        const rectBounds = (rectEl as SVGRectElement).getBoundingClientRect();
        const containerBounds = container.getBoundingClientRect();
        const scrollTop = rectBounds.top - containerBounds.top + container.scrollTop - containerBounds.height / 2 + rectBounds.height / 2;
        container.scrollTo({ top: scrollTop, behavior: 'smooth' });
      }
    }
  }, [currentMatchIndex]);

  function handleZoomOut() {
    if (zoomStack.length > 1) {
      setZoomStack(prev => prev.slice(0, -1));
    }
  }

  function handleResetZoom() {
    setZoomStack([flameTree]);
  }

  function handleViewModeToggle() {
    setViewMode(prev => prev === 'flame' ? 'icicle' : 'flame');
    // Reset zoom state when switching views
    setZoomStack([flameTree]);
    setActiveFilter(null);
  }

  function handleFilterChange(name: string) {
    if (!name) {
      setActiveFilter(null);
    } else {
      setActiveFilter(name);
    }
  }

  function handleClearFilter() {
    setActiveFilter(null);
  }

  function handleSearchNext() {
    if (searchResults.length > 0) {
      setCurrentMatchIndex(prev => (prev + 1) % searchResults.length);
    }
  }

  function handleSearchPrev() {
    if (searchResults.length > 0) {
      setCurrentMatchIndex(prev => (prev - 1 + searchResults.length) % searchResults.length);
    }
  }

  // Compute effective time for summary
  const effectiveTime = effectiveFrame.value;

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Controls bar */}
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 space-y-2">
        {/* Search and view mode row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search input */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('cpuProfiler.flameGraph.search')}
              className="w-full px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Search match counter */}
          {searchQuery.trim() && (
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {searchResults.length > 0
                ? t('cpuProfiler.flameGraph.matches').replace('{current}', String(currentMatchIndex + 1)).replace('{total}', String(searchResults.length))
                : t('cpuProfiler.flameGraph.noMatches')}
            </span>
          )}

          {/* Search navigation */}
          {searchResults.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleSearchPrev}
                className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                title={t('cpuProfiler.flameGraph.prev')}
              >
                {t('cpuProfiler.flameGraph.prevLabel')}
              </button>
              <button
                onClick={handleSearchNext}
                className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                title={t('cpuProfiler.flameGraph.next')}
              >
                {t('cpuProfiler.flameGraph.nextLabel')}
              </button>
            </div>
          )}

          {/* View mode toggle */}
          <button
            onClick={handleViewModeToggle}
            className="px-3 py-1.5 text-xs font-medium rounded transition-colors bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800/40"
          >
            {viewMode === 'flame' ? `↓ ${t('cpuProfiler.flameGraph.flameView')}` : `↑ ${t('cpuProfiler.flameGraph.icicleView')}`}
          </button>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-2">
          <select
            value={activeFilter ?? ''}
            onChange={e => handleFilterChange(e.target.value)}
            className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 max-w-[240px]"
          >
            <option value="">{t('cpuProfiler.flameGraph.filter')}</option>
            {functionNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          {activeFilter && (
            <button
              onClick={handleClearFilter}
              className="px-2 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
            >
              ✕ {t('cpuProfiler.flameGraph.clearFilter')}
            </button>
          )}
        </div>

        {/* Summary bar */}
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('cpuProfiler.flameGraph.showing')
            .replace('{filtered}', String(filteredFrames))
            .replace('{total}', String(totalFrames))
            .replace('{timeFiltered}', effectiveTime.toFixed(2))
            .replace('{timeTotal}', totalTime.toFixed(2))}
        </div>
      </div>

      {/* Header with breadcrumb and zoom controls */}
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('cpuProfiler.flameGraph')}</span>
          {zoomStack.length > 1 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              — {zoomStack.map(f => f.name).join(' › ')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {zoomStack.length > 1 && (
            <button
              onClick={handleZoomOut}
              className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {t('cpuProfiler.flameGraph.back')}
            </button>
          )}
          {zoomStack.length > 1 && (
            <button
              onClick={handleResetZoom}
              className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {t('common.reset')}
            </button>
          )}
        </div>
      </div>

      {/* SVG container */}
      <div ref={containerRef} className="relative" style={{ minHeight: 200 }}>
        {dimensions && <svg ref={svgRef} width={dimensions.width} height={dimensions.height} className="block" />}
        {tooltip && (
          <div
            className="absolute z-10 px-3 py-1.5 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded shadow-lg pointer-events-none whitespace-pre-line max-w-md"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltip.text}
          </div>
        )}
      </div>
    </div>
  );
}