import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useRootStore } from '../../stores';
import { useFileUpload } from '../../shared/hooks';
import { analyzeTracingEvents } from '../../shared/engine';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import type { TracingEvent, TracingAnalysis } from '../../shared/types';
import * as d3 from 'd3';

function TimeSeriesChart({ analysis }: { analysis: TracingAnalysis }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Measure the content area width (excluding padding & border) to match ResizeObserver's contentRect
    const style = getComputedStyle(containerRef.current);
    const px = (v: string) => parseFloat(v);
    const hPadding = px(style.paddingLeft) + px(style.paddingRight);
    const hBorder = px(style.borderLeftWidth) + px(style.borderRightWidth);
    const contentWidth = containerRef.current.getBoundingClientRect().width - hPadding - hBorder;
    setDimensions({ width: contentWidth, height: 250 });
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: 250 });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Compute throughput over time
  const chartData = useMemo(() => {
    if (analysis.events.length === 0) return [];
    const timeRange = analysis.timeRange.end - analysis.timeRange.start;
    if (timeRange <= 0) return [];

    const bucketCount = Math.min(50, Math.ceil(analysis.events.length / 10));
    const bucketSize = timeRange / bucketCount;
    const buckets: { time: number; count: number; errors: number }[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const start = analysis.timeRange.start + i * bucketSize;
      const end = start + bucketSize;
      const events = analysis.events.filter(e => e.timestamp >= start && e.timestamp < end);
      const errors = events.filter(e => e.eventType === 'error').length;
      buckets.push({
        time: start + bucketSize / 2,
        count: events.length,
        errors,
      });
    }
    return buckets;
  }, [analysis]);

  useEffect(() => {
    if (!svgRef.current || chartData.length === 0 || !dimensions) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 30, left: 50 };
    const w = dimensions.width - margin.left - margin.right;
    const h = dimensions.height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(chartData.map(d => String(Math.round(d.time))))
      .range([0, w])
      .padding(0.1);

    const y = d3.scaleLinear()
      .domain([0, d3.max(chartData, d => d.count)! * 1.1])
      .range([h, 0]);

    // Bars
    g.selectAll('rect.bar')
      .data(chartData)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', d => x(String(Math.round(d.time)))!)
      .attr('y', d => y(d.count))
      .attr('width', x.bandwidth())
      .attr('height', d => h - y(d.count))
      .attr('fill', 'currentColor')
      .attr('opacity', 0.7);

    // Error markers
    g.selectAll('rect.error')
      .data(chartData.filter(d => d.errors > 0))
      .enter()
      .append('rect')
      .attr('class', 'error')
      .attr('x', d => x(String(Math.round(d.time)))!)
      .attr('y', d => y(d.errors) - 3)
      .attr('width', x.bandwidth())
      .attr('height', d => 6)
      .attr('fill', 'currentColor')
      .attr('opacity', 0.8);

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(x).tickValues(
        chartData.filter((_, i) => i % Math.max(1, Math.floor(chartData.length / 8)) === 0).map(d => String(Math.round(d.time)))
      ).tickFormat(d => `${((Number(d) - analysis.timeRange.start) / 1000).toFixed(1)}s`))
      .selectAll('text')
      .attr('font-size', '10px');

    // Y axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .attr('font-size', '10px');

    // Make axis elements respond to CSS color (dark mode)
    g.selectAll('.domain, .tick line').attr('stroke', 'currentColor');
    g.selectAll('.tick text').attr('fill', 'currentColor');

    // Labels
    g.append('text')
      .attr('x', w / 2)
      .attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', 'currentColor')
      .text('Events / Time Bucket');

  }, [chartData, analysis.timeRange.start, dimensions]);

  return (
    <div ref={containerRef} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      {dimensions && <svg ref={svgRef} width={dimensions.width} height={dimensions.height} className="block text-gray-600 dark:text-gray-300" />}
    </div>
  );
}

