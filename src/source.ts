import { Artifacts, HardhatRuntimeEnvironment } from 'hardhat/types';

export interface CompilerOutputCode {
  object: string;
  sourceMap: string;
}

export interface CompilerSource {
  path?: string;
  input: { content: string };
  output: { ast: object, id: number };
}

export interface SourceRange {
  start: number;
  length: number;
  index: number;
}

export class SourceMap {
  fqdn: string;
  bytecode: string;
  pcToInstructionIndices: { [pc: number]: number };
  instructionIndexToRanges: { [index: number]: SourceRange };
  compilerSources: CompilerSource[];

  constructor(bytecode, pcToInstructionIndices, instructionIndexToRanges, compilerSources, fqdn?) {
    this.fqdn = fqdn || 'unknown original source';
    this.bytecode = bytecode;
    this.pcToInstructionIndices = pcToInstructionIndices;
    this.instructionIndexToRanges = instructionIndexToRanges;
    this.compilerSources = compilerSources;
  }

  pcToInstructionIndex(pc: number): number {
    const i = this.pcToInstructionIndices[pc]
    if (i == undefined) {
      throw new Error(`No instruction at byte ${pc} (${this.fqdn})`);
    }
    return i;
  }

  instructionIndexToRange(i: number): SourceRange {
    const range = this.instructionIndexToRanges[i];
    if (range == undefined) {
      throw new Error(`No source range for instruction ${i} (${this.fqdn})`);
    }
    return range;
  }

  pcToRange(pc: number): SourceRange {
    return this.instructionIndexToRange(this.pcToInstructionIndex(pc));
  }

  static parse(code: CompilerOutputCode, sources: CompilerSource[], fqdn?: string): SourceMap {
    const pcToInstructionIndices = SourceMap.buildPCToInstructionIndices(code.object);
    const instructionIndexToRanges = {};
    let index = 0, state = {s: 0, l: 0, f: 0};
    for (const entry of code.sourceMap.split(';')) {
      const [s, l, f, _j, _m] = entry.split(':');
      state = {
        s: s ? parseInt(s) : state.s,
        l: l ? parseInt(l) : state.l,
        f: f ? parseInt(f) : state.f,
      };
      instructionIndexToRanges[index++] = { start: state.s, length: state.l, index: state.f };
    }
    return new SourceMap(code.object, pcToInstructionIndices, instructionIndexToRanges, sources, fqdn);
  }

  static buildPCToInstructionIndices(bytecode: string): {[pc: number]: SourceRange} {
    function instructionLength(instruction: number) {
      if (instruction >= 0x60 && instruction <= 0x7f)
        return instruction - 0x60 + 2;
      return 1;
    }
    const pcToInstructionIndices = {};
    const bytes = Uint8Array.from(Buffer.from(bytecode, 'hex'));
    for (let pc = 0, i = 0; pc < bytecode.length; i++) {
      const length = instructionLength(bytes[pc]);
      pcToInstructionIndices[pc] = i;
      pc += length;
    }
    return pcToInstructionIndices;
  }
}

export class Sources {
  addressToBytecodes: { [address: string]: string };
  bytecodeToSourceMaps: { [bytecode: string]: SourceMap };
  bytecodeAndIndexToPath: { [bytecode: string] : { [index: number] : string } };
  pathToCompilerSources: { [path: string]: CompilerSource };
  unique: number;

  constructor(bytecodeToSourceMaps) {
    this.addressToBytecodes = {};
    this.bytecodeToSourceMaps = bytecodeToSourceMaps;
    this.bytecodeAndIndexToPath = {};
    this.pathToCompilerSources = {};
    this.unique = 0;
    this.initPathsAndPathToCompilerSources();
  }

  initPathsAndPathToCompilerSources() {
    for (const bytecode in this.bytecodeToSourceMaps) {
      this.indexBytecodeToSourceMap(bytecode);
    }
  }

