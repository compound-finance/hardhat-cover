# hardhat-cover

Either:

```typescript
await Coverage
    .cover(await Sources.crawl(hre.artifacts))
    .traceReportAndWrite(ethers.provider, [txHash])
```

or:

```typescript
const sources = await Sources.crawl(hre.artifacts)
const trace = await Trace.crawl(ethers.provider, txHash)
sources.loadAddresses(trace.addressToBytecodes)

const coverage = Coverage.cover(sources)
const report = coverage.report(trace.logs)
```
