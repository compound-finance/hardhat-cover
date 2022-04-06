import { EIP1193Provider, RequestArguments } from 'hardhat/types';
import { BackwardsCompatibilityProviderAdapter } from 'hardhat/internal/core/providers/backwards-compatibility';
import { Coverage, Report } from './coverage';

class CoverInterceptor {
  provider: EIP1193Provider;
  coverage: Coverage;
  report: Report;

  constructor(provider: EIP1193Provider, coverage: Coverage, report: Report) {
    this.provider = provider;
    this.coverage = coverage;
    this.report = report;
  }

  async request(args: RequestArguments): Promise<unknown> {
    switch (args.method) {
      case 'eth_call':
        return this.interceptCall(args);
      case 'eth_sendTransaction':
        return this.interceptSend(args);
      default:
        return this.provider.request(args);
    }
  }

  async interceptCall(args: RequestArguments): Promise<unknown> {
    const result = await this.provider.request({ method: 'eth_call', params: args.params }) as any;
    const snapId = await this.provider.request({ method: 'evm_snapshot', params: [] });
    const txHash = await this.interceptSend(args);
    const undone = await this.provider.request({ method: 'evm_revert', params: [snapId] });
    return result;
  }

  async interceptSend(args: RequestArguments): Promise<unknown> {
    const txHash = await this.provider.request({ method: 'eth_sendTransaction', params: [args.params[0]] }) as any;
    const pending = await this.provider.request({ method: 'eth_getBlockByNumber', params: ['pending', false] }) as any;
    if (pending.transactions.length) {
      // disable tracing since we might not be able to find some recent transactions in a block
    } else {
      try {
        await this.coverage.traceAndReport(this.provider, [txHash], this.report);
      } catch (e) {
        if (e) {
          console.error(e);
        }
      }
    }
    return txHash;
  }
}

export class CoverProvider extends BackwardsCompatibilityProviderAdapter {
  constructor(provider: BackwardsCompatibilityProviderAdapter, coverage: Coverage, report: Report) {
    const interceptor = new CoverInterceptor(provider['_provider'], coverage, report);
    super(Object.assign(provider, {
      request: interceptor.request.bind(interceptor)
    }));
  }
}
