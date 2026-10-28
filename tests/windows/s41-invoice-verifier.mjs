import assert from 'node:assert/strict';
import vm from 'node:vm';
export function verifyInvoiceCode(raw, normalized) {
  const code = raw.replace(/^```(?:javascript|js)?\s*|\s*```$/g, '').trim();
  // Exact bounded pure grammar before compilation: no arbitrary eval/tools,
  // imports, loops, getters, constructors, strings or ambient globals.
  const grammar = /^function\s+invoiceTotal\(items\)\s*\{\s*return\s+items\.reduce\(\(([a-zA-Z]+),\s*([a-zA-Z]+)\)\s*=>\s*\1\s*\+\s*(?:\2\.quantity\s*\*\s*\2\.unitPrice|\(\s*\2\.quantity\s*\*\s*\2\.unitPrice\s*\)),\s*0\);?\s*\}$/;
  assert.match(code, grammar, 'Generated code must satisfy the approved pure invoice grammar');
  const cases = [{ items: normalized.items, expected: 29 }, { items: [], expected: 0 }, { items: [{ quantity: 4, unitPrice: 3 }, { quantity: 1, unitPrice: 2 }], expected: 14 }];
  const results = cases.map(c => vm.runInNewContext(code + '\ninvoiceTotal(items)', { items: c.items }, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } }));
  results.forEach((n, i) => assert.equal(n, cases[i].expected));
  return { code, results, expected: cases.map(c => c.expected), strategy: 'STRICT_PURE_GRAMMAR_AND_THREE_EXECUTED_CASES', arbitraryCodeAllowed: false };
}
