import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, formatMoney, formatDuration, persist, restore, STORAGE_KEY } from '../dist/calculate.mjs';
const expenses = (...amounts) => amounts.map((amount, id) => ({ id: String(id), name: `支出 ${id}`, amount: String(amount) }));

test('整月期限转换为几年几个月，整年保留零个月', () => {
  assert.equal(formatDuration(40), '3 年 4 个月');
  assert.equal(formatDuration(12), '1 年 0 个月');
  assert.equal(formatDuration(11), '11 个月');
  assert.equal(formatDuration(13), '1 年 1 个月');
  assert.equal(formatDuration(0), '0 个月');
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(-1), '—');
});

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

test('生活费从第二部分原始余额扣除；目标扣减已有存款', () => {
  const a = calculate({ net: '10000', expenses: expenses(4000), livingExpenses: expenses(2000), target: '12000', savings: '2000' });
  assert.equal(a.balanceCents, 600000);
  assert.equal(a.monthlySavingsCents, 400000);
  assert.equal(a.goalGapCents, 1000000);
  assert.equal(a.savingMonths, 2.5);
  assert.equal(a.fullMonths, 3);
  assert.equal(a.equivalentWorkDays, 55);
});

test('第三部分不把第二部分赤字截零；无结余时不生成期限', () => {
  const a = calculate({ net: '5000', expenses: expenses(5600), livingExpenses: expenses(500), target: '1000' });
  assert.equal(a.balanceCents, -60000);
  assert.equal(a.monthlySavingsCents, -110000);
  assert.equal(a.savingMonths, null);
  assert.equal(a.fullMonths, null);
  assert.equal(a.equivalentWorkDays, null);
  assert.equal(calculate({ net: '5000', expenses: expenses(3000), livingExpenses: expenses(2000), target: '1000' }).savingMonths, null);
});

test('折算工作日避免浮点误差把7天变成8天', () => {
  const a = calculate({ net: '2500', days: '25', target: '700' });
  assert.equal(a.equivalentWorkDays, 7);
  assert.equal(calculate({ net: '0', target: '0' }).equivalentWorkDays, 0);
});

test('已达到目标无需额外积累；空目标没有期限；小额目标至少一个存入月', () => {
  const reached = calculate({ net: '0', target: '10000', savings: '12000' });
  assert.equal(reached.goalGapCents, 0);
  assert.equal(reached.goalReached, true);
  assert.equal(reached.fullMonths, 0);
  assert.equal(calculate({ net: '10000', target: '' }).goalGapCents, null);
  const small = calculate({ net: '4000', target: '100' });
  assert.equal(small.fullMonths, 1);
  assert.equal(small.equivalentWorkDays, 1);
});

test('生活费或目标非法只影响相关结果；月数不依赖工作天数', () => {
  const invalidLiving = calculate({ net: '8000', livingExpenses: expenses('-10'), target: '10000' });
  assert.equal(invalidLiving.balanceCents, 800000);
  assert.equal(invalidLiving.monthlySavingsCents, null);
  const invalidTarget = calculate({ net: '8000', target: '-1' });
  assert.equal(invalidTarget.monthlySavingsCents, 800000);
  assert.equal(invalidTarget.goalGapCents, null);
  const invalidDays = calculate({ net: '8000', days: '0', target: '16000' });
  assert.equal(invalidDays.fullMonths, 2);
  assert.equal(invalidDays.equivalentWorkDays, null);
});

test('本地保存含生活费、目标和已有存款；旧数据可继续读取', () => {
  let value;
  const storage = { getItem: () => value, setItem: (key, data) => { value = data; }, removeItem: () => { value = null; } };
  persist(storage, { net: '10000', livingExpenses: expenses(1500), target: '20000', savings: '5000' }, true);
  assert.equal(restore(storage).livingExpenses[0].amount, '1500');
  assert.equal(restore(storage).target, '20000');
  assert.equal(restore(storage).savings, '5000');
  value = JSON.stringify({ version: 1, remember: true, input: { net: '10000', expenses: [] } });
  assert.equal(restore(storage).net, '10000');
  assert.equal(restore(storage).livingExpenses[0].name, '伙食费');
  assert.equal(restore(storage).target, '');
  assert.equal(restore(storage).debt, '');
});

test('负债计入待积累金额，不再次扣月结余；期限显示年月', () => {
  const a = calculate({ net: '10000', expenses: expenses(3000), livingExpenses: expenses(2000), target: '100000', savings: '20000', debt: '120000' });
  assert.equal(a.monthlySavingsCents, 500000);
  assert.equal(a.debtCents, 12000000);
  assert.equal(a.goalGapCents, 20000000);
  assert.equal(a.fullMonths, 40);
  assert.equal(formatDuration(a.fullMonths), '3 年 4 个月');
});

test('已有存款同时抵消目标与负债，不能先截零再加债务', () => {
  const a = calculate({ net: '5000', target: '10000', savings: '15000', debt: '8000' });
  assert.equal(a.goalGapCents, 300000);
  assert.equal(a.fullMonths, 1);
  const reached = calculate({ net: '0', target: '10000', savings: '18000', debt: '8000' });
  assert.equal(reached.goalReached, true);
  assert.equal(reached.fullMonths, 0);
  assert.equal(calculate({ net: '2000', target: '0', debt: '6000' }).fullMonths, 3);
});

