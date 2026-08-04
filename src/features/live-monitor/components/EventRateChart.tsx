import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { useI18n } from '../../../shared/i18n/useI18n';

interface EventRateEntry {
  channel: string;
  count: number;
  color: string;
}

interface EventRateChartProps {
  events: EventRateEntry[];
  width: number;
  height: number;
}

const MAX_BARS = 10;

export function EventRateChart({ events, width, height }: EventRateChartProps) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);

  const margin = { top: 8, right: 40, bottom: 8, left: 80 };
  const innerWidth = Math.max(width - margin.left - margin.right, 10);
  const innerHeight = Math.max(height - margin.top - margin.bottom, 10);

  const sortedEvents = useMemo(() => {
    return [...events]
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_BARS);
  }, [events]);

  const barHeight = sortedEvents.length > 0
    ? Math.min(24, (innerHeight - (sortedEvents.length - 1) * 4) / sortedEvents.length)
    : 24;
  const totalHeightNeeded = sortedEvents.length > 0
    ? sortedEvents.length * barHeight + (sortedEvents.length - 1) * 4
    : 0;

  const maxCount = sortedEvents.length > 0 ? sortedEvents[0].count : 1;

  const scales = useMemo(() => {
    const x = d3.scaleLinear()
      .domain([0, maxCount])
      .range([0, innerWidth]);
    return { x };
  }, [maxCount, innerWidth]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const { x } = scales;

    sortedEvents.forEach((evt, i) => {
      const y = i * (barHeight + 4);

      // Channel label
      g.append('text')
        .attr('x', -6)
        .attr('y', y + barHeight / 2)
        .attr('text-anchor', 'end')
        .attr('alignment-baseline', 'middle')
        .attr('fill', 'currentColor')
        .attr('font-size', 11)
        .text(evt.channel.length > 10 ? evt.channel.slice(0, 10) + '…' : evt.channel);

      // Bar
      const barWidth = Math.max(x(evt.count), 2);
      g.append('rect')
        .attr('x', 0)
        .attr('y', y)
        .attr('width', barWidth)
        .attr('height', barHeight)
        .attr('fill', evt.color)
        .attr('rx', 3)
        .attr('ry', 3);

      // Count label
      g.append('text')
        .attr('x', barWidth + 6)
        .attr('y', y + barHeight / 2)
        .attr('alignment-baseline', 'middle')
        .attr('fill', 'currentColor')
        .attr('fill-opacity', 0.6)
        .attr('font-size', 10)
        .text(evt.count);
    });

    if (sortedEvents.length === 0) {
      g.append('text')
        .attr('x', innerWidth / 2)
        .attr('y', 20)
        .attr('text-anchor', 'middle')
        .attr('fill', 'currentColor')
        .attr('fill-opacity', 0.4)
        .attr('font-size', 12)
        .text(t('common.noData'));
    }
  }, [sortedEvents, scales, innerWidth, barHeight]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={Math.max(totalHeightNeeded + margin.top + margin.bottom, 40)}
      className="text-gray-600 dark:text-gray-300"
      role="img"
      aria-label="Event rate by channel"
    />
  );
}