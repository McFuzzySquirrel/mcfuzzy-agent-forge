import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";

export type PartialLinePolicy = "hold" | "emit";

export interface IncrementalReaderOptions {
  maxBytesPerRead?: number;
  partialLinePolicy?: PartialLinePolicy;
}

export interface IncrementalReadResult {
  lines: string[];
  reset: boolean;
}

interface BoundarySample {
  length: number;
  first: Buffer;
  tail: Buffer;
}

/**
 * Reads an append-only text file without losing split UTF-8 or newline-delimited
 * records. A replacement or truncation starts a fresh stream at byte zero.
 */
export class IncrementalLineReader {
  private offset = 0;
  private identity: { dev: number; ino: number; mtimeMs: number } | null = null;
  private pending = "";
  private decoder = new StringDecoder("utf8");
  private sample: BoundarySample | null = null;
  private readonly maxBytesPerRead: number;
  private readonly sampleBytes: number;
  private readonly partialLinePolicy: PartialLinePolicy;

  constructor(options: IncrementalReaderOptions = {}) {
    this.maxBytesPerRead = Math.max(1, options.maxBytesPerRead ?? 1024 * 1024);
    this.sampleBytes = Math.min(4096, this.maxBytesPerRead);
    this.partialLinePolicy = options.partialLinePolicy ?? "hold";
  }

  reset(file?: string, toEnd = false): void {
    this.offset = 0;
    this.identity = null;
    this.pending = "";
    this.decoder = new StringDecoder("utf8");
    this.sample = null;
    if (file && toEnd) {
      const stat = this.statOrMissing(file);
      if (!stat) return;
      const metadata = this.findLastNewline(file, stat.size);
      this.offset = metadata.offset;
      this.sample = this.readBoundarySample(file, this.offset);
      this.identity = { dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs };
    }
  }

  read(file: string): IncrementalReadResult {
    const stat = this.statOrMissing(file);
    if (!stat) return { lines: [], reset: false };

    let identityChanged = this.identity !== null
      && (this.identity.dev !== stat.dev || this.identity.ino !== stat.ino);
    if (
      !identityChanged
      && this.identity !== null
      && stat.size >= this.offset
      && this.identity.mtimeMs !== stat.mtimeMs
    ) {
      identityChanged = !this.sameSample(this.sample, this.readBoundarySample(file, this.offset));
    }
    // Windows can preserve a file's timestamp and identity across a rapid
    // same-size replacement, so compare the consumed boundary in that case.
    if (!identityChanged && this.identity !== null && stat.size === this.offset) {
      identityChanged = !this.sameSample(this.sample, this.readBoundarySample(file, this.offset));
    }
    const truncated = stat.size < this.offset;
    const wasReset = identityChanged || truncated;
    if (wasReset) this.reset();
    this.identity = { dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs };
    if (stat.size <= this.offset) return { lines: [], reset: wasReset };

    const length = Math.min(stat.size - this.offset, this.maxBytesPerRead);
    let fd: number | undefined;
    let failure: unknown;
    let bytesRead = 0;
    let buffer: Buffer;
    try {
      fd = fs.openSync(file, "r");
      buffer = Buffer.alloc(length);
      bytesRead = fs.readSync(fd, buffer, 0, length, this.offset);
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch (closeError) {
          if (failure === undefined) throw closeError;
        }
      }
    }
    this.updateBoundarySample(buffer!.subarray(0, bytesRead));
    this.offset += bytesRead;
    const text = this.decoder.write(buffer!.subarray(0, bytesRead));
    return { lines: this.consume(text), reset: wasReset };
  }

  private statOrMissing(file: string): fs.Stats | null {
    try {
      return fs.statSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private updateBoundarySample(chunk: Buffer): void {
    const previous = this.sample ?? { length: 0, first: Buffer.alloc(0), tail: Buffer.alloc(0) };
    const first = previous.first.length < this.sampleBytes
      ? Buffer.concat([previous.first, chunk]).subarray(0, this.sampleBytes)
      : previous.first;
    const tail = Buffer.concat([previous.tail, chunk]).subarray(-this.sampleBytes);
    this.sample = { length: previous.length + chunk.length, first, tail };
  }

  private sameSample(left: BoundarySample | null, right: BoundarySample): boolean {
    return left !== null
      && left.length === right.length
      && left.first.equals(right.first)
      && left.tail.equals(right.tail);
  }

  private readBoundarySample(file: string, length: number): BoundarySample {
    const firstLength = Math.min(this.sampleBytes, length);
    const tailLength = Math.min(this.sampleBytes, length);
    let fd: number | undefined;
    let failure: unknown;
    try {
      fd = fs.openSync(file, "r");
      const first = Buffer.alloc(firstLength);
      const firstRead = firstLength > 0 ? fs.readSync(fd, first, 0, firstLength, 0) : 0;
      const tail = Buffer.alloc(tailLength);
      const tailPosition = Math.max(0, length - tailLength);
      const tailRead = tailLength > 0 ? fs.readSync(fd, tail, 0, tailLength, tailPosition) : 0;
      return {
        length,
        first: first.subarray(0, firstRead),
        tail: tail.subarray(0, tailRead),
      };
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch (closeError) {
          if (failure === undefined) throw closeError;
        }
      }
    }
  }

  private findLastNewline(file: string, length: number): { offset: number } {
    let fd: number | undefined;
    let failure: unknown;
    let offset = 0;
    let lastNewline = -1;
    try {
      fd = fs.openSync(file, "r");
      while (offset < length) {
        const size = Math.min(this.maxBytesPerRead, length - offset);
        const buffer = Buffer.alloc(size);
        const bytesRead = fs.readSync(fd, buffer, 0, size, offset);
        if (bytesRead === 0) break;
        const chunk = buffer.subarray(0, bytesRead);
        const newline = chunk.lastIndexOf(0x0a);
        if (newline >= 0) {
          lastNewline = offset + newline;
        }
        offset += bytesRead;
      }
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch (closeError) {
          if (failure === undefined) throw closeError;
        }
      }
    }
    return { offset: lastNewline >= 0 ? lastNewline + 1 : 0 };
  }

  private consume(text: string): string[] {
    const combined = this.pending + text;
    const parts = combined.split("\n");
    this.pending = parts.pop() ?? "";
    const lines = parts.filter((line) => line.length > 0);
    if (this.partialLinePolicy === "emit" && this.pending) {
      lines.push(this.pending);
      this.pending = "";
    }
    return lines;
  }
}
