import { useEffect, useRef, useState, useCallback } from 'react';
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, select, zoom, zoomIdentity, drag,
} from 'd3';
import type { IcStateGraph, IcGraphNode, IcState } from '../../../shared/types/jit';

/**
 * Force-directed IC-state migration graph.
 *  - Circle nodes: hidden classes (maps), labeled by address; props shown in tooltip.
 *  - Rect nodes: IC call sites; color = aggregated IC state.
 *  - Dashed gray edges: site observes a map. Solid indigo edges: hidden-class
 *    transitions (map -> map) from --trace-maps.
 * Rendered as SVG (crisp labels, easy hover); d3-force handles 100+ nodes at
 * interactive frame rates.
 */

const SITE_COLOR: Record<IcState, string> = {
  uninitialized: '#94a3b8',
  monomorphic: '#10b981',
  polymorphic: '#f59e0b',
  megamorphic: '#ef4444',
};

interface SimNode extends IcGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimEdge {
  source: SimNode;
  target: SimNode;
  kind: 'observed' | 'transition';
  property: string | null;
  weight: number;
}

interface Props {
  graph: IcStateGraph;
  darkMode: boolean;
  onSelectSite?: (id: string | null) => void;
  selectedSite?: string | null;
}

export function IcStateGraph({ graph, darkMode, onSelectSite, selectedSite }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<SimNode | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap || graph.nodes.length === 0) return;

    const width = wrap.clientWidth;
    const height = Math.max(380, wrap.clientHeight);

    const nodes: SimNode[] = graph.nodes.map(n => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * width * 0.5,
      y: height / 2 + (Math.random() - 0.5) * height * 0.5,
      vx: 0,
      vy: 0,
    }));
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const edges: SimEdge[] = graph.edges
      .map(e => {
        const s = nodeById.get(String(e.source));
        const t = nodeById.get(String(e.target));
        return s && t ? { source: s, target: t, kind: e.kind, property: e.property, weight: e.weight } : null;
      })
      .filter((e): e is SimEdge => e !== null);

    const sim = forceSimulation(nodes)
      .force('link', forceLink<SimNode, SimEdge>(edges).id(d => d.id).distance(d => (d.kind === 'transition' ? 46 : 90)).strength(d => (d.kind === 'transition' ? 0.55 : 0.25)))
      .force('charge', forceManyBody().strength(-180))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<SimNode>().radius(d => radiusOf(d) + 10));

    const g = select(svg);
    g.selectAll('*').remove();
    g.attr('viewBox', `0 0 ${width} ${height}`);

    const zoomGroup = g.append('g');
    g.call(zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 6])
      .on('zoom', (ev) => {
        zoomGroup.attr('transform', ev.transform);
      }) as never);

    const link = zoomGroup.append('g').selectAll('line')
      .data(edges).enter().append('line')
      .attr('stroke', d => (d.kind === 'transition' ? (darkMode ? '#818cf8' : '#6366f1') : (darkMode ? '#64748b' : '#cbd5e1')))
      .attr('stroke-dasharray', d => (d.kind === 'observed' ? '4 3' : null))
      .attr('stroke-width', d => Math.min(2.5, 0.5 + Math.log2(d.weight + 1)))
      .attr('opacity', 0.7);

    const nodeGroup = zoomGroup.append('g').selectAll('g')
      .data(nodes).enter().append('g')
      .style('cursor', d => (d.type === 'site' ? 'pointer' : 'default'))
      .on('click', (_ev, d) => onSelectSite?.(d.type === 'site' ? d.id : null))
      .on('mouseenter', (_ev, d) => setHover(d))
      .on('mouseleave', () => setHover(null));

    nodeGroup.call(drag<SVGGElement, SimNode, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null; d.fy = null;
      }));

    nodeGroup.each(function (this: SVGGElement, d: SimNode) {
      const el = select(this);
      if (d.type === 'map') {
        el.append('circle')
          .attr('r', radiusOf(d))
          .attr('fill', darkMode ? '#1e293b' : '#ffffff')
          .attr('stroke', d.props.length > 0 ? (darkMode ? '#a5b4fc' : '#6366f1') : (darkMode ? '#64748b' : '#94a3b8'))
          .attr('stroke-width', 1.6);
      } else {
        el.append('rect')
          .attr('width', 110)
          .attr('height', 22)
          .attr('x', -55)
          .attr('y', -11)
          .attr('rx', 6)
          .attr('fill', SITE_COLOR[d.state ?? 'uninitialized'])
          .attr('opacity', 0.9);
      }
      const label = d.type === 'map' ? shortAddr(d.label) : `${d.label.split(' ').slice(0, 2).join(' ')}`;
      el.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', d.type === 'map' ? 3 : 4)
        .attr('font-size', d.type === 'site' ? 9 : 10)
        .attr('font-family', 'monospace')
        .attr('fill', darkMode ? '#e2e8f0' : '#334155')
        .text(label);
    });

    sim.on('tick', () => {
      link
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      nodeGroup.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Initial centering + selected highlight
    if (selectedSite) {
      const n = nodeById.get(selectedSite);
      if (n) {
        sim.alphaTarget(0).restart();
        select(svg).call(zoom<SVGSVGElement, unknown>().transform, zoomIdentity.translate(width / 2 - n.x, height / 2 - n.y).scale(1));
      }
    }

    return () => { sim.stop(); };
  }, [graph, darkMode, onSelectSite, selectedSite]);

  const radiusOf = useCallback((d: IcGraphNode): number => {
    if (d.type === 'site') return 11;
    return 8 + Math.min(16, Math.sqrt(d.count) * 2.4);
  }, []);

  const shortAddr = useCallback((addr: string): string => {
    return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
  }, []);

  return (
    <div ref={wrapRef} className="relative h-[480px] bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <svg ref={svgRef} className="w-full h-full" />
      {hover && (
        <div className="absolute top-2 left-2 max-w-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg px-3 py-2 text-xs z-10">
          <div className="font-semibold text-gray-800 dark:text-gray-100 font-mono">{hover.type === 'map' ? hover.label : hover.label}</div>
          {hover.type === 'map' ? (
            <>
              <div className="text-gray-500 dark:text-gray-400 mt-1">hidden class · {hover.count} hits</div>
              <div className="text-gray-500 dark:text-gray-400 mt-1">props: {hover.props.length ? hover.props.join(', ') : '(none)'}</div>
            </>
          ) : (
            <>
              <div className="text-gray-500 dark:text-gray-400 mt-1">state: <span className="capitalize">{hover.state}</span> · {hover.count} hits</div>
              <div className="text-gray-500 dark:text-gray-400 mt-1">keys: {hover.props.length ? hover.props.join(', ') : '(none)'}</div>
            </>
          )}
        </div>
      )}
      <div className="absolute bottom-2 right-2 flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400 bg-white/80 dark:bg-gray-900/80 px-2 py-1 rounded">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full border border-gray-400 inline-block" /> hidden class</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> monomorphic</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500 inline-block" /> polymorphic</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500 inline-block" /> megamorphic</span>
      </div>
    </div>
  );
}
