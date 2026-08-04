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

  const margin = { top: 10, right: 50, bottom: 24, left: 42 };
  const innerWidth = Math.max(width - margin.left - margin.right, 10);
  const innerHeight = Math.max(height - margin.top - margin.bottom, 10);

  // Snap values: X is "seconds before now" (last maxDataPoints window).
  // Use the actual time window (last data point minus last N seconds for the axis).
  const latestTime = data.length > 0 ? data[data.length - 1].time : Date.now();

  const chartData = useMemo(() => {
    const windowStart = latestTime - maxDataPoints * 1000;
    return data.filter(d => d.time >= windowStart);
  }, [data, latestTime, maxDataPoints]);

  const scales = useMemo(() => {
    const x = d3.scaleLinear()
      .domain([0, maxDataPoints])
      .range([0, innerWidth]);

    const values = chartData.map(d => d.value);
    const minActual = values.length > 0 ? Math.min(...values) : 0;
    const maxActual = values.length > 0 ? Math.max(...values) : 0;
    const min = minActual > 0 ? minActual * 0.95 : 0;
    const max = d3.max([maxActual, 1])! * 1.05;

    const y = d3.scaleLinear()
      .domain([Math.max(0, min), Math.max(max, 1)])
      .nice();

    return { x, y };
  }, [chartData, innerWidth]);

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
          .tickFormat(d => `${Number(d)}s`)
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
      .x((d, i) => x(maxDataPoints - (chartData.length - 1 - i)))
      .y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    const area = d3.area<{ time: number; value: number }>()
      .x((d, i) => x(maxDataPoints - (chartData.length - 1 - i)))
      .y0(innerHeight)
      .y1(d => y(d.value))
      .curve(d3.curveMonotoneX);

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

      const last = chartData[chartData.length - 1];
      const lastX = x(maxDataPoints - (chartData.length - 1 - (chartData.length - 1)));
      g.append('circle')
        .attr('cx', lastX)
        .attr('cy', y(last.value))
        .attr('r', 3.5)
        .attr('fill', color);

      // Latest value label
      g.append('text')
        .attr('x', lastX + 6)
        .attr('y', y(last.value) - 8)
        .attr('fill', color)
        .attr('font-size', 11)
        .attr('font-weight', 600)
        .text(`${label}: ${Number(last.value).toFixed(1)}${unit}`);
    } else if (chartData.length === 1) {
      const only = chartData[0];
      g.append('circle')
        .attr('cx', x(maxDataPoints - 1))
        .attr('cy', y(only.value))
        .attr('r', 3.5)
        .attr('fill', color);
      g.append('text')
        .attr('x', x(maxDataPoints - 1) + 6)
        .attr('y', y(only.value) - 8)
        .attr('fill', color)
        .attr('font-size', 11)
        .attr('font-weight', 600)
        .text(`${label}: ${Number(only.value).toFixed(1)}${unit}`);
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
  }, [chartData, scales, innerWidth, innerHeight, color, label, unit, maxDataPoints, margin]);

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
