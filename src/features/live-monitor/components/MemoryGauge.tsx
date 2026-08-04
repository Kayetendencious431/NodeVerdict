import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface MemoryGaugeProps {
  used: number;
  total: number;
  label: string;
  color: string;
}

export function MemoryGauge({ used, total, label, color }: MemoryGaugeProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const size = 120;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;

  const ratio = total > 0 ? Math.min(used / total, 1) : 0;
  const percentage = ratio * 100;

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const root = svg;

    // Background arc (full circle)
    root.append('path')
      .attr('d', d3.arc()({
        innerRadius: radius - strokeWidth / 2,
        outerRadius: radius + strokeWidth / 2,
        startAngle: 0,
        endAngle: Math.PI * 2,
      }) as string)
      .attr('fill', 'none')
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.12)
      .attr('transform', `translate(${center},${center})`);

    // Foreground arc (used portion)
    root.append('path')
      .attr('d', d3.arc()({
        innerRadius: radius - strokeWidth / 2,
        outerRadius: radius + strokeWidth / 2,
        startAngle: -Math.PI / 2,
        endAngle: -Math.PI / 2 + Math.PI * 2 * ratio,
      }) as string)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', strokeWidth)
      .attr('stroke-linecap', 'round')
      .attr('transform', `translate(${center},${center})`);

    // Center percentage text
    root.append('text')
      .attr('x', center)
      .attr('y', center - 4)
      .attr('text-anchor', 'middle')
      .attr('alignment-baseline', 'middle')
      .attr('fill', 'currentColor')
      .attr('font-size', 18)
      .attr('font-weight', 700)
      .text(`${percentage.toFixed(1)}%`);

    // Label text below center
    root.append('text')
      .attr('x', center)
      .attr('y', center + 16)
      .attr('text-anchor', 'middle')
      .attr('alignment-baseline', 'middle')
      .attr('fill', 'currentColor')
      .attr('fill-opacity', 0.5)
      .attr('font-size', 10)
      .text(label);
  }, [ratio, percentage, color, label, center, radius, strokeWidth]);

  return (
    <div className="flex flex-col items-center">
      <svg
        ref={svgRef}
        width={size}
        height={size}
        className="text-gray-600 dark:text-gray-300"
        role="img"
        aria-label={`${label}: ${percentage.toFixed(1)}%`}
      />
    </div>
  );
}