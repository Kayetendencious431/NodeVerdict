import { useEffect, useRef, useState, useCallback } from 'react';
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
} from 'd3';
import type { ServiceNode, ServiceEdge, ServiceHealth } from '../../../shared/distributed';

/**
 * Canvas-rendered force-directed topology graph (D3-force simulation).
 * Canvas keeps 100+ service rendering at 60fps; labels are drawn selectively
 * (all when the graph is small, otherwise only on hover/selection).
 * Selection / hover / pan / zoom redraw without touching the physics sim.
 */

const HEALTH_COLOR: Record<ServiceHealth, string> = {
  healthy: '#10b981',
  warning: '#f59e0b',
  faulty: '#ef4444',
};

interface SimNode extends ServiceNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimEdge extends Omit<ServiceEdge, 'source' | 'target'> {
  source: SimNode;
  target: SimNode;
}

interface Props {
  nodes: ServiceNode[];
  edges: ServiceEdge[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  darkMode: boolean;
}

function nodeRadius(callCount: number): number {
  return 8 + Math.sqrt(callCount) * 2.2;
}

export function TopologyGraphCanvas({ nodes, edges, selected, onSelect, darkMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);
  const drawRef = useRef<(() => void) | null>(null);

  const transformRef = useRef({ k: 1, x: 0, y: 0 });
  const hoverRef = useRef<SimNode | null>(null);
  const selectedRef = useRef<string | null>(selected);
  const darkRef = useRef(darkMode);
  const dragRef = useRef<{ node: SimNode | null; panning: boolean; lastX: number; lastY: number }>({
    node: null, panning: false, lastX: 0, lastY: 0,
  });
  const [hover, setHover] = useState<SimNode | null>(null);
  const [scale, setScale] = useState(1);

  selectedRef.current = selected;
  darkRef.current = darkMode;

  // Build simulation when data changes (not on selection/hover).
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || nodes.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = wrap.clientWidth;
    const height = Math.max(280, wrap.clientHeight);

    const simNodes: SimNode[] = nodes.map(n => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * width * 0.5,
      y: height / 2 + (Math.random() - 0.5) * height * 0.4,
      vx: 0,
      vy: 0,
      r: nodeRadius(n.callCount),
    }));
    const byName = new Map(simNodes.map(n => [n.id, n]));
    const simEdges: SimEdge[] = edges
      .map(e => {
        const source = byName.get(e.source);
        const target = byName.get(e.target);
        if (!source || !target) return null;
        return { ...e, source, target };
      })
      .filter((e): e is SimEdge => e !== null);

    const sim = forceSimulation<SimNode>(simNodes)
      .force('link', forceLink<SimNode, SimEdge>(simEdges).id(d => d.id).distance(d => 90 + Math.min(60, d.callCount * 2)).strength(0.4))
      .force('charge', forceManyBody<SimNode>().strength(-260))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<SimNode>().radius(d => d.r + 10).strength(0.9))
      .alphaDecay(0.02)
      .velocityDecay(0.35);

    simRef.current?.stop();
    simRef.current = sim;
    transformRef.current = { k: 1, x: 0, y: 0 };
    setScale(1);

    function draw() {
      if (!canvas || !ctx) return;
      const sel = selectedRef.current;
      const dk = darkRef.current;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const { k, x, y } = transformRef.current;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(k, k);

      const selectedNode = sel ? byName.get(sel) : undefined;

      // Edges
      for (const e of simEdges) {
        const error = e.errorRate > 0;
        const active = selectedNode && (e.source === selectedNode || e.target === selectedNode);
        ctx.strokeStyle = active
          ? 'rgba(99,102,241,0.9)'
          : error
            ? `rgba(239,68,68,${0.35 + Math.min(0.5, e.errorRate * 2)})`
            : dk ? 'rgba(148,163,184,0.35)' : 'rgba(100,116,139,0.3)';
        ctx.lineWidth = active ? 2.2 : Math.max(1, Math.min(5, Math.sqrt(e.callCount) * 0.6));
        ctx.beginPath();
        ctx.moveTo(e.source.x, e.source.y);
        ctx.lineTo(e.target.x, e.target.y);
        ctx.stroke();

        const dx = e.target.x - e.source.x;
        const dy = e.target.y - e.source.y;
        const angle = Math.atan2(dy, dx);
        const tipX = e.target.x - (e.target.r + 4) * Math.cos(angle);
        const tipY = e.target.y - (e.target.r + 4) * Math.sin(angle);
        const sz = 5;
        ctx.fillStyle = active ? 'rgba(99,102,241,0.9)' : error ? 'rgba(239,68,68,0.8)' : dk ? 'rgba(148,163,184,0.7)' : 'rgba(100,116,139,0.7)';
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - sz * Math.cos(angle - 0.4), tipY - sz * Math.sin(angle - 0.4));
        ctx.lineTo(tipX - sz * Math.cos(angle + 0.4), tipY - sz * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fill();
      }

      // Nodes
      for (const n of simNodes) {
        const color = HEALTH_COLOR[n.health];
        const isHover = hoverRef.current?.id === n.id;
        const isSelected = sel === n.id;
        ctx.globalAlpha = sel && !isSelected && !isHover ? 0.35 : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = color + (isHover ? '' : 'B3');
        ctx.fill();
        ctx.globalAlpha = 1;

        if (isSelected || isHover) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = isSelected ? '#6366f1' : '#94a3b8';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Labels
      const showAll = simNodes.length <= 40;
      for (const n of simNodes) {
        const isHover = hoverRef.current?.id === n.id;
        const isSelected = sel === n.id;
        if (!showAll && !isHover && !isSelected) continue;
        ctx.fillStyle = dk ? '#e2e8f0' : '#1f2937';
        ctx.font = `${isSelected ? '600' : '400'} 11px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        const label = n.serviceName.length > 18 ? `${n.serviceName.slice(0, 17)}…` : n.serviceName;
        ctx.fillText(label, n.x, n.y - n.r - 5);
      }

      ctx.restore();
    }

    drawRef.current = draw;
    draw();

    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      sim.stop();
      simRef.current = null;
      drawRef.current = null;
    };
  }, [nodes, edges]);

  const renderNow = useCallback(() => {
    drawRef.current?.();
  }, []);

  const worldPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const { k, x, y } = transformRef.current;
    return {
      x: (clientX - rect.left - x) / k,
      y: (clientY - rect.top - y) / k,
    };
  }, []);

  const hitNode = useCallback((wx: number, wy: number): SimNode | null => {
    const sim = simRef.current;
    if (!sim) return null;
    let best: SimNode | null = null;
    let bestDist = Infinity;
    for (const n of sim.nodes()) {
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d < n.r + 6 && d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    return best;
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = worldPoint(e.clientX, e.clientY);
    const node = hitNode(x, y);
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
      dragRef.current = { node, panning: false, lastX: e.clientX, lastY: e.clientY };
      simRef.current?.alphaTarget(0.15).restart();
    } else {
      dragRef.current = { node: null, panning: true, lastX: e.clientX, lastY: e.clientY };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag.node) {
      const { x, y } = worldPoint(e.clientX, e.clientY);
      drag.node.fx = x;
      drag.node.fy = y;
      simRef.current?.alphaTarget(0.1).restart();
    } else if (drag.panning) {
      transformRef.current.x += e.clientX - drag.lastX;
      transformRef.current.y += e.clientY - drag.lastY;
      renderNow();
    } else {
      const { x, y } = worldPoint(e.clientX, e.clientY);
      const node = hitNode(x, y);
      if (node?.id !== hoverRef.current?.id) {
        hoverRef.current = node;
        setHover(node);
        renderNow();
      }
    }
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag.node) {
      drag.node.fx = null;
      drag.node.fy = null;
      simRef.current?.alphaTarget(0);
    }
    dragRef.current = { node: null, panning: false, lastX: 0, lastY: 0 };
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = worldPoint(e.clientX, e.clientY);
    const node = hitNode(x, y);
    onSelect(node ? node.id : null);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    const factor = Math.exp(-e.deltaY * 0.0012);
    const k = Math.max(0.2, Math.min(4, t.k * factor));
    const kRatio = k / t.k;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    t.x = px - (px - t.x) * kRatio;
    t.y = py - (py - t.y) * kRatio;
    t.k = k;
    setScale(k);
    renderNow();
  };

  function resetZoom() {
    transformRef.current = { k: 1, x: 0, y: 0 };
    setScale(1);
    renderNow();
  }

  return (
    <div ref={wrapRef} className="relative w-full h-full min-h-[320px]">
      <canvas
        ref={canvasRef}
        className="w-full h-full touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
        onWheel={handleWheel}
      />
      {nodes.length > 0 && (
        <button
          onClick={resetZoom}
          className="absolute bottom-2 right-2 px-2.5 py-1 text-xs rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shadow-sm"
        >
          {Math.round(scale * 100)}%
        </button>
      )}
      {hover && (
        <div className="pointer-events-none absolute top-2 left-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 shadow-sm text-xs text-gray-700 dark:text-gray-200">
          <div className="font-semibold">{hover.serviceName}</div>
          <div className="text-gray-500 dark:text-gray-400 mt-0.5">
            {hover.callCount} calls · p95 {hover.p95Duration.toFixed(0)}ms · {(hover.errorRate * 100).toFixed(1)}% errors
          </div>
        </div>
      )}
    </div>
  );
}
