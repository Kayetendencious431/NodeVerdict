import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import type { TraceSpan } from '../../../shared/types';
import { channelColor } from '../../../shared/utils';
import { useI18n } from '../../../shared/i18n/useI18n';

interface WaterfallChartProps {
  spans: TraceSpan[];
}

const ROW_HEIGHT = 30;
const AXIS_HEIGHT = 20;
/** Rows rendered above/below the viewport to avoid pop-in while scrolling. */
const OVERSCAN = 12;

/**
 * Canvas/DOM hybrid isn't needed here. The bottleneck of a deep waterfall is the
 * number of *rows* (vertical), not horizontal bar density. Most rows are outside
 * the viewport at any moment, so we render only the visible slice (viewport
 * culling) plus a small overscan — DOM node count stays O(visible), independent
 * of total span count. This keeps a 100k+ span trace fluid without WebGL.
 */

export function WaterfallChart({ spans }: WaterfallChartProps) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  // Observe the outer container width for responsive scales.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Observe the scroll container height so the visible window is accurate.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setViewportHeight(entry.contentRect.height);
    });
    ro.observe(el);
    setViewportHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
  }, []);

  // Visible slice of rows for this scroll position.
  const { start, end } = useMemo(() => {
    const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const lastRow = Math.min(
      spans.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
    );
    return { start: firstRow, end: lastRow };
  }, [scrollTop, viewportHeight, spans.length]);

  const visible = useMemo(() => spans.slice(start, end), [spans, start, end]);

  // Render only the visible slice.
  useEffect(() => {
    if (!svgRef.current || visible.length === 0) return;

    const svg = d3.select(svgRef.current);
    const margin = { top: 20, right: 20, bottom: 20, left: 200 };
    const width = Math.max(200, containerWidth - margin.left - margin.right);
    const totalHeight = (spans.length + 1) * ROW_HEIGHT;

    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width + margin.left + margin.right} ${totalHeight + margin.top + margin.bottom}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const minTime = d3.min(spans, s => s.startTime) ?? 0;
    const maxTime = d3.max(spans, s => s.endTime) ?? 0;
    const xScale = d3.scaleLinear()
      .domain([minTime, maxTime])
      .range([0, width]);

    // Grid lines (render once at the bottom of the full track).
    const axisG = g.append('g')
      .attr('transform', `translate(0, ${totalHeight})`)
      .call(d3.axisBottom(xScale).ticks(5))
      .attr('font-size', '10px');
    axisG.selectAll('.domain, .tick line').attr('stroke', 'currentColor');
    axisG.selectAll('.tick text').attr('fill', 'currentColor');

    // Render only the visible rows, offset to their absolute position.
    visible.forEach((span, i) => {
      const rowIndex = start + i;
      const y = rowIndex * ROW_HEIGHT;
      const x = xScale(span.startTime);
      const barWidth = Math.max(2, xScale(span.endTime) - x);

      g.append('text')
        .attr('x', -10)
        .attr('y', y + ROW_HEIGHT / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '11px')
        .attr('fill', 'currentColor')
        .text(span.channel);

      g.append('rect')
        .attr('x', x)
        .attr('y', y + 4)
        .attr('width', barWidth)
        .attr('height', ROW_HEIGHT - 8)
        .attr('rx', 4)
        .attr('fill', channelColor(span.channel))
        .attr('opacity', 0.85);

      g.append('text')
        .attr('x', x + barWidth + 4)
        .attr('y', y + ROW_HEIGHT / 2)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '10px')
        .attr('fill', 'currentColor')
        .text(`${span.duration.toFixed(1)}ms`);

      if (span.status === 'error') {
        g.append('text')
          .attr('x', x + barWidth / 2)
          .attr('y', y + ROW_HEIGHT / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', '14px')
          .attr('fill', 'currentColor')
          .text('!');
      }
    });
  }, [visible, spans, start, containerWidth]);

  if (spans.length === 0) {
    return <div className="text-sm text-gray-400 text-center py-8">{t('traceViewer.noDataToDisplay')}</div>;
  }

  return (
    <div ref={containerRef} className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-2">
      <div ref={scrollRef} onScroll={onScroll} className="overflow-auto" style={{ maxHeight: '70vh' }}>
        <svg ref={svgRef} className="text-gray-700 dark:text-gray-300" style={{ minHeight: '200px', display: 'block' }} />
      </div>
      <div className="mt-1 text-xs text-gray-400">
        {t('traceViewer.trackVirtual').replace('{shown}', String(visible.length)).replace('{total}', String(spans.length))}
      </div>
    </div>
  );
}