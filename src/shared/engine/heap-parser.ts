import type { HeapSnapshot, HeapNode, HeapEdge, HeapAnalysis, HotObject, LeakSuspicion } from '../types';

/** Parse a raw .heapsnapshot file content */
export function parseHeapSnapshot(raw: string): HeapSnapshot {
  const data = JSON.parse(raw) as Record<string, unknown>;

  // Validate input structure
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid heap snapshot: root is not an object');
  }
  const snapshot = data.snapshot as Record<string, unknown> | undefined;
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Invalid heap snapshot: missing "snapshot" field');
  }
  const meta = snapshot.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== 'object') {
    throw new Error('Invalid heap snapshot: missing "snapshot.meta" field');
  }
  const nodeFields = meta.node_fields as string[] | undefined;
  const edgeFields = meta.edge_fields as string[] | undefined;
  if (!Array.isArray(nodeFields) || nodeFields.length === 0) {
    throw new Error('Invalid heap snapshot: missing "snapshot.meta.node_fields"');
  }
  if (!Array.isArray(edgeFields) || edgeFields.length === 0) {
    throw new Error('Invalid heap snapshot: missing "snapshot.meta.edge_fields"');
  }

  const nodesRaw = data.nodes as number[] | undefined;
  const edgesRaw = data.edges as number[] | undefined;
  const strings = data.strings as string[] | undefined;
  if (!Array.isArray(nodesRaw)) throw new Error('Invalid heap snapshot: "nodes" is not an array');
  if (!Array.isArray(edgesRaw)) throw new Error('Invalid heap snapshot: "edges" is not an array');
  if (!Array.isArray(strings)) throw new Error('Invalid heap snapshot: "strings" is not an array');

  // Build field index maps for dynamic field layout
  const nodeFieldIndex = buildFieldIndex(nodeFields);
  const edgeFieldIndex = buildFieldIndex(edgeFields);
  const nodeStride = nodeFields.length;
  const edgeStride = edgeFields.length;

  // Resolve field indices (with fallback)
  const idIdx = nodeFieldIndex.get('id') ?? 0;
  const nameIdx = nodeFieldIndex.get('name') ?? 1;
  const typeIdx = nodeFieldIndex.has('type') ? nodeFieldIndex.get('type')! : -1;
  const selfSizeIdx = nodeFieldIndex.get('self_size') ?? (nodeFieldIndex.get('size') ?? 3);
  const edgeCountIdx = nodeFieldIndex.get('edge_count') ?? -1;

  const edgeTypeIdx = edgeFieldIndex.get('type') ?? 0;
  const edgeNameIdx = edgeFieldIndex.get('name_or_index') ?? 1;
  const edgeToNodeIdx = edgeFieldIndex.get('to_node') ?? 2;

  const nodeTypes = (meta.node_types as string[][] | undefined)?.[typeIdx >= 0 ? typeIdx : 2] ?? [];
  const edgeTypes = (meta.edge_types as string[][] | undefined)?.[0] ?? [];

  // Parse nodes
  const nodes: HeapNode[] = [];
  for (let i = 0; i < nodesRaw.length; i += nodeStride) {
    const id = nodesRaw[i + idIdx] as number;
    const nameStrIdx = nodesRaw[i + nameIdx] as number;
    const name = strings[nameStrIdx] ?? `unknown_${id}`;
    const typeName = typeIdx >= 0 ? (nodeTypes[nodesRaw[i + typeIdx] as number] as string) ?? 'object' : 'object';
    const selfSize = nodesRaw[i + selfSizeIdx] as number;
    const edgeCount = edgeCountIdx >= 0 ? (nodesRaw[i + edgeCountIdx] as number) : 0;

    nodes.push({
      id,
      name,
      type: typeName as HeapNode['type'],
      selfSize: typeof selfSize === 'number' ? selfSize : 0,
      retainedSize: 0,
      children: [],
      edges: typeof edgeCount === 'number' ? edgeCount : 0,
    });
  }

  // Parse edges
  const edges: HeapEdge[] = [];
  let edgeIdx = 0;
  for (const node of nodes) {
    const count = edgeCountIdx >= 0 ? node.edges : (edgesRaw[edgeIdx] as number | undefined);
    if (count === undefined || count === 0) {
      if (edgeCountIdx < 0) edgeIdx++; // consume the count field
      continue;
    }
    if (edgeCountIdx < 0) edgeIdx++; // skip edge count field for this node
    node.edges = count as number;

    for (let j = 0; j < (count as number); j++) {
      if (edgeIdx + 2 >= edgesRaw.length) break;
      const edgeTypeName = edgeTypes[edgesRaw[edgeIdx + edgeTypeIdx] as number] as string | undefined;
      const edge: HeapEdge = {
        type: (edgeTypeName as HeapEdge['type']) ?? 'property',
        name: strings[edgesRaw[edgeIdx + edgeNameIdx] as number] ?? '',
        fromNode: node.id,
        toNode: Math.floor((edgesRaw[edgeIdx + edgeToNodeIdx] as number) / nodeStride),
      };
      node.children.push(edge.toNode);
      edges.push(edge);
      edgeIdx += edgeStride;
    }
  }

  // Compute retained size
  computeRetainedSizes(nodes);

  const totalSize = nodes.reduce((sum, n) => sum + n.selfSize, 0);
  const totalRetainedSize = nodes.reduce((sum, n) => sum + n.retainedSize, 0);

  return { nodes, edges, strings, nodeCount: nodes.length, edgeCount: edges.length, totalSize, totalRetainedSize };
}

