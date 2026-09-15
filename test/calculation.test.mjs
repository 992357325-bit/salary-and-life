import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, formatMoney, persist, restore, STORAGE_KEY } from '../dist/calculate.mjs';
const expenses = (...amounts) => amounts.map((amount, id) => ({ id: String(id), name: `支出 ${id}`, amount: String(amount) }));

test('只填到手工资，默认22天8小时；税前薪资不影响结果', () => {
  const a = calculate({ net: '10000' });
  assert.equal(a.workHours, 176);
  assert.equal(formatMoney(a.hourlyCents), '56.82');
  assert.equal(formatMoney(a.occupiedHourlyCents), '56.82');
  assert.equal(a.balanceCents, 1000000);
  assert.deepEqual(calculate({ net: '10000', gross: '15000' }), a);
});

test('自填天数和小时优先；逐项清空只恢复该项默认值', () => {
  assert.equal(formatMoney(calculate({ net: '12000', days: '20', hours: '6' }).hourlyCents), '100.00');
  assert.equal(formatMoney(calculate({ net: '12000', days: '', hours: '6' }).hourlyCents), '90.91');
  assert.equal(formatMoney(calculate({ net: '12000', days: '', hours: '' }).hourlyCents), '68.18');
});

test('显式0不能当空值；时间错误不影响月度余额', () => {
  for (const key of ['days', 'hours']) {
    const result = calculate({ net: '10000', [key]: '0' });
    assert.ok(result.errors[key]);
    assert.equal(result.hourlyCents, null);
    assert.equal(result.occupiedHourlyCents, null);
    assert.equal(result.balanceCents, 1000000);
  }
});

test('午休和往返通勤按分钟相加，不再乘2', () => {
  const a = calculate({ net: '10000', commute: '30', lunch: '45' });
  assert.equal(a.occupiedHours, 203.5);
  assert.equal(formatMoney(a.hourlyCents), '56.82');
  assert.equal(formatMoney(a.occupiedHourlyCents), '49.14');
});

test('全部月度支出只扣一次，不改变收入时薪', () => {
  const a = calculate({ net: '10000', expenses: expenses(3000, 660, 200, 100, 200, 300) });
  assert.equal(a.expenseCents, 446000);
  assert.equal(a.balanceCents, 554000);
  assert.equal(formatMoney(a.hourlyCents), '56.82');
  assert.equal(formatMoney(a.retainedHourlyCents), '31.48');
});

test('固定示例：8000到手减2000、200、300等于5500', () => {
  const a = calculate({ net: '8000', expenses: expenses(2000, 200, 300) });
  assert.equal(a.balanceCents, 550000);
  assert.equal(formatMoney(a.dailyCents), '183.33');
});

test('保留完整精度直到展示；按分扣款', () => {
  const a = calculate({ net: '1000', days: '1', hours: '3', expenses: expenses(500) });
  assert.equal(formatMoney(a.retainedHourlyCents), '166.67');
  assert.equal(calculate({ net: '0.30', expenses: expenses('0.10', '0.20') }).balanceCents, 0);
});

test('赤字保留负数用于缺口，日预算归零；零工资是有效输入', () => {
  const a = calculate({ net: '5000', days: '20', expenses: expenses(5600) });
  assert.equal(a.balanceCents, -60000);
  assert.equal(a.retainedHourlyCents, -375);
  assert.equal(a.dailyCents, 0);
  assert.equal(calculate({ net: '0' }).ready, true);
  assert.equal(calculate({ net: '0' }).hourlyCents, 0);
  assert.equal(calculate({ net: '' }).ready, false);
});

test('非法金额不生成错误余额；时间独立；总占用不能超24小时', () => {
  for (const value of ['-1', 'abc', '1e5', 'Infinity', '1000000000', '1.234']) {
    assert.ok(calculate({ net: value }).errors.net);
    assert.equal(calculate({ net: '10000', expenses: expenses(value) }).balanceCents, null);
  }
  assert.ok(calculate({ net: '1000', days: '32' }).errors.days);
  assert.ok(calculate({ net: '1000', hours: '23', lunch: '120' }).errors.totalTime);
  assert.deepEqual(calculate({ net: '1000', days: '20.5', commute: '0', lunch: '0' }).errors, {});
});

test('仅主动开启后保存；关闭开关删除数据；损坏数据安全回退', () => {
  const map = new Map();
  const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
  const input = { gross: '', net: '8000', days: '20', hours: '', commute: '30', lunch: '60', expenses: expenses(2000) };
  assert.equal(restore(storage), null);
  assert.equal(persist(storage, input, true), true);
  assert.equal(restore(storage).net, '8000');
  assert.equal(restore(storage).days, '20');
  assert.equal(restore(storage).expenses[0].amount, '2000');
  persist(storage, input, false);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  storage.setItem(STORAGE_KEY, '{broken');
  assert.equal(restore(storage), null);
  assert.equal(persist({ setItem() { throw new Error('Quota exceeded'); } }, input, true), false);
});
