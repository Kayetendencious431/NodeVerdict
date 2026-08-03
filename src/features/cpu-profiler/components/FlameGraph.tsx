import { useRef, useEffect, useCallback, useState } from 'react';
import * as d3 from 'd3';
import type { FlameFrame } from '../../../shared/types';

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

export function FlameGraph({ flameTree, totalTime }: FlameGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [zoomStack, setZoomStack] = useState<FlameFrame[]>([flameTree]);
  const [dimensions, setDimensions] = useState({ width: 900, height: 400 });

  const currentFrame = zoomStack[zoomStack.length - 1];

  // Flatten the tree into rectangles
  const layoutRects = useCallback((frame: FlameFrame, availableWidth: number): Rect[] => {
    const rects: Rect[] = [];
    const barHeight = 24;
    const depthMap = new Map<number, number>();

    function walk(node: FlameFrame, depth: number, xOffset: number, parentWidth: number) {
      const currentDepth = depthMap.get(depth) ?? 0;
      depthMap.set(depth, currentDepth + 1);

      const width = node.value > 0 ? (node.value / totalTime) * availableWidth : 1;
      const rect: Rect = {
        name: node.name,
        x: xOffset,
        y: depth * barHeight + 4,
        width: Math.max(width, 1),
        height: barHeight - 4,
        depth,
        frame: node,
        color: hashColor(node.name),
      };
      rects.push(rect);

      let childX = xOffset;
      for (const child of node.children) {
        walk(child, depth + 1, childX, width);
        childX += (child.value / totalTime) * availableWidth;
      }
    }

    walk(frame, 0, 0, availableWidth);
    return rects;
  }, [totalTime]);

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = Math.min(800, Math.max(200, zoomStack.length * 28 + 30));
        setDimensions({ width: w, height: h });
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [zoomStack.length]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const rects = layoutRects(currentFrame, dimensions.width - 2);

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
      .on('mouseenter', (event, d) => {
        const [mx, my] = d3.pointer(event, containerRef.current);
        d3.select(event.currentTarget).attr('opacity', 1);
        setTooltip({
          x: mx + 10,
          y: my - 10,
          text: `${d.name} (${(d.frame.value).toFixed(2)}ms, ${(d.frame.value / totalTime * 100).toFixed(1)}%)`,
        });
      })
      .on('mouseleave', (event) => {
        d3.select(event.currentTarget).attr('opacity', 0.85);
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

  }, [currentFrame, dimensions, layoutRects, totalTime]);

  function handleZoomOut() {
    if (zoomStack.length > 1) {
      setZoomStack(prev => prev.slice(0, -1));
    }
  }

  function handleResetZoom() {
    setZoomStack([flameTree]);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Flame Graph</span>
          {zoomStack.length > 1 && (
            <span className="text-xs text-gray-400">
              — {zoomStack.map(f => f.name).join(' › ')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {zoomStack.length > 1 && (
            <button
              onClick={handleZoomOut}
              className="px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
            >
              ← Back
            </button>
          )}
          {zoomStack.length > 1 && (
            <button
              onClick={handleResetZoom}
              className="px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <div ref={containerRef} className="relative" style={{ minHeight: 200 }}>
        <svg ref={svgRef} width={dimensions.width} height={dimensions.height} className="block" />
        {tooltip && (
          <div
            className="absolute z-10 px-3 py-1.5 bg-gray-900 text-white text-xs rounded shadow-lg pointer-events-none whitespace-nowrap"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltip.text}
          </div>
        )}
      </div>
    </div>
  );
}