function buildFieldIndex(fields: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < fields.length; i++) map.set(fields[i], i);
  return map;
}

function computeRetainedSizes(nodes: HeapNode[]): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  if (nodeMap.size === 0) return;

  for (const node of nodes) {
    const visited = new Set<number>();
    const stack = [node.id];
    let retained = 0;

    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const n = nodeMap.get(id);
      if (!n) continue;
      retained += n.selfSize;
      for (const childId of n.children) {
        if (!visited.has(childId)) stack.push(childId);
      }
    }

    node.retainedSize = retained;
  }
}

/** Analyze heap snapshot for hot objects and leaks */
export function analyzeHeap(snapshot: HeapSnapshot): HeapAnalysis {
  const hotObjects: HotObject[] = snapshot.nodes
    .filter(n => n.retainedSize > 0 && n.type !== 'string' && n.type !== 'number')
    .sort((a, b) => b.retainedSize - a.retainedSize)
    .slice(0, 100)
    .map(node => ({
      node,
      retainedSize: node.retainedSize,
      gcRootPath: findGcRootPath(node, snapshot),
    }));

  const leakSuspects = detectLeaks(snapshot);

  // Top retained by type name
  const typeGroups = new Map<string, { name: string; size: number; count: number }>();
  for (const n of snapshot.nodes) {
    if (n.retainedSize > 1024) {
      const existing = typeGroups.get(n.name);
      if (existing) {
        existing.size += n.retainedSize;
        existing.count++;
      } else {
        typeGroups.set(n.name, { name: n.name, size: n.retainedSize, count: 1 });
      }
    }
  }
  const topRetainedNodes = Array.from(typeGroups.values())
    .sort((a, b) => b.size - a.size)
    .slice(0, 20);

  return {
    snapshot,
    hotObjects,
    leakSuspects,
    totalSize: snapshot.totalSize,
    topRetainedNodes,
  };
}

function findGcRootPath(node: HeapNode, snapshot: HeapSnapshot): string[] {
  const nodeMap = new Map(snapshot.nodes.map(n => [n.id, n]));
  const edgeMap = new Map<number, HeapEdge[]>();
  for (const edge of snapshot.edges) {
    const list = edgeMap.get(edge.toNode) ?? [];
    list.push(edge);
    edgeMap.set(edge.toNode, list);
  }

  const visited = new Set<number>();
  const path: string[] = [];
  let current = node.id;

  while (current !== 0 && !visited.has(current)) {
    visited.add(current);
    const edges = edgeMap.get(current);
    if (!edges || edges.length === 0) break;
    const incoming = edges[0];
    const fromNode = nodeMap.get(incoming.fromNode);
    if (!fromNode) break;
    path.push(`${fromNode.name} → ${incoming.name}`);
    current = fromNode.id;
    if (path.length > 10) break;
  }

  return path;
}

/** Leak detection based on three rules */
export function detectLeaks(snapshot: HeapSnapshot): LeakSuspicion[] {
  const suspects: LeakSuspicion[] = [];

  // Rule 1: Unbounded cache (many objects with same constructor name, large retained size)
  const nameGroups = new Map<string, HeapNode[]>();
  for (const n of snapshot.nodes) {
    if (n.type === 'object' || n.type === 'closure') {
      const list = nameGroups.get(n.name) ?? [];
      list.push(n);
      nameGroups.set(n.name, list);
    }
  }

  for (const [name, nodes] of nameGroups) {
    if (nodes.length > 100 && nodes.reduce((s, n) => s + n.retainedSize, 0) > 10 * 1024 * 1024) {
      suspects.push({
        severity: 'high',
        category: 'unbounded-cache',
        node: nodes[0],
        description: `Large number of "${name}" instances (${nodes.length})`,
        evidence: `${nodes.length} instances, ~${(nodes.reduce((s, n) => s + n.retainedSize, 0) / 1024 / 1024).toFixed(1)}MB retained`,
      });
    }
  }

  // Rule 2: Closure holding large objects
  for (const n of snapshot.nodes) {
    if (n.type === 'closure' && n.retainedSize > 1024 * 1024) {
      suspects.push({
        severity: 'medium',
        category: 'closure-capture',
        node: n,
        description: `Closure "${n.name}" retains ${(n.retainedSize / 1024 / 1024).toFixed(1)}MB`,
        evidence: 'Large retained size suggests closure captures a large object chain',
      });
    }
  }

  // Rule 3: Event listener accumulation
  for (const n of snapshot.nodes) {
    if (n.name.toLowerCase().includes('listener') || n.name.toLowerCase().includes('eventemitter')) {
      if (n.retainedSize > 5 * 1024 * 1024) {
        suspects.push({
          severity: 'medium',
          category: 'listener-accumulation',
          node: n,
          description: `Event listener/emitter "${n.name}" accumulates ${(n.retainedSize / 1024 / 1024).toFixed(1)}MB`,
          evidence: 'Listener accumulation can prevent GC of referenced objects',
        });
      }
    }
  }

  return suspects;
}