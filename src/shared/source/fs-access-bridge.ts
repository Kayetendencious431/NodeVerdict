import { parseSourceMap, type SourceMapData } from './source-map-resolver';
import type { SourceMapLoader } from './code-linker';

/**
 * File System Access API bridge.
 *
 * Lets the user pick a project root once (via the native File System Access
 * picker) and then reads `.map` source maps / authored sources from disk on
 * demand — no server required. Implements the `SourceMapLoader` interface so
 * stack frames resolve straight to on-disk sources.
 *
 * Everything here guards against the API being unavailable (older browsers,
 * non-secure contexts, or server-side tests) and degrades to a no-op stub.
 */

export interface SourceFsBridge {
  /** Whether the File System Access API is available in this context. */
  readonly supported: boolean;
  readonly rootName: string | null;
  pickDirectory(): Promise<boolean>;
  readFile(path: string): Promise<string | null>;
  /** Loads & parses `<path>.map` (or `<path>` already ending in `.map`). */
  load(path: string): Promise<SourceMapData | undefined>;
}

/** Minimal structural view of a FileSystemDirectoryHandle / File. */
interface FsHandle {
  name: string;
  getFileHandle?(name: string, opts?: { create?: boolean }): Promise<FsHandle>;
  getDirectoryHandle?(name: string, opts?: { create?: boolean }): Promise<FsHandle>;
  getFile?(): Promise<{ text(): Promise<string> }>;
}

class FsAccessImpl implements SourceFsBridge {
  private root: FsHandle | null = null;
  private rootNameValue: string | null = null;
  readonly supported: boolean;

  constructor() {
    const w = typeof window !== 'undefined' ? (window as unknown as { showDirectoryPicker?: unknown }) : undefined;
    this.supported = typeof w?.showDirectoryPicker === 'function';
  }

  get rootName(): string | null {
    return this.rootNameValue;
  }

  async pickDirectory(): Promise<boolean> {
    if (!this.supported) return false;
    try {
      const w = window as unknown as { showDirectoryPicker(opts?: { mode?: string }): Promise<FsHandle> };
      this.root = await w.showDirectoryPicker({ mode: 'read' });
      this.rootNameValue = this.root?.name || null;
      return true;
    } catch {
      return false; // user cancelled or permission denied
    }
  }

  async readFile(path: string): Promise<string | null> {
    if (!this.root) return null;
    const segments = path.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..');
    let handle: FsHandle = this.root;
    for (let i = 0; i < segments.length - 1; i++) {
      const next = await handle.getDirectoryHandle?.(segments[i]).catch(() => undefined);
      if (!next) return null;
      handle = next;
    }
    const leaf = segments[segments.length - 1];
    if (!leaf) return null;
    const file = await handle.getFileHandle?.(leaf).catch(() => undefined);
    if (!file?.getFile) return null;
    const blob = await file.getFile();
    return blob.text();
  }

  async load(path: string): Promise<SourceMapData | undefined> {
    const candidate = path.endsWith('.map') ? path : `${path}.map`;
    const text = await this.readFile(candidate);
    if (text === null) return undefined;
    try {
      return parseSourceMap(JSON.parse(text));
    } catch {
      return undefined;
    }
  }
}

const UNAVAILABLE: SourceFsBridge = {
  supported: false,
  rootName: null,
  pickDirectory: async () => false,
  readFile: async () => null,
  load: async () => undefined,
};

/** Create a bridge. Falls back to a capability-disabled stub when unsupported. */
export function createFsAccessBridge(): SourceFsBridge {
  if (typeof window === 'undefined') return UNAVAILABLE;
  return new FsAccessImpl();
}

/** Build a `SourceMapLoader` from an in-memory record of already-fetched maps. */
export function fromMemory(maps: Record<string, SourceMapData>): SourceMapLoader {
  return {
    load: (file) => maps[file] ?? maps[`${file}.map`],
  };
}