test('负债空白为零；负债非法不影响月预算；无结余仍不生成期限', () => {
  assert.equal(calculate({ net: '5000', target: '10000', debt: '' }).fullMonths, 2);
  for (const debt of ['-1', 'abc', '1.001']) {
    const a = calculate({ net: '5000', target: '10000', debt });
    assert.ok(a.errors.debt);
    assert.equal(a.goalGapCents, null);
    assert.equal(a.monthlySavingsCents, 500000);
  }
  assert.equal(calculate({ net: '0', target: '0', debt: '1000' }).fullMonths, null);
  const rounded = calculate({ net: '100', target: '1200.01' });
  assert.equal(formatDuration(rounded.fullMonths), '1 年 1 个月');
});

test('主动保存可恢复负债，关闭保存后删除', () => {
  let value;
  const storage = { getItem: () => value, setItem: (key, data) => { value = data; }, removeItem: () => { value = null; } };
  persist(storage, { net: '5000', target: '10000', debt: '8000' }, true);
  assert.equal(restore(storage).debt, '8000');
  persist(storage, {}, false);
  assert.equal(restore(storage), null);
});

test('第四部分验收：月结余5000，差额72000，2年内每月可花2000', () => {
  const r = calculate({ net: '11000', expenses: expenses(4000), livingExpenses: expenses(2000), target: '80000', savings: '20000', debt: '12000', deadlineYears: '2' });
  assert.equal(r.monthlySavingsCents, 500000);
  assert.equal(r.goalGapCents, 7200000);
  assert.equal(r.deadlineMonths, 24);
  assert.equal(r.monthlyReserveCents, 300000);
  assert.equal(r.freeSpendingCents, 200000);
  assert.equal(formatMoney(r.freeDailyCents), '66.67');
  assert.equal(r.monthlyShortfallCents, 0);
  assert.equal(r.fullMonths, 15);
});

test('空期限不套用最快月数；0、负数、小数和超范围期限独立报错', () => {
  const base = { net: '5000', target: '72000' };
  const empty = calculate(base);
  assert.equal(empty.deadlineEmpty, true);
  assert.equal(empty.monthlyReserveCents, null);
  assert.equal(empty.freeSpendingCents, null);
  for (const deadline of [{ deadlineYears: '0' }, { deadlineMonths: '0' }, { deadlineYears: '-1' }, { deadlineYears: '1.5' }, { deadlineYears: '10000' }, { deadlineMonths: '12' }, { deadlineMonths: '1.2' }]) {
    const r = calculate({ ...base, ...deadline });
    assert.ok(r.errors.deadline || r.errors.deadlineYears || r.errors.deadlineMonths);
    assert.equal(r.freeSpendingCents, null);
    assert.equal(r.fullMonths, 15);
  }
  assert.equal(calculate({ ...base, deadlineMonths: '6' }).deadlineMonths, 6);
  assert.equal(calculate({ ...base, deadlineYears: '1', deadlineMonths: '2' }).deadlineMonths, 14);
});

test('目标预留向上取整到分，缺口使用未截零的原始结余', () => {
  const cents = calculate({ net: '1000', target: '1', deadlineMonths: '3' });
  assert.equal(cents.monthlyReserveCents, 34);
  assert.equal(cents.freeSpendingCents, 99966);
  const short = calculate({ net: '1000', target: '24000', deadlineYears: '1' });
  assert.equal(short.freeSpendingCents, 0);
  assert.equal(short.freeDailyCents, 0);
  assert.equal(short.monthlyShortfallCents, 100000);
  const deficit = calculate({ net: '1000', expenses: expenses(1100), target: '2400', deadlineYears: '1' });
  assert.equal(deficit.monthlyShortfallCents, 30000);
  assert.equal(deficit.freeSpendingCents, 0);
});

test('目标达成无需期限、无需预留；空目标和仍有负债不误认为达成', () => {
  const reached = calculate({ net: '5000', target: '10000', savings: '20000', debt: '10000' });
  assert.equal(reached.monthlyReserveCents, 0);
  assert.equal(reached.freeSpendingCents, 500000);
  const invalidDeadline = calculate({ net: '5000', target: '0', deadlineMonths: '12' });
  assert.ok(invalidDeadline.errors.deadlineMonths);
  assert.equal(invalidDeadline.monthlyReserveCents, 0);
  assert.equal(calculate({ net: '5000', target: '0', debt: '1000' }).monthlyReserveCents, null);
  assert.equal(calculate({ net: '5000', deadlineYears: '2' }).freeSpendingCents, null);
  assert.equal(calculate({ target: '0' }).freeSpendingCents, null);
});

test('期限随主动保存恢复，旧版本数据保留原值且不补默认期限', () => {
  let value;
  const storage = { getItem: () => value, setItem: (key, data) => { value = data; }, removeItem: () => { value = null; } };
  persist(storage, { net: '12345', debt: '6789', deadlineYears: '2', deadlineMonths: '3' }, true);
  const saved = restore(storage);
  assert.equal(saved.deadlineYears, '2');
  assert.equal(saved.deadlineMonths, '3');
  assert.equal(saved.net, '12345');
  value = JSON.stringify({ version: 1, remember: true, input: { net: '12345', debt: '6789' } });
  assert.equal(restore(storage).deadlineYears, '');
  assert.equal(restore(storage).deadlineMonths, '');
  assert.equal(restore(storage).debt, '6789');
  persist(storage, saved, false);
  assert.equal(restore(storage), null);
});
