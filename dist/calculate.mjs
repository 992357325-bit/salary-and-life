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
  const expenses = Array.isArray(input.expenses) ? input.expenses : [];
  let expenseCents = 0;
  let filledExpenses = 0;
  for (const expense of expenses) {
    const parsed = decimal(expense.amount, { label: expense.name || '支出金额', fallback: 0, max: 999999999, money: true });
    if (parsed.error) errors[`expense:${expense.id}`] = parsed.error;
    else expenseCents += parsed.value;
    if (!blank(expense.amount)) filledExpenses++;
  }
  const dailyOccupied = settings.hours + (settings.commute + settings.lunch) / 60;
  if (dailyOccupied > 24 && !['hours', 'commute', 'lunch'].some(key => errors[key])) {
    errors.totalTime = '工作、午休和往返通勤合计不能超过每天 24 小时';
  }
  const timeValid = !['days', 'hours', 'commute', 'lunch', 'totalTime'].some(key => errors[key]);
  const expenseValid = !Object.keys(errors).some(key => key.startsWith('expense:'));
  const netCents = net.error ? null : net.value;
  const ready = netCents !== null;
  const workHours = timeValid ? settings.days * settings.hours : null;
  const occupiedHours = timeValid ? settings.days * dailyOccupied : null;
  const balanceCents = ready && expenseValid ? netCents - expenseCents : null;
  return {
    errors, settings, ready, timeValid, expenseValid, netCents,
    expenseCents: expenseValid ? expenseCents : null, filledExpenses,
    workHours, occupiedHours,
    hourlyCents: ready && timeValid ? netCents / workHours : null,
    occupiedHourlyCents: ready && timeValid ? netCents / occupiedHours : null,
    balanceCents,
    dailyCents: balanceCents === null ? null : Math.max(0, balanceCents) / 30,
    retainedHourlyCents: balanceCents !== null && timeValid ? balanceCents / occupiedHours : null,
  };
}

export function formatMoney(cents) {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function restore(storage) {
  try {
    const data = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (!data || data.version !== 1 || !data.remember || !data.input) return null;
    const clean = {};
    for (const key of ['gross', 'net', 'days', 'hours', 'commute', 'lunch']) {
      clean[key] = typeof data.input[key] === 'string' ? data.input[key].slice(0, 32) : '';
    }
    clean.expenses = Array.isArray(data.input.expenses) ? data.input.expenses.slice(0, 30).map((item, i) => ({
      id: `restored-${i}`, name: typeof item.name === 'string' ? item.name.slice(0, 30) : '其他支出',
      amount: typeof item.amount === 'string' ? item.amount.slice(0, 32) : '',
    })) : [];
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
