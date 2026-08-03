/** V8 CPU Profile types */

export interface CpuProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  hitCount: number;
  children: number[];
}

export interface CpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
}

/** A parsed stack frame with timing */
export interface FlameFrame {
  name: string;
  url: string;
  line: number;
  col: number;
  value: number; // duration in ms
  children: FlameFrame[];
  nodeId: number;
  depth: number;
}

/** Hot function (top-down) */
export interface HotFunction {
  functionName: string;
  url: string;
  selfTime: number;
  totalTime: number;
  selfPercent: number;
  totalPercent: number;
  hitCount: number;
  line: number;
}

/** CPU Profile analysis result */
export interface CpuProfileAnalysis {
  profile: CpuProfile;
  flameTree: FlameFrame;
  hotFunctions: HotFunction[];
  totalTime: number;
  sampleCount: number;
  topFunctions: HotFunction[];
}