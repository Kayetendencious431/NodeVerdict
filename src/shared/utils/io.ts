import { compressReport, decompressReport } from '../engine';
import type { ReportData } from '../types';

export function encodeReportToHash(data: ReportData): string {
  const compressed = compressReport(data);
  return `#${encodeURIComponent(compressed)}`;
}

export function decodeReportFromHash(hash: string): ReportData | null {
  try {
    const compressed = hash.startsWith('#') ? hash.slice(1) : hash;
    const decoded = decodeURIComponent(compressed);
    return decompressReport(decoded);
  } catch (e) {
    console.warn('[io] Failed to decode report hash:', e);
    return null;
  }
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}