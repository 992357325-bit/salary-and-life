export const DEFAULTS = Object.freeze({ days: 22, hours: 8, commute: 0, lunch: 0 });
export const STORAGE_KEY = 'salary-and-life:v1';
export const blank = value => value == null || String(value).trim() === '';

function decimal(value, { label, fallback, max, positive = false, money = false }) {
  if (blank(value)) return { value: fallback ?? null };
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return { error: `${label}请填${positive ? '大于零的' : '非负'}数字，最多两位小数` };
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric > max || (positive && numeric <= 0)) {
    return { error: `${label}应${positive ? '大于 0 且' : ''}不超过 ${max}` };
  }
  if (!money) return { value: numeric };
  const [yuan, fraction = ''] = raw.split('.');
  return { value: Number(yuan) * 100 + Number(fraction.padEnd(2, '0')) };
}

export function calculate(input = {}) {
  const errors = {};
  const net = decimal(input.net, { label: '到手月薪', max: 999999999, money: true });
  if (net.error) errors.net = net.error;
  const settings = {};
  for (const [key, label, max, positive] of [
    ['days', '每月工作天数', 31, true], ['hours', '每天工作时长', 24, true],
    ['commute', '往返通勤', 1440, false], ['lunch', '午休时长', 1440, false],
  ]) {
    const parsed = decimal(input[key], { label, fallback: DEFAULTS[key], max, positive });
    if (parsed.error) errors[key] = parsed.error;
    settings[key] = parsed.value;
  }
  function sumExpenses(items, prefix) {
    let cents = 0;
    let filled = 0;
    for (const expense of Array.isArray(items) ? items : []) {
      const parsed = decimal(expense.amount, { label: expense.name || '支出金额', fallback: 0, max: 999999999, money: true });
      if (parsed.error) errors[`${prefix}:${expense.id}`] = parsed.error;
      else cents += parsed.value;
      if (!blank(expense.amount)) filled++;
    }
    return { cents, filled };
  }
  const fixed = sumExpenses(input.expenses, 'expense');
  const living = sumExpenses(input.livingExpenses, 'living');
  const expenseCents = fixed.cents;
  const filledExpenses = fixed.filled;
  const target = decimal(input.target, { label: '目标总存款', max: 999999999, money: true });
  const savings = decimal(input.savings, { label: '已有存款', fallback: 0, max: 999999999, money: true });
  const debt = decimal(input.debt, { label: '剩余负债总额', fallback: 0, max: 999999999, money: true });
  if (target.error) errors.target = target.error;
  if (savings.error) errors.savings = savings.error;
  if (debt.error) errors.debt = debt.error;
  const dailyOccupied = settings.hours + (settings.commute + settings.lunch) / 60;
  if (dailyOccupied > 24 && !['hours', 'commute', 'lunch'].some(key => errors[key])) {
    errors.totalTime = '工作、午休和往返通勤合计不能超过每天 24 小时';
  }
  const timeValid = !['days', 'hours', 'commute', 'lunch', 'totalTime'].some(key => errors[key]);
  const expenseValid = !Object.keys(errors).some(key => key.startsWith('expense:'));
  const livingValid = !Object.keys(errors).some(key => key.startsWith('living:'));
  const netCents = net.error ? null : net.value;
  const ready = netCents !== null;
  const workHours = timeValid ? settings.days * settings.hours : null;
  const occupiedHours = timeValid ? settings.days * dailyOccupied : null;
  const balanceCents = ready && expenseValid ? netCents - expenseCents : null;
  const monthlySavingsCents = balanceCents !== null && livingValid ? balanceCents - living.cents : null;
  const goalGapCents = !target.error && !savings.error && !debt.error && target.value !== null ? Math.max(0, target.value + debt.value - savings.value) : null;
  const goalReached = goalGapCents === 0;
  const savingMonths = goalReached ? 0 : goalGapCents !== null && monthlySavingsCents > 0 ? goalGapCents / monthlySavingsCents : null;
  const fullMonths = savingMonths === null ? null : Math.ceil(savingMonths);
  // Integer cents and hundredths of a workday avoid rounding 7.000000000000001 to 8.
  const equivalentWorkDays = savingMonths === null || !timeValid ? null : goalReached ? 0 : Math.ceil(goalGapCents * Math.round(settings.days * 100) / (monthlySavingsCents * 100));
  return {
    errors, settings, ready, timeValid, expenseValid, netCents,
    expenseCents: expenseValid ? expenseCents : null, filledExpenses,
    workHours, occupiedHours,
    hourlyCents: ready && timeValid ? netCents / workHours : null,
    occupiedHourlyCents: ready && timeValid ? netCents / occupiedHours : null,
    balanceCents,
    dailyCents: balanceCents === null ? null : Math.max(0, balanceCents) / 30,
    retainedHourlyCents: balanceCents !== null && timeValid ? balanceCents / occupiedHours : null,
    livingValid, livingExpenseCents: livingValid ? living.cents : null, filledLivingExpenses: living.filled,
    monthlySavingsCents, livingDailyCents: monthlySavingsCents === null ? null : Math.max(0, monthlySavingsCents) / 30,
    goalGapCents, goalReached, savingMonths, fullMonths, equivalentWorkDays,
    debtCents: debt.error ? null : debt.value,
  };
}

export function formatMoney(cents) {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDuration(months) {
  if (!Number.isSafeInteger(months) || months < 0) return '—';
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  if (!years) return `${remainder} 个月`;
  return `${years.toLocaleString('zh-CN')} 年 ${remainder} 个月`;
}

export function restore(storage) {
  try {
    const data = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (!data || data.version !== 1 || !data.remember || !data.input) return null;
    const clean = {};
    for (const key of ['gross', 'net', 'days', 'hours', 'commute', 'lunch', 'target', 'savings', 'debt']) {
      clean[key] = typeof data.input[key] === 'string' ? data.input[key].slice(0, 32) : '';
    }
    clean.expenses = Array.isArray(data.input.expenses) ? data.input.expenses.slice(0, 30).map((item, i) => ({
      id: `restored-${i}`, name: typeof item.name === 'string' ? item.name.slice(0, 30) : '其他支出',
      amount: typeof item.amount === 'string' ? item.amount.slice(0, 32) : '',
    })) : [];
    clean.livingExpenses = Array.isArray(data.input.livingExpenses) ? data.input.livingExpenses.slice(0, 30).map((item, i) => ({
      id: `living-restored-${i}`, name: typeof item.name === 'string' ? item.name.slice(0, 30) : '其他生活开支',
      amount: typeof item.amount === 'string' ? item.amount.slice(0, 32) : '',
    })) : [{ id: 'living-initial-0', name: '伙食费', amount: '' }];
    return clean;
  } catch { return null; }
}

export function persist(storage, input, remember) {
  try {
    if (remember) storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, remember: true, input }));
    else storage.removeItem(STORAGE_KEY);
    return true;
  } catch { return false; }
}
