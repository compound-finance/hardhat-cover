import { EIP1193Provider, RequestArguments } from 'hardhat/types';
export { EIP1193Provider, RequestArguments };

export interface StructLog {
  depth: number;
  gas?: number;
  gasCost?: number;
  memory: string[];
  op: string;
  pc: number;
  stack: string[];
  storage: { [location: string]: string };
}

export interface TaggedLog extends StructLog {
  address?: string;
  bytecode?: string;
}

export interface TraceableTxData {
  to?: string;
  input?: string;
}

export interface TracedData {
  structLogs: StructLog[];
}

export interface TraceInfo {
  txHash: string;
  txData: TraceableTxData;
  traced: TracedData;
}

function assume(cond: boolean, on: any, reason: string) {
  if (!cond) {
    throw new Error(`${reason} on '${JSON.stringify(on)}'`)
  }
}

function nthStackBack<T>(stack: T[], offset: number): T | undefined {
  return stack[stack.length - offset - 1];
}

function parseAddress(arg?: string): string {
  return '0x' + arg?.slice(24);
}

function parseUint(arg?: string): BigInt {
  return BigInt('0x' + arg);
}

async function send(provider: EIP1193Provider, method, params): Promise<any> {
  return provider.request({method, params}) as any;
}

export class Trace {
  info: TraceInfo;
  logs: TaggedLog[];
  addressToBytecodes: { [address: string]: string };

  constructor(info, logs, addressToBytecodes) {
    this.info = info;
    this.logs = logs;
    this.addressToBytecodes = addressToBytecodes;
  }

  static async crawl(provider: EIP1193Provider, txHash: string): Promise<Trace> {
    const info = await Trace.getInfo(provider, txHash);
    const logs = [...Trace.followInfo(info)];
    const addressToBytecodes = await Trace.buildAddressToBytecodes(provider, info, logs);
    return new Trace(info, logs, addressToBytecodes);
  }

  static async getInfo(provider: EIP1193Provider, txHash: string): Promise<TraceInfo> {
    const txData = await send(provider, 'eth_getTransactionByHash', [txHash]);
    const traced = await send(provider, 'debug_traceTransaction', [txHash]);
    return { txHash, txData, traced };
  }

  static *followInfo(info: TraceInfo): Generator<TaggedLog> {
    const stack = [{ address: info.txData.to }] as any[];
    const structLogs = info.traced.structLogs;
    for (let i = 0; i < structLogs.length; i++) {
      const log = structLogs[i], next = structLogs[i + 1];
      const pre = { stack: log.stack, depth: log.depth, memory: log.memory };
      const post = { stack: next?.stack, depth: (next ? next : log).depth, memory: next?.memory };
      const top = nthStackBack(stack, 0);
      if (top.bytecode) {
        yield { bytecode: top.bytecode, ...log };
      } else {
        yield { address: top.address, ...log };
      }
      switch (log.op) {
        case 'CALL':
        case 'CALLCODE':
        case 'DELEGATECALL':
        case 'STATICCALL':
          if (post.depth == pre.depth + 1) {
            stack.push({ address: parseAddress(nthStackBack(pre.stack, 1)) });
          } else {
            // sometimes calls return right away (e.g. transfers)
          }
          break;
        case 'CREATE':
        case 'CREATE2':
          assume(post.depth == pre.depth + 1, log, "depth should increase after creation");
          const offset = Number(parseUint(nthStackBack(pre.stack, 1)));
          const length = Number(parseUint(nthStackBack(pre.stack, 2)));
          const memory = pre.memory.join('');
          const bytecode = memory.slice(2 * offset, 2 * (offset + length));
          stack.push({ bytecode });
          break;
        default:
          assume(post.depth <= pre.depth, log, "depth should not increase after any other op");
          if (post.depth < pre.depth) {
            stack.pop();
          }
          break;
      }
    }
  }

  static async buildAddressToBytecodes(provider: EIP1193Provider, info: TraceInfo, logs: TaggedLog[]): Promise<{ [address: string]: string }> {
    const addressToBytecodes = {};
    for (const { address } of logs) {
      if (address == null) {
        addressToBytecodes['null'] = info.txData.input.slice(2);
      } else if (!addressToBytecodes[address]) {
        addressToBytecodes[address] = (await send(provider, 'eth_getCode', [address])).slice(2);
      }
    }
    return addressToBytecodes;
  }
}