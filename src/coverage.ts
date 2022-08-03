import { Sources } from './source';
import { EIP1193Provider, TaggedLog, Trace } from './trace';

export interface SourcePosition {
  line: number;   // 1-based
  column: number; // 0-based
}

export interface SourceLocation {
  start: SourcePosition;
  end: SourcePosition;
}

export interface BranchMap {
  [branchId: string]: {
    line: number;
    type: 'if' | 'switch' | 'cond-expr' | 'binary-expr';
    locations: SourceLocation[];
  };
}

export interface FunctionMap {
  [functionId: string]: {
    name: string;
    line: number;
    loc: SourceLocation;
    skip?: boolean;
  };
}

export interface StatementMap {
  [statementId: string]: SourceLocation;
}

export interface LineCounts {
  [lineNo: number]: number;
}

export interface BranchCounts {
  [branchId: string]: number[];
}

export interface FunctionCounts {
  [functionId: string]: number;
}

export interface StatementCounts {
  [statementId: string]: number;
}

export interface Report {
  [path: string]: {
    path: string;
    branchMap: BranchMap;
    fnMap: FunctionMap;
    statementMap: StatementMap;
    l: LineCounts;
    b: BranchCounts;
    f: FunctionCounts;
    s: StatementCounts;
  };
}

export type Feature = {l: number} | {b: [number, number]} | {f: number} | {s: number};
export type Features = Feature[][];
export type MutFeatures = Features;

export interface SyntaxTable {
  features: Features;
  lines: string[];
  branchMap: BranchMap;
  fnMap: FunctionMap;
  statementMap: StatementMap;
}

export interface PathToSyntax {
  [path: string]: SyntaxTable;
}

export interface OffsetToPosition {
  [offset: number]: SourcePosition;
}

export class Coverage {
  sources: Sources;
  pathToSyntax: PathToSyntax;

  constructor(sources: Sources, pathToSyntax: PathToSyntax) {
    this.sources = sources;
    this.pathToSyntax = pathToSyntax;
  }

  freshReport(): Report {
    const report = {};
    for (const [path, syntax] of Object.entries(this.pathToSyntax)) {
      const { features, lines, branchMap, fnMap, statementMap } = syntax;
      report[path] = {
        path,
        branchMap,
        fnMap,
        statementMap,
        l: Array(lines.length).fill(0),
        b: Object.keys(branchMap).reduce((b, k) => ({ ...b, [k]: branchMap[k].locations.map(_ => 0) }), {}),
        f: Object.keys(fnMap).reduce((f, k) => ({ ...f, [k]: 0 }), {}),
        s: Object.keys(statementMap).reduce((s, k) => ({ ...s, [k]: 0 }), {}),
      };
    }
    return report;
  }

  report(logs: TaggedLog[], continueReport?: Report): Report {
    const report = continueReport || this.freshReport();
    for (const log of logs) {
      const bytecode = log.bytecode || this.sources.addressToBytecode(log.address);
      const sourceMap = this.sources.bytecodeToSourceMap(bytecode);
      const range = sourceMap.pcToRange(log.pc);
      if (range.length > 0) {
        const path = this.sources.compilerSourcePath(sourceMap.bytecode, range.index);
        const syntax = this.pathToSyntax[path];
        const stats = report[path];
        let line, branch, fn;
        for (let i = range.start; i < range.start + range.length; i++) {
          if (!syntax.features[i] && path.startsWith('#')) {
            // TODO: fix, looks like happening on a delegate call actually maybe? (in TUP)
            //  I'm not sure if this is a bug here or possibly solc generated sources maps
            /*
              console.warn('Bad generated source', i, path, sourceMap.fqdn, range);
              console.warn(
              "This seems to be an issue with a generated source and does not typically affect the output.",
              "Its also possible we have matched a different bytecode, although that doesn't actually seem to be the case."
              );
            */
            break;
          }
          for (const feature of syntax.features[i]) {
            if ('l' in feature) {
              // only count first hit of line
              if (line != feature.l) {
                stats.l[line = feature.l]++;
              }
            } else if ('b' in feature) {
              // only take first branch for a single opcode
              if (!branch) {
                const v = branch = feature.b;
                stats.b[v[0]][v[1]]++;
              }
            } else if ('f' in feature) {
              // only take first fn for a single JUMPDEST
              if (!log.op.match(/^JUMPDEST$/)) continue;
              if (!fn) {
                stats.f[fn = feature.f]++;
              }
            } else if ('s' in feature) {
              stats.s[feature.s]++;
            }
          }
        }
      }
    }
    return report;
  }

  filteredReport(report: Report) {
    const filtered = {};
    for (const path in report) {
      // don't include generated sources which won't exist
      if (path.startsWith('#')) continue;
      if (path.includes(':')) continue;

      // skip lines which have no significant features
      const syntax = this.pathToSyntax[path];
      const statsEtc = { ...report[path] };
      function significantFeature(f) {
        if ('l' in f) return false;
        if ('b' in f) return true;
        if ('f' in f) return !syntax.fnMap[f.f].skip;
        if ('s' in f) return !syntax.statementMap[f.s]['skip'];
      }
      statsEtc.l = syntax.features.reduce((l, fs) => {
        // copy line if this byte has at least 1 significant feature
        if (fs.filter(significantFeature).length) {
          const n = fs[0]['l'];
          l[n] = statsEtc.l[n];
        }
        return l;
      }, {});

      // then copy to filtered
      filtered[path] = statsEtc;
    }
    return filtered;
  }

  writeReport(report: Report, filename = 'coverage.json') {
    require('fs').writeFileSync(filename, JSON.stringify(this.filteredReport(report)));
  }

  async traceAndReport(provider: EIP1193Provider, txHashes: string[], continueReport?: Report): Promise<Report> {
    const report = continueReport || this.freshReport();
    for (const txHash of txHashes) {
      const trace = await Trace.crawl(provider, txHash);
      this.sources.loadAddresses(trace.addressToBytecodes);
      this.report(trace.logs, report);
    }
    return report;
  }

  async traceReportAndWrite(provider: EIP1193Provider, txHashes: string[], filename?: string): Promise<Report> {
    const report = await this.traceAndReport(provider, txHashes);
    this.writeReport(report, filename);
    return report;
  }

  static cover(sources: Sources): Coverage {
    return new Coverage(sources, Coverage.buildPathToSyntax(sources));
  }

  static buildPathToSyntax(sources: Sources): PathToSyntax {
    const pathToSyntax = {};
    for (const [path, { input, output }] of Object.entries(sources.pathToCompilerSources)) {
      const features = [];
      const offsetToPosition = Coverage.buildOffsetToPosition(input.content, features);
      const syntaxMaps = Coverage.buildSyntaxMaps(output.ast, offsetToPosition, features);
      pathToSyntax[path] = { features, lines: input.content.split('\n'), ...syntaxMaps };
    }
    return pathToSyntax;
  }

  static buildOffsetToPosition(rawSource: string, features: MutFeatures): OffsetToPosition {
    const newlineByte = '\n'.charCodeAt(0);
    const sourceBytes = (new TextEncoder).encode(rawSource)
    const offsetToPosition = { 0: { line: 1, column: 0 } };
    for (let i = 0; i < sourceBytes.length; i++) {
      const location = offsetToPosition[i];
      const isNewline = sourceBytes[i] === newlineByte;
      const line = location.line + (isNewline ? 1 : 0);
      const column = isNewline ? 0 : (location.column + 1);
      offsetToPosition[i + 1] = { line, column };
      features[i] = [{l: line}];
    }
    return offsetToPosition;
  }

