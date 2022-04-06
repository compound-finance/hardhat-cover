import { task } from 'hardhat/config';
import { Sources } from './source';
import { Coverage } from './coverage';
import { CoverProvider } from './provider'

const TASK_COVER = 'cover';
const TASK_TEST = 'test';

async function coverTask({ testFiles, noCompile, coverageFile }, hre) {
  const coverage = Coverage.cover(await Sources.crawl(hre.artifacts));
  const report = coverage.freshReport();

  // setup an intercepted provider which traces to report
  hre.network.provider = new CoverProvider(hre.network.provider, coverage, report);

  // now run the normal tests command
  await hre.run(TASK_TEST, { testFiles, noCompile });

  // and write out the report
  coverage.writeReport(report, coverageFile);
}

task(TASK_COVER, "Runs non-invasive coverage on tests")
  .addParam("coverageFile", "The path to the coverage file to write", 'coverage.json')
  .addFlag("noCompile", "Don't compile before running this task")
  .addOptionalVariadicPositionalParam(
    "testFiles",
    "An optional list of files to test",
    []
  )
  .setAction(coverTask);
