import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { TraceSpan } from '../../../shared/types';
import { channelColor } from '../../../shared/utils';

interface WaterfallChartProps {
  spans: TraceSpan[];
}

export function WaterfallChart({ spans }: WaterfallChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || spans.length === 0) return;

    const svg = d3.select(svgRef.current);
    const margin = { top: 20, right: 20, bottom: 20, left: 200 };
    const width = 800 - margin.left - margin.right;
    const heightPerSpan = 30;
    const totalHeight = Math.max(100, (spans.length + 1) * heightPerSpan);

    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width + margin.left + margin.right} ${totalHeight + margin.top + margin.bottom}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const minTime = d3.min(spans, s => s.startTime) ?? 0;
    const maxTime = d3.max(spans, s => s.endTime) ?? 0;
    const xScale = d3.scaleLinear()
      .domain([minTime, maxTime])
      .range([0, width]);

    // Grid lines
    g.append('g')
      .attr('transform', `translate(0, ${totalHeight})`)
      .call(d3.axisBottom(xScale).ticks(5))
      .attr('font-size', '10px');

    // Render each span
    spans.forEach((span, i) => {
      const y = i * heightPerSpan;
      const x = xScale(span.startTime);
      const barWidth = Math.max(2, xScale(span.endTime) - x);

      // Label
      g.append('text')
        .attr('x', -10)
        .attr('y', y + heightPerSpan / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '11px')
        .attr('fill', 'currentColor')
        .text(span.channel);

      // Bar background (duration)
      g.append('rect')
        .attr('x', x)
        .attr('y', y + 4)
        .attr('width', barWidth)
        .attr('height', heightPerSpan - 8)
        .attr('rx', 4)
        .attr('fill', channelColor(span.channel))
        .attr('opacity', 0.85);

      // Duration label on bar
      g.append('text')
        .attr('x', x + barWidth + 4)
        .attr('y', y + heightPerSpan / 2)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '10px')
        .attr('fill', 'currentColor')
        .text(`${span.duration.toFixed(1)}ms`);

      // Error indicator
      if (span.status === 'error') {
        g.append('text')
          .attr('x', x + barWidth / 2)
          .attr('y', y + heightPerSpan / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', '14px')
          .attr('fill', 'currentColor')
          .text('!');
      }
    });
  }, [spans]);

  if (spans.length === 0) {
    return <div className="text-sm text-gray-400 text-center py-8">No trace data to display</div>;
  }

  return (
    <div className="overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-2">
      <svg ref={svgRef} className="w-full" style={{ minHeight: '200px' }} />
    </div>
  );
}