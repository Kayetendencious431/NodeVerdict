import type { CpuProfile, CpuProfileNode, FlameFrame, HotFunction, CpuProfileAnalysis } from '../types';

/** Parse raw CPU profile JSON */
export function parseCpuProfile(raw: string): CpuProfile {
  const data = JSON.parse(raw) as Record<string, unknown>;

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid CPU profile: root is not an object');
  }

  const nodes = data.nodes as CpuProfileNode[] | undefined;
  if (!Array.isArray(nodes)) {
    throw new Error('Invalid CPU profile: missing "nodes" array');
  }

  const samples = data.samples as number[] | undefined;
  const timeDeltas = data.timeDeltas as number[] | undefined;

  return {
    nodes,
    startTime: (data.startTime as number) ?? 0,
    endTime: (data.endTime as number) ?? 0,
    samples: samples ?? [],
    timeDeltas: timeDeltas ?? [],
  };
}

/** Build a flame tree from CPU profile samples using stack reconstruction */
export function buildFlameTree(profile: CpuProfile): FlameFrame {
  // Build node lookup
  const nodeMap = new Map<number, CpuProfileNode>();
  for (const node of profile.nodes) {
    nodeMap.set(node.id, node);
  }

  // Build count per node from samples
  const nodeCount = new Map<number, number>();
  for (const sampleId of profile.samples) {
    nodeCount.set(sampleId, (nodeCount.get(sampleId) ?? 0) + 1);
  }

  // Total time from timeDeltas
  const totalTime = profile.timeDeltas.length > 0
    ? profile.timeDeltas.reduce((a, b) => a + b, 0) / 1000
    : profile.endTime - profile.startTime;

  // Build a reverse map: parent → children
  const parentMap = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const childId of node.children) {
      parentMap.set(childId, node.id);
    }
  }

  // Find root nodes (nodes with no parent)
  const rootIds = profile.nodes
    .filter(n => !parentMap.has(n.id))
    .map(n => n.id);

  // Build flame tree recursively
  function buildFrame(nodeId: number, depth: number): FlameFrame {
    const node = nodeMap.get(nodeId);
    const count = nodeCount.get(nodeId) ?? 0;
    const value = profile.timeDeltas.length > 0
      ? (count / profile.samples.length) * totalTime
      : count;

    const frame: FlameFrame = {
      name: node?.callFrame.functionName ?? '(anonymous)',
      url: node?.callFrame.url ?? '',
      line: node?.callFrame.lineNumber ?? 0,
      col: node?.callFrame.columnNumber ?? 0,
      value,
      children: [],
      nodeId,
      depth,
    };

    if (node) {
      for (const childId of node.children) {
        const childCount = nodeCount.get(childId) ?? 0;
        if (childCount > 0) {
          frame.children.push(buildFrame(childId, depth + 1));
        }
      }
    }

    return frame;
  }

  // Create a synthetic root that aggregates all roots
  const root: FlameFrame = {
    name: '(root)',
    url: '',
    line: 0,
    col: 0,
    value: totalTime,
    children: rootIds.map(id => buildFrame(id, 1)),
    nodeId: 0,
    depth: 0,
  };

  return root;
}

/** Extract hot functions from the profile */
export function extractHotFunctions(profile: CpuProfile): HotFunction[] {
  const nodeMap = new Map<number, CpuProfileNode>();
  for (const node of profile.nodes) {
    nodeMap.set(node.id, node);
  }

  // Count samples per node
  const sampleCount = new Map<number, number>();
  for (const sampleId of profile.samples) {
    sampleCount.set(sampleId, (sampleCount.get(sampleId) ?? 0) + 1);
  }

  // Compute total time
  const totalTime = profile.timeDeltas.length > 0
    ? profile.timeDeltas.reduce((a, b) => a + b, 0) / 1000
    : profile.endTime - profile.startTime;

  // Compute self time (only from samples, not children)
  // Also compute total time by walking up the call tree
  const parentMap = new Map<number, number[]>();
  for (const node of profile.nodes) {
    for (const childId of node.children) {
      const list = parentMap.get(childId) ?? [];
      list.push(node.id);
      parentMap.set(childId, list);
    }
  }

  // Compute total time per node: self time + sum of children's total time
  // Actually for CPU profiles, total time = self time from samples where this
  // function is on the stack
  // We need to walk each sample stack and attribute time to each frame

  // Build a map of nodeId → its ancestors (for stack walking)
  const ancestors = new Map<number, number[]>();
  function getStack(nodeId: number): number[] {
    if (ancestors.has(nodeId)) return ancestors.get(nodeId)!;
    const stack: number[] = [nodeId];
    const parents = parentMap.get(nodeId);
    if (parents && parents.length > 0) {
      stack.push(...getStack(parents[0]));
    }
    ancestors.set(nodeId, stack);
    return stack;
  }

  // For each sample, attribute time to all frames on the stack
  const totalTimeMap = new Map<number, number>();
  const selfTimeMap = new Map<number, number>();

  for (let i = 0; i < profile.samples.length; i++) {
    const nodeId = profile.samples[i];
    const delta = profile.timeDeltas[i] ?? 0;
    const deltaMs = delta / 1000;

    // Self time: only the top frame
    selfTimeMap.set(nodeId, (selfTimeMap.get(nodeId) ?? 0) + deltaMs);

    // Total time: all frames on the stack
    const stack = getStack(nodeId);
    for (const id of stack) {
      totalTimeMap.set(id, (totalTimeMap.get(id) ?? 0) + deltaMs);
    }
  }

  const functions: HotFunction[] = [];
  for (const node of profile.nodes) {
    const selfTime = selfTimeMap.get(node.id) ?? 0;
    const totalTime = totalTimeMap.get(node.id) ?? 0;

    if (selfTime > 0 || totalTime > 0) {
      functions.push({
        functionName: node.callFrame.functionName || '(anonymous)',
        url: node.callFrame.url || '',
        selfTime,
        totalTime,
        selfPercent: totalTime > 0 ? (selfTime / totalTime) * 100 : 0,
        totalPercent: totalTime > 0 ? (totalTime / totalTime) * 100 : 0,
        hitCount: sampleCount.get(node.id) ?? 0,
        line: node.callFrame.lineNumber,
      });
    }
  }

  // Sort by total time descending
  functions.sort((a, b) => b.totalTime - a.totalTime);

  return functions;
}

/** Main analysis pipeline */
export function analyzeCpuProfile(raw: string): CpuProfileAnalysis {
  const profile = parseCpuProfile(raw);
  const flameTree = buildFlameTree(profile);
  const hotFunctions = extractHotFunctions(profile);

  const totalTime = profile.timeDeltas.length > 0
    ? profile.timeDeltas.reduce((a, b) => a + b, 0) / 1000
    : profile.endTime - profile.startTime;

  return {
    profile,
    flameTree,
    hotFunctions,
    totalTime,
    sampleCount: profile.samples.length,
    topFunctions: hotFunctions.slice(0, 50),
  };
}