  static buildSyntaxMaps(ast, offsetToPosition: OffsetToPosition, features: MutFeatures): { branchMap, fnMap, statementMap } {
    const branchMap = {}, fnMap = {}, statementMap = {};

    function fetchLocation(ast, feature?: Feature): SourceLocation {
      const [s, l, _f] = ast.src.split(':').map(n => parseInt(n));
      if (feature && l > 0) {
        features[s].push(feature);
      }
      return {
        start: offsetToPosition[s],
        end: offsetToPosition[s + l - 1],
      }
    }

    let branchId = 0;
    function insertBranch(ast, type, alternatives) {
      const loc = fetchLocation(ast);
      branchMap[branchId] = {
        line: loc.start.line,
        type,
        locations: alternatives.map((a, i) => fetchLocation(a, {b: [branchId, i]})),
      };
      branchId++;
    }

    let fnId = 0;
    function insertFn(ast, name) {
      const loc = fetchLocation(ast, {f: fnId});
      fnMap[fnId] = {
        name,
        line: loc.start.line,
        loc
      };
      fnId++;
    }

    let statementId = 0;
    function insertStatement(ast, skip = false) {
      const loc = fetchLocation(ast, {s: statementId});
      statementMap[statementId] = { ...loc, skip };
      statementId++;
    }

    function walk(ast) {
      let alts, kids = [];
      switch (ast.nodeType) {
        case 'BinaryOperation':
          kids = [ast.leftExpression, ast.rightExpression];
          if (['&&', '||'].includes(ast.operator)) {
            insertBranch(ast, ast.nodeType, alts = kids);
          } else {
            insertStatement(ast);
          }
          break;

        case 'Conditional':
          alts = [ast.trueExpression, ast.falseExpression];
          kids = [ast.condition].concat(alts);
          insertBranch(ast, 'if', alts);
          break;

        case 'IfStatement':
          alts = [ast.trueBody, ast.falseBody].filter(_ => _);
          kids = [ast.condition].concat(alts);
          insertBranch(ast, 'if', alts);
          break;

        case 'YulIf':
          alts = [ast.body, ast.condition];
          kids = [].concat(alts);
          insertBranch(ast, 'if', alts);
          break;

        case 'YulSwitch':
          alts = ast.cases;
          kids = [ast.expression].concat(alts);
          insertBranch(ast, 'switch', alts);
          break;

        case 'ContractDefinition':
          kids = ast.nodes;
          insertStatement(ast, true);
          break;

        case 'FunctionDefinition':
        case 'ModifierDefinition':
        case 'YulFunctionDefinition':
          kids = [].concat(ast.parameters, ast.returnVariables, ast.body).filter(_ => _);
          if (ast.body) {
            insertFn(ast, ast.name);
          } else {
            insertStatement(ast, true);
          }
          break;

        case 'FunctionCall':
          kids = [ast.expression].concat(ast.arguments);
          break;

        case 'YulFunctionCall':
          kids = [ast.functionName].concat(ast.arguments);
          break;

        case 'Block':
        case 'UncheckedBlock':
        case 'YulBlock':
          kids = ast.statements;
          break;

        case 'InlineAssembly':
          kids = ast.AST.statements;
          break;

        case 'Assignment':
          kids = [ast.leftHandSide, ast.rightHandSide];
          insertStatement(ast);
          break;

        case 'IndexAccess':
          kids = [ast.baseExpression, ast.indexExpression];
          insertStatement(ast);
          break;

        case 'MemberAccess':
          kids = [ast.expression];
          insertStatement(ast);
          break;

        case 'ExpressionStatement':
          kids = [ast.expression];
          break;

        case 'ForStatement':
          kids = [ast.initializationExpression, ast.condition, ast.loopExpression, ast.body].filter(_ => _);
          break;

        case 'YulForLoop':
          kids = [ast.pre, ast.condition, ast.post, ast.body].filter(_ => _);
          break;

        case 'ParameterList':
          insertStatement(ast, true);
          break;

        case 'Return':
          kids = [ast.expression].filter(_ => _);
          insertStatement(ast);
          break;

        case 'TryStatement':
          kids = ast.clauses;
          break;

        case 'TryCatchClause':
          kids = [ast.block];
          break;

        case 'TupleExpression':
          kids = ast.components;
          break;

        case 'VariableDeclarationStatement':
          kids = ast.declarations.concat(ast.initialValue).filter(_ => _);
          break;

        case 'YulCase':
          kids = [ast.body];
          break;

        case 'Break':
        case 'Continue':
        case 'EmitStatement':
        case 'Identifier':
        case 'NewExpression':
        case 'RevertStatement':
        case 'PlaceholderStatement':
        case 'UnaryOperation':
        case 'VariableDeclaration':
        case 'YulAssignment':
        case 'YulBreak':
        case 'YulExpressionStatement':
        case 'YulIdentifier':
        case 'YulLeave':
        case 'YulTypedName':
        case 'YulVariableDeclaration':
          insertStatement(ast);
          break;

        case 'ElementaryTypeNameExpression':
        case 'EnumDefinition':
        case 'EventDefinition':
        case 'ErrorDefinition':
        case 'StructDefinition':
        case 'FunctionCallOptions':
        case 'Literal':
        case 'YulLiteral':
          insertStatement(ast, true);
          break;

        case 'ImportDirective':
        case 'PragmaDirective':
          break;

        case 'SourceUnit':
          kids = ast.nodes;
          break;

        default:
          console.warn('Unhandled ast type', ast.nodeType, ast)
          break;
      }
      kids.forEach(walk);
    }

    // do it
    walk(ast);

    return { branchMap, fnMap, statementMap };
  }
}
