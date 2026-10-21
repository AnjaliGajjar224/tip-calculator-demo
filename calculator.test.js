const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Test the exact calculation code used by the standalone HTML page.
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const calculationScript = html.match(/<script id="calculation">([\s\S]*?)<\/script>/);
assert.ok(calculationScript, 'The page must include its calculation script.');
const calculateTip = vm.runInThisContext(
  '(function () {' + calculationScript[1] + '; return calculateTip; })()',
  { filename: 'index.html calculation script' }
);

// A small DOM stand-in lets Node exercise the real input and click handlers.
// Browser checks separately verify native number-input behavior.
function createInterface() {
  function element() {
    return {
      textContent: '', attributes: {}, listeners: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      addEventListener(name, handler) { this.listeners[name] = handler; },
    };
  }
  const bill = Object.assign(element(), { value: '', valueAsNumber: NaN, validity: { badInput: false } });
  const tip = element();
  const total = element();
  const error = element();
  const buttons = [10, 15, 20].map(percent => Object.assign(element(), { dataset: { tip: String(percent) } }));
  const elements = { '#bill': bill, '#tip': tip, '#total': total, '#error': error };
  const document = {
    querySelector: selector => elements[selector],
    querySelectorAll: () => buttons,
  };
  const interfaceScript = html.match(/<script id="interface">([\s\S]*?)<\/script>/);
  assert.ok(interfaceScript, 'The page must include its interface script.');
  vm.runInNewContext(calculationScript[1] + interfaceScript[1], { document, Intl });
  return {
    bill, tip, total, error,
    input(value, badInput = false) {
      bill.value = value;
      bill.valueAsNumber = value === '' ? NaN : Number(value);
      bill.validity.badInput = badInput;
      bill.listeners.input();
    },
    choose(percent) { buttons.find(button => button.dataset.tip === String(percent)).listeners.click(); },
  };
}

const tests = [
  ['10% tip', () => assert.deepEqual(calculateTip(100, 10), { tip: 10, total: 110 })],
  ['15% tip', () => assert.deepEqual(calculateTip(100, 15), { tip: 15, total: 115 })],
  ['20% tip', () => assert.deepEqual(calculateTip(100, 20), { tip: 20, total: 120 })],
  ['zero bill', () => assert.deepEqual(calculateTip(0, 15), { tip: 0, total: 0 })],
  ['decimal bill and rounded tip', () => assert.deepEqual(calculateTip(42.75, 15), { tip: 6.41, total: 49.16 })],
  ['half-cent tip rounds up', () => assert.deepEqual(calculateTip(0.05, 10), { tip: 0.01, total: 0.06 })],
  ['bill rounds to cents', () => assert.deepEqual(calculateTip(1.005, 10), { tip: 0.1, total: 1.11 })],
  ['decimal rounding regression: 10.075', () => assert.deepEqual(calculateTip(10.075, 20), { tip: 2.02, total: 12.1 })],
  ['tiny amounts round to zero', () => assert.deepEqual(calculateTip(1e-7, 15), { tip: 0, total: 0 })],
  ['zero tip', () => assert.deepEqual(calculateTip(12.34, 0), { tip: 0, total: 12.34 })],
  ['invalid amounts are rejected', () => {
    for (const bill of [-1, -0.001, NaN, Infinity, -Infinity, '', 'abc', '100', null, undefined, Number.MAX_VALUE]) {
      assert.throws(() => calculateTip(bill, 15));
    }
  }],
  ['invalid percentages are rejected', () => {
    for (const percent of [-1, NaN, Infinity, '15', Number.MAX_VALUE]) {
      assert.throws(() => calculateTip(100, percent));
    }
  }],
  ['empty input shows zero without an error', () => {
    const ui = createInterface();
    assert.equal(ui.tip.textContent, '$0.00');
    assert.equal(ui.total.textContent, '$0.00');
    assert.equal(ui.error.textContent, '');
    assert.equal(ui.bill.attributes['aria-invalid'], undefined);
  }],
  ['zero input is valid', () => {
    const ui = createInterface();
    ui.input('0');
    ui.choose(20);
    assert.equal(ui.tip.textContent, '$0.00');
    assert.equal(ui.total.textContent, '$0.00');
    assert.equal(ui.error.textContent, '');
  }],
  ['negative, invalid, and excessive input clears stale results', () => {
    for (const [value, badInput] of [['-1', false], ['abc', true], ['', true], ['1e309', true], ['1e100', false]]) {
      const ui = createInterface();
      ui.input('100');
      ui.input(value, badInput);
      assert.equal(ui.tip.textContent, '—');
      assert.equal(ui.total.textContent, '—');
      assert.ok(ui.error.textContent);
      assert.equal(ui.bill.attributes['aria-invalid'], 'true');
    }
  }],
  ['clearing invalid input restores empty state', () => {
    const ui = createInterface();
    ui.input('-1');
    ui.input('');
    assert.equal(ui.tip.textContent, '$0.00');
    assert.equal(ui.total.textContent, '$0.00');
    assert.equal(ui.error.textContent, '');
    assert.equal(ui.bill.attributes['aria-invalid'], undefined);
  }],
  ['valid input recovers and buttons recalculate', () => {
    const ui = createInterface();
    ui.input('-1');
    ui.input('100');
    ui.choose(10);
    assert.equal(ui.tip.textContent, '$10.00');
    assert.equal(ui.total.textContent, '$110.00');
    ui.choose(20);
    assert.equal(ui.tip.textContent, '$20.00');
    assert.equal(ui.total.textContent, '$120.00');
    assert.equal(ui.error.textContent, '');
    assert.equal(ui.bill.attributes['aria-invalid'], undefined);
  }],
];

let failures = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}`, error);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} tests passed.`);
process.exitCode = failures ? 1 : 0;