  indexBytecodeToSourceMap(bytecode: string) {
    const b2s = this.bytecodeToSourceMaps;
    const bi2p = this.bytecodeAndIndexToPath;
    const p2cs = this.pathToCompilerSources;
    const si2p = bi2p[bytecode] = bi2p[bytecode] || [];
    for (const src of b2s[bytecode].compilerSources) {
      const existing = p2cs[src.path];
      if (!existing) {
        si2p[src.output.id] = src.path;
        p2cs[src.path] = src;
      } else if (existing.input.content == src.input.content) {
        si2p[src.output.id] = src.path;
      } else {
        // first search all other remappings of the path for a match
        //  either use that or create a new path -> compiler source entry
        let path;
        for (let i = 0; i < this.unique; i++) {
          const maybePath = `${src.path}:${i}`;
          const maybeExisting = p2cs[maybePath];
          if (maybeExisting.input.content == src.input.content) {
            path = maybePath;
            break;
          }
        }
        if (path) {
          si2p[src.output.id] = path;
        } else {
          path = `${src.path}:${this.unique++}`;
          si2p[src.output.id] = path;
          p2cs[path] = { ...src, path };
        }
      }
    }
  }

  insertAndIndexBytecodeAndSourceMap(bytecode: string, sourceMap: SourceMap) {
    this.bytecodeToSourceMaps[bytecode] = sourceMap;
    this.indexBytecodeToSourceMap(bytecode);
    return sourceMap;
  }

  loadAddresses(addressToBytecodes: { [address: string]: string }) {
    for (const address in addressToBytecodes) {
      this.addressToBytecodes[address.toLowerCase()] = addressToBytecodes[address];
    }
  }

  addressToBytecode(address?: string): string {
    const bytecode = this.addressToBytecodes[address && address.toLowerCase()];
    if (bytecode == undefined) {
      throw new Error(`No bytecode for address ${address}`);
    }
    return bytecode;
  }

  bytecodeToSourceMap(bytecode: string): SourceMap {
    const b2s = this.bytecodeToSourceMaps;
    const sourceMap = b2s[bytecode];
    if (sourceMap == undefined) {
      for (const knownBytecode in b2s) {
        if (bytecode.length == knownBytecode.length) {
          // fuzzy match non zero bytes for immutables on deployed bytecode
          let mismatchOnNonZeroByte = false;
          for (let i = 0; i < bytecode.length; i++) {
            if (bytecode[i] != knownBytecode[i] && knownBytecode[i] != '0') {
              mismatchOnNonZeroByte = true;
            }
          }
          if (!mismatchOnNonZeroByte) {
            // note: cache and return
            return this.insertAndIndexBytecodeAndSourceMap(bytecode, b2s[knownBytecode]);
          }
        } else if (bytecode.length > knownBytecode.length && knownBytecode.length > 42) {
          const truncBytecode = bytecode.slice(0, knownBytecode.length);
          if (truncBytecode == knownBytecode) {
            // note: cache and return
            return this.insertAndIndexBytecodeAndSourceMap(bytecode, b2s[knownBytecode]);
          }
        }
      }
      throw new Error(`No source map for bytecode ${bytecode}`);
    }
    return sourceMap;
  }

  compilerSourcePath(bytecode: string, sourceIndex: number): string {
    const path = this.bytecodeAndIndexToPath[bytecode][sourceIndex];
    if (path == undefined) {
      throw new Error(`No compiler source path for bytecode ${bytecode} index ${sourceIndex}`);
    }
    return path;
  }

  static async crawl(artifacts: Artifacts): Promise<Sources> {
    const bytecodeToSourceMaps = {};
    const fqdns = await artifacts.getAllFullyQualifiedNames();
    for (const fqdn of fqdns) {
      const [path, name] = fqdn.split(':');
      const buildInfo = await artifacts.getBuildInfo(fqdn);
      const contract = buildInfo.output.contracts[path][name];
      const runtimeCode = contract.evm.deployedBytecode;
      const constructorCode = contract.evm.bytecode;
      const inputSources = buildInfo.input.sources;
      const outputSources = buildInfo.output.sources;
      const generatedSources = [].concat(constructorCode['generatedSources'], runtimeCode['generatedSources']);
      const compilerSources = []
      for (const [path, output] of Object.entries(outputSources)) {
        compilerSources[output.id] = { path, input: inputSources[path], output };
      }
      for (const { id, name, contents, ast } of generatedSources) {
        compilerSources[id] = { path: name, input: { content: contents }, output: { ast, id } };
      }
      bytecodeToSourceMaps[runtimeCode.object] = SourceMap.parse(runtimeCode, compilerSources, fqdn);
      bytecodeToSourceMaps[constructorCode.object] = SourceMap.parse(constructorCode, compilerSources, `${fqdn}[constructor]`);
    }
    return new Sources(bytecodeToSourceMaps);
  }
}
