const assert = require('assert');
const lib = require('../dist/index.js');

const ConstructorCode = {
  "functionDebugData": {},
  "generatedSources": [],
  "immutableReferences": {},
  "linkReferences": {},
  "object": "6080604052600080fdfea26469706673582212207239d3f1ecf78a512729b73fb7becb79654bb9acde3c1c4886b1362fbab6230764736f6c634300080d0033",
  "opcodes": "PUSH1 0x80 PUSH1 0x40 MSTORE PUSH1 0x0 DUP1 REVERT INVALID LOG2 PUSH5 0x6970667358 0x22 SLT KECCAK256 PUSH19 0x39D3F1ECF78A512729B73FB7BECB79654BB9AC 0xDE EXTCODECOPY SHR BASEFEE DUP7 0xB1 CALLDATASIZE 0x2F 0xBA 0xB6 0x23 SMOD PUSH5 0x736F6C6343 STOP ADDMOD 0xD STOP CALLER ",
  "sourceMap": "155:997:1:-:0;;;;;"
};

const RuntimeCode = {
  "functionDebugData": {},
  "generatedSources": [],
  "linkReferences": {},
  "object": "6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea26469706673582212207239d3f1ecf78a512729b73fb7becb79654bb9acde3c1c4886b1362fbab6230764736f6c634300080d0033",
  "opcodes": "PUSH1 0x80 PUSH1 0x40 MSTORE CALLVALUE DUP1 ISZERO PUSH1 0xF JUMPI PUSH1 0x0 DUP1 REVERT JUMPDEST POP PUSH1 0x3F DUP1 PUSH1 0x1D PUSH1 0x0 CODECOPY PUSH1 0x0 RETURN INVALID PUSH1 0x80 PUSH1 0x40 MSTORE PUSH1 0x0 DUP1 REVERT INVALID LOG2 PUSH5 0x6970667358 0x22 SLT KECCAK256 PUSH19 0x39D3F1ECF78A512729B73FB7BECB79654BB9AC 0xDE EXTCODECOPY SHR BASEFEE DUP7 0xB1 CALLDATASIZE 0x2F 0xBA 0xB6 0x23 SMOD PUSH5 0x736F6C6343 STOP ADDMOD 0xD STOP CALLER ",
  "sourceMap": "155:997:1:-:0;;;;;;;;;;;;;;;;;;;"
};

describe('SourceMap.parse', () => {
  it('parses SourceMap from constructor code', async () => {
    const map = lib.SourceMap.parse(ConstructorCode);
    assert.equal(map.pcToInstructionIndex(18), 10);
    assert.deepEqual(map.instructionIndexToRange(5), {start: 155, length: 997, index: 1});
  });

  it('parses SourceMap from runtime code', async () => {
    const map = lib.SourceMap.parse(RuntimeCode);
    assert.equal(map.pcToInstructionIndex(183), 143);
    assert.deepEqual(map.instructionIndexToRange(7), {start: 155, length: 997, index: 1});
  });
});