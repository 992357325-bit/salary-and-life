import { calculate, formatMoney, persist, restore, blank } from './calculate.mjs';

const $ = id => document.getElementById(id);
const fieldKeys = ['gross', 'net', 'days', 'hours', 'commute', 'lunch'];
const initialExpenses = () => ['房租', '通勤', '水电', '其他 1', '其他 2', '其他 3'].map((name, i) => ({ id: `initial-${i}`, name, amount: '' }));
let input = { gross: '', net: '', days: '', hours: '', commute: '', lunch: '', expenses: initialExpenses() };
let storage = null;
try { storage = window.localStorage; } catch { /* Private browsing can disable storage. */ }
const saved = storage ? restore(storage) : null;
let remember = !!saved;
if (saved) input = saved;
let expenseIndex = 0;
let noticeTimer;
function notice(message) { $('notice').textContent = message; $('notice').classList.add('show'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').classList.remove('show'), 3500); }
function yuan(cents) { return cents === null ? '—' : `¥${formatMoney(cents)}`; }

function createExpenseRow(expense) {
  const row = document.createElement('div');
  row.className = 'expense-row';
  row.dataset.expenseId = expense.id;
  const name = document.createElement('input');
  name.className = 'expense-name';
  name.value = expense.name;
  name.maxLength = 30;
  name.placeholder = '支出名称';
  name.setAttribute('aria-label', '支出项目名称');
  const shell = document.createElement('div');
  shell.className = 'input-shell';
  const currency = document.createElement('span'); currency.textContent = '¥'; currency.setAttribute('aria-hidden', 'true');
  const amount = document.createElement('input');
  amount.value = expense.amount;
  amount.inputMode = 'decimal'; amount.maxLength = 16; amount.placeholder = '0.00'; amount.autocomplete = 'off';
  amount.setAttribute('aria-label', `${expense.name || '其他支出'}每月金额`);
  const unit = document.createElement('span'); unit.textContent = '元';
  shell.append(currency, amount, unit);
  const remove = document.createElement('button');
  remove.className = 'remove-expense'; remove.type = 'button'; remove.textContent = '×';
  remove.setAttribute('aria-label', `删除${expense.name || '这项支出'}`);
  const error = document.createElement('p'); error.className = 'error'; error.id = `error-${expense.id}`;
  amount.setAttribute('aria-describedby', error.id);
  name.addEventListener('input', () => { expense.name = name.value; amount.setAttribute('aria-label', `${expense.name || '其他支出'}每月金额`); remove.setAttribute('aria-label', `删除${expense.name || '这项支出'}`); update(); });
  amount.addEventListener('input', () => { expense.amount = amount.value; update(); });
  remove.addEventListener('click', () => { input.expenses = input.expenses.filter(item => item.id !== expense.id); row.remove(); update(); $('add-expense').focus(); });
  row.append(name, shell, remove, error);
  return row;
}

function renderExpenseRows() { $('expense-rows').replaceChildren(...input.expenses.map(createExpenseRow)); }
function save() {
  const success = storage ? persist(storage, input, remember) : !remember;
  if (!success) $('storage-note').textContent = remember ? '浏览器未能保存，当前填写仍可计算；关闭页面后可能丢失。' : '浏览器未能清除保存的数据，请在浏览器设置中清理本站数据。';
  else $('storage-note').textContent = remember ? '已在当前浏览器记住。关闭开关会删除保存的数据。' : '默认不保存。开启后仅保存在当前浏览器。';
}

function update(shouldSave = true) {
  const result = calculate(input);
  for (const key of ['net', 'days', 'hours', 'commute', 'lunch']) {
    const hasTotalTimeError = ['hours', 'commute', 'lunch'].includes(key) && result.errors.totalTime;
    $(key).setAttribute('aria-invalid', result.errors[key] || hasTotalTimeError ? 'true' : 'false');
    $(`${key}-error`).textContent = result.errors[key] || '';
  }
  $('totalTime-error').textContent = result.errors.totalTime || '';
  for (const row of $('expense-rows').children) {
    const error = result.errors[`expense:${row.dataset.expenseId}`];
    row.querySelector('.error').textContent = error || '';
    row.querySelector('.input-shell input').setAttribute('aria-invalid', error ? 'true' : 'false');
  }
  const { days, hours, commute, lunch } = result.settings;
  $('time-summary').textContent = result.timeValid ? `${days} 天 × ${hours} 小时${commute + lunch > 0 ? ' + 通勤 / 午休' : ''}` : '请检查填写的时间';
  $('hourly').textContent = formatMoney(result.hourlyCents);
  $('occupied-hourly').textContent = formatMoney(result.occupiedHourlyCents);
  $('work-formula').textContent = result.timeValid ? `到手月薪 ÷ ${days} 天 ÷ ${hours} 小时` : '修正时间后，自动重新计算';
  $('occupied-formula').textContent = result.timeValid ? `每月共占用 ${Number(result.occupiedHours.toFixed(2))} 小时` : '工作、通勤与午休一并计算';
  $('net-total').textContent = yuan(result.netCents);
  $('expense-total').textContent = result.expenseCents === null ? '请检查支出' : `− ${yuan(result.expenseCents)}`;
  $('balance').textContent = formatMoney(result.balanceCents === null ? null : Math.max(0, result.balanceCents));
  const deficit = result.balanceCents !== null && result.balanceCents < 0;
  $('deficit').hidden = !deficit;
  $('deficit').textContent = deficit ? `本月缺口 ${yuan(-result.balanceCents)}` : '';
  $('daily').textContent = formatMoney(result.dailyCents);
  $('retained-hourly').textContent = formatMoney(result.retainedHourlyCents === null ? null : Math.abs(result.retainedHourlyCents));
  $('retained-label').textContent = deficit ? '扣除支出后，每小时缺口' : '扣除支出后，每小时留下';
  $('balance-note').textContent = !result.ready ? (result.errors.net ? '请先修正到手月薪。' : '填入到手月薪，看看你的生活余额。') : !result.expenseValid ? '请修正支出金额，再查看余额。' : result.filledExpenses === 0 ? '尚未扣除生活开销，可在第二部分按需填写。' : '按已填写支出计算，未填写的项目不会扣除。';
  $('allocation').hidden = !(result.ready && result.expenseValid && result.netCents > 0);
  if (!$('allocation').hidden) {
    const portion = Math.min(100, result.expenseCents / result.netCents * 100);
    $('expense-bar').style.width = `${portion}%`;
    $('remaining-bar').style.width = `${100 - portion}%`;
    $('allocation-bar').setAttribute('aria-label', deficit ? `支出已超过到手月薪，缺口${yuan(-result.balanceCents)}` : `固定支出占收入 ${portion.toFixed(1)}%，剩余 ${(100 - portion).toFixed(1)}%`);
  }
  $('add-expense').disabled = input.expenses.length >= 30;
  if (shouldSave) save();
}

for (const key of fieldKeys) {
  $(key).value = input[key];
  $(key).addEventListener('input', () => { input[key] = $(key).value; update(); });
}
$('remember').checked = remember;
$('remember').addEventListener('change', () => { remember = $('remember').checked; save(); });
$('add-expense').addEventListener('click', () => {
  if (input.expenses.length >= 30) return;
  const expense = { id: `added-${++expenseIndex}`, name: '', amount: '' };
  input.expenses.push(expense);
  const row = createExpenseRow(expense);
  $('expense-rows').append(row); row.querySelector('input').focus(); update();
});
$('clear').addEventListener('click', () => {
  input = { gross: '', net: '', days: '', hours: '', commute: '', lunch: '', expenses: initialExpenses() };
  remember = false; $('remember').checked = false;
  fieldKeys.forEach(key => { $(key).value = ''; });
  renderExpenseRows(); update(); $('net').focus(); notice('已清空填写，工作时间恢复为 22 天 × 8 小时。');
});
renderExpenseRows();
if (saved) {
  $('time-details').open = ['days', 'hours', 'commute', 'lunch'].some(key => !blank(input[key]));
  $('expense-details').open = input.expenses.some(item => !blank(item.amount));
}
update(false);
if (saved) save();
