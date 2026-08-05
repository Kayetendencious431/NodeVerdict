import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { useI18n } from '../../../shared/i18n/useI18n';

interface RealtimeChartProps {
  data: Array<{ time: number; value: number }>;
  width: number;
  height: number;
  color: string;
  label: string;
  unit?: string;
  maxDataPoints?: number;
}

const FALLBACK_COLOR = '#3b82f6';

export function RealtimeChart({
  data,
  width,
  height,
  color,
  label,
  unit = '',
  maxDataPoints = 120,
}: RealtimeChartProps) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);

  const margin = { top: 24, right: 50, bottom: 24, left: 42 };
  const innerWidth = Math.max(width - margin.left - margin.right, 10);
  const innerHeight = Math.max(height - margin.top - margin.bottom, 10);

  // X maps the actual time window (last maxDataPoints seconds) to the plot.
  const latestTime = data.length > 0 ? data[data.length - 1].time : Date.now();
  const windowStart = latestTime - maxDataPoints * 1000;

  const chartData = useMemo(() => {
    return data.filter(d => d.time >= windowStart);
  }, [data, windowStart]);

  const scales = useMemo(() => {
    const earliestTime = chartData.length > 0 ? Math.min(...chartData.map(d => d.time)) : windowStart;
    const x = d3.scaleTime()
      .domain([earliestTime, latestTime])
      .range([0, innerWidth]);

    const values = chartData.map(d => d.value);
    const minActual = values.length > 0 ? Math.min(...values) : 0;
    const maxActual = values.length > 0 ? Math.max(...values) : 0;
    const min = minActual > 0 ? minActual * 0.95 : 0;
    const max = d3.max([maxActual, 1])! * 1.05;

    const y = d3.scaleLinear()
      .domain([Math.max(0, min), Math.max(max, 1)])
      .nice()
      .range([innerHeight, 0]);

    return { x, y };
  }, [chartData, innerWidth, windowStart, latestTime]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const root = svg;
    const g = root.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const { x, y } = scales;

    // Grid lines (horizontal)
    g.append('g')
      .attr('class', 'grid')
      .attr('transform', `translate(0,0)`)
      .call(
        d3.axisLeft(y)
          .ticks(4)
          .tickSize(-innerWidth)
          .tickFormat(() => '')
      )
      .selectAll('.tick line')
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.12);

    // Axes
    g.append('g')
      .attr('class', 'axis-x')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3.axisBottom(x)
          .ticks(5)
          .tickFormat((d) => `${Math.round((latestTime - (d as Date).getTime()) / 1000)}s`)
      )
      .call(gAxis => gAxis.selectAll('text')
        .attr('fill', 'currentColor')
        .attr('font-size', 10));

    g.append('g')
      .attr('class', 'axis-y')
      .call(
        d3.axisLeft(y)
          .ticks(4)
          .tickFormat(d => `${Number(d)}${unit}`)
      )
      .call(gAxis => gAxis.selectAll('text')
        .attr('fill', 'currentColor')
        .attr('font-size', 10));

    const line = d3.line<{ time: number; value: number }>()
      .x(d => x(d.time))
      .y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    const area = d3.area<{ time: number; value: number }>()
      .x(d => x(d.time))
      .y0(innerHeight)
      .y1(d => y(d.value))
      .curve(d3.curveMonotoneX);

    // Latest value label, anchored in the whitespace strip above the plot so it
    // never collides with axis ticks or the line.
    const valueLabel = (point: { time: number; value: number }) => {
      g.append('circle')
        .attr('cx', x(point.time))
        .attr('cy', y(point.value))
        .attr('r', 3.5)
        .attr('fill', color);

      g.append('text')
        .attr('x', innerWidth)
        .attr('y', 8)
        .attr('text-anchor', 'end')
        .attr('fill', color)
        .attr('font-size', 11)
        .attr('font-weight', 600)
        .text(`${label}: ${Number(point.value).toFixed(1)}${unit}`);
    };

    if (chartData.length > 1) {
      g.append('path')
        .datum(chartData)
        .attr('fill', color)
        .attr('fill-opacity', 0.12)
        .attr('d', area);

      g.append('path')
        .datum(chartData)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('d', line);

      valueLabel(chartData[chartData.length - 1]);
    } else if (chartData.length === 1) {
      valueLabel(chartData[0]);
    } else {
      g.append('text')
        .attr('x', innerWidth / 2)
        .attr('y', innerHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', 'currentColor')
        .attr('fill-opacity', 0.4)
        .attr('font-size', 12)
        .text(t('common.noData'));
    }
  }, [chartData, scales, innerWidth, innerHeight, color, label, unit, latestTime, margin]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="text-gray-600 dark:text-gray-300"
      role="img"
      aria-label={label}
    />
  );
}

export const CHART_FALLBACK_COLOR = FALLBACK_COLOR;