function LatencyDistribution({ analysis }: { analysis: TracingAnalysis }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Measure the content area width (excluding padding & border) to match ResizeObserver's contentRect
    const style = getComputedStyle(containerRef.current);
    const px = (v: string) => parseFloat(v);
    const hPadding = px(style.paddingLeft) + px(style.paddingRight);
    const hBorder = px(style.borderLeftWidth) + px(style.borderRightWidth);
    const contentWidth = containerRef.current.getBoundingClientRect().width - hPadding - hBorder;
    setDimensions({ width: contentWidth, height: 250 });
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: 250 });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const histogram = useMemo(() => {
    const durations = analysis.operations
      .filter(op => op.duration > 0)
      .map(op => op.duration);

    if (durations.length === 0) return [];

    const max = Math.max(...durations);
    const bucketCount = 30;
    const bucketSize = max / bucketCount || 1;
    const buckets: { range: string; count: number }[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const low = i * bucketSize;
      const high = (i + 1) * bucketSize;
      const count = durations.filter(d => d >= low && d < high).length;
      buckets.push({
        range: `${low.toFixed(0)}-${high.toFixed(0)}`,
        count,
      });
    }
    return buckets;
  }, [analysis]);

  useEffect(() => {
    if (!svgRef.current || histogram.length === 0 || !dimensions) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 30, left: 50 };
    const w = dimensions.width - margin.left - margin.right;
    const h = dimensions.height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(histogram.map(d => d.range))
      .range([0, w])
      .padding(0.1);

    const y = d3.scaleLinear()
      .domain([0, d3.max(histogram, d => d.count)! * 1.1])
      .range([h, 0]);

    g.selectAll('rect')
      .data(histogram)
      .enter()
      .append('rect')
      .attr('x', d => x(d.range)!)
      .attr('y', d => y(d.count))
      .attr('width', x.bandwidth())
      .attr('height', d => h - y(d.count))
      .attr('fill', 'currentColor')
      .attr('opacity', 0.7);

    g.append('g')
      .attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(x).tickValues(
        histogram.filter((_, i) => i % 5 === 0).map(d => d.range)
      ))
      .selectAll('text')
      .attr('font-size', '9px')
      .attr('transform', 'rotate(-45)');

    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .attr('font-size', '10px');

    // Make axis elements respond to CSS color (dark mode)
    g.selectAll('.domain, .tick line').attr('stroke', 'currentColor');
    g.selectAll('.tick text').attr('fill', 'currentColor');

  }, [histogram, dimensions]);

  return (
    <div ref={containerRef} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      {dimensions && <svg ref={svgRef} width={dimensions.width} height={dimensions.height} className="block text-gray-600 dark:text-gray-300" />}
    </div>
  );
}

export function TimeSeriesPage() {
  const { tracingAnalysis, setTracingAnalysis } = useRootStore();
  const { loading, error, fileName, fileSize, handleFile, reset } = useFileUpload(useCallback(async (content: string) => {
    const events = JSON.parse(content) as TracingEvent[];
    const analysis = analyzeTracingEvents(events);
    setTracingAnalysis(analysis);
  }, [setTracingAnalysis]));

  function handleReset() {
    reset();
    setTracingAnalysis(null);
  }

  if (!tracingAnalysis) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Time Series Analysis</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Visualize event throughput, latency distribution, and performance trends over time</p>
        </div>
        <FileUpload onFile={handleFile} accept=".json" label="Upload tracing events JSON" maxSize={50 * 1024 * 1024} fileName={fileName} fileSize={fileSize} onReset={handleReset} />
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <LoadingOverlay visible={loading} message="Analyzing..." />
        <div className="mt-8">
          <EmptyState title="No data loaded" description="Upload a tracing events JSON file to visualize throughput and latency distribution over time." />
        </div>
      </div>
    );
  }

  const durations = tracingAnalysis.operations.filter(op => op.duration > 0).map(op => op.duration);
  const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const p95 = durations.length ? durations.sort((a, b) => a - b)[Math.ceil(durations.length * 0.95) - 1] : 0;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Time Series Analysis</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{tracingAnalysis.totalEvents} events, {tracingAnalysis.totalOperations} operations</p>
        </div>
        <div className="w-72">
          <FileUpload onFile={handleFile} accept=".json" label="Upload tracing events" maxSize={50 * 1024 * 1024} fileName={fileName} fileSize={fileSize} onReset={handleReset} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard title="Throughput" value={`${(tracingAnalysis.totalEvents / ((tracingAnalysis.timeRange.end - tracingAnalysis.timeRange.start) / 1000)).toFixed(1)}/s`} subtitle="events per second" />
        <StatCard title="Avg Latency" value={avgDuration.toFixed(1) + 'ms'} />
        <StatCard title="P95 Latency" value={p95.toFixed(1) + 'ms'} color={p95 > 100 ? 'text-orange-600 dark:text-orange-400' : undefined} />
        <StatCard title="Operations" value={tracingAnalysis.totalOperations.toLocaleString()} />
      </div>

      <div className="grid grid-cols-1 gap-4 mb-4">
        <TimeSeriesChart analysis={tracingAnalysis} />
      </div>

      <div className="grid grid-cols-1 gap-4 mb-4">
        <LatencyDistribution analysis={tracingAnalysis} />
      </div>

      {/* Channel Latency Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Channel Latency Breakdown</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Channel</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Avg</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">P50</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">P95</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">P99</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Min</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Max</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Ops</th>
            </tr>
          </thead>
          <tbody>
            {tracingAnalysis.channelStats.map(cs => (
              <tr key={cs.channel} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-4 py-2 font-medium text-gray-700 dark:text-gray-200">{cs.channel}</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.avgDuration.toFixed(1)}ms</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.p50Duration.toFixed(1)}ms</td>
                <td className={`px-4 py-2 text-right font-mono text-xs ${cs.p95Duration > 100 ? 'text-orange-600 font-medium' : 'text-gray-600 dark:text-gray-300'}`}>
                  {cs.p95Duration.toFixed(1)}ms
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.p99Duration.toFixed(1)}ms</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.minDuration.toFixed(1)}ms</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.maxDuration.toFixed(1)}ms</td>
                <td className="px-4 py-2 text-right text-xs text-gray-600 dark:text-gray-300">{cs.totalOperations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}