/* ══════════════════════════════════════════════════
   ClearBudget — app.js
   Full application logic: data, rendering, calculations
══════════════════════════════════════════════════ */

'use strict';

// ── SAMPLE STARTER DATA ──────────────────────────
const SAMPLE_DATA = {
  income: [
    { id: uid(), name: 'Primary Job', amount: 2400, freq: 'biweekly' },
    { id: uid(), name: 'Side Freelance', amount: 350, freq: 'monthly' }
  ],
  bills: [
    { id: uid(), name: 'Mortgage / Rent', amount: 1200, due: 1,  category: 'Housing',        autopay: true  },
    { id: uid(), name: 'Electric',        amount: 110,  due: 15, category: 'Utilities',       autopay: false },
    { id: uid(), name: 'Internet',        amount: 60,   due: 10, category: 'Utilities',       autopay: true  },
    { id: uid(), name: 'Car Insurance',   amount: 145,  due: 20, category: 'Insurance',       autopay: true  },
    { id: uid(), name: 'Phone',           amount: 85,   due: 22, category: 'Other',           autopay: false },
    { id: uid(), name: 'Netflix + Hulu',  amount: 28,   due: 5,  category: 'Subscriptions',   autopay: true  }
  ],
  debts: [
    { id: uid(), name: 'Visa Card',      balance: 3200, rate: 22.99, minpay: 90,  due: 8,  promo: '' },
    { id: uid(), name: 'Student Loan',   balance: 11500, rate: 5.5,  minpay: 180, due: 18, promo: '' },
    { id: uid(), name: 'MasterCard',     balance: 880,  rate: 24.99, minpay: 35,  due: 12, promo: '06/2025' }
  ],
  goals: [
    { id: uid(), name: 'Emergency Fund', target: 10000, saved: 1800, monthly: 200 },
    { id: uid(), name: 'Vacation Fund',  target: 2500,  saved: 600,  monthly: 100 }
  ]
};

// ── STATE ────────────────────────────────────────
let state = { income: [], bills: [], debts: [], goals: [] };
let spendingChart = null;
let currentDebtSort = 'avalanche'; // Default sort method
let currentIncomeSort = 'amount'; // Default income sort

// ── UTILITIES ────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function fmt(n) {
  // Format a number as $X,XXX.XX
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSigned(n) {
  return (n < 0 ? '-' : '') + fmt(n);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toMonthly(amount, freq) {
  if (freq === 'weekly')    return amount * 52 / 12;
  if (freq === 'biweekly')  return amount * 26 / 12;
  return amount; // monthly
}

function today() { return new Date().getDate(); }

function billStatus(due) {
  const d = today();
  if (due < d && (d - due) > 0 && (d - due) <= 3) return 'overdue';
  if (due >= d && due - d <= 5) return 'soon';
  return 'ok';
}

function payoffMonths(balance, rate, payment) {
  // Standard amortization payoff time in months
  if (payment <= 0 || balance <= 0) return Infinity;
  const r = rate / 100 / 12;
  if (r === 0) return Math.ceil(balance / payment);
  const n = -Math.log(1 - (r * balance) / payment) / Math.log(1 + r);
  return isFinite(n) && n > 0 ? Math.ceil(n) : Infinity;
}

// Calculate suggested extra payment for each debt
function calculateSuggestedPayments() {
  const remaining = calcRemaining();
  if (remaining <= 0 || state.debts.length === 0) {
    return state.debts.map(d => ({ id: d.id, suggested: 0, reason: 'No extra cash available' }));
  }

  const suggestions = [];
  let availableExtra = remaining * 0.8; // Use 80% of remaining for debt, keep 20% buffer

  // Clone debts for manipulation
  const debtsWithSuggestions = state.debts.map(d => {
    const now = new Date();
    let suggestedPayment = d.minpay;
    let reason = 'Minimum payment only';
    let promoMonthsLeft = null;

    // Check for promo APR
    if (d.promo) {
      const [m, y] = d.promo.split('/').map(Number);
      if (m && y) {
        promoMonthsLeft = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
        
        if (promoMonthsLeft > 0 && promoMonthsLeft <= 12) {
          // Urgently pay off before promo ends
          const promoPayment = Math.ceil(d.balance / promoMonthsLeft);
          if (promoPayment > d.minpay) {
            suggestedPayment = promoPayment;
            reason = `Pay off before promo ends (${promoMonthsLeft} mo left)`;
          }
        }
      }
    }

    return { 
      ...d, 
      suggestedPayment, 
      reason, 
      promoMonthsLeft,
      priority: 0 
    };
  });

  // If no promo urgency, use avalanche method (highest APR first)
  const sorted = [...debtsWithSuggestions].sort((a, b) => b.rate - a.rate);
  
  // Allocate extra payment to highest priority debt
  if (availableExtra > 0 && sorted.length > 0) {
    const topDebt = sorted[0];
    
    // Find if there's a promo debt that needs urgent payment
    const urgentPromo = debtsWithSuggestions.find(d => 
      d.promoMonthsLeft !== null && d.promoMonthsLeft > 0 && d.promoMonthsLeft <= 6
    );

    if (urgentPromo) {
      // Prioritize promo debt
      const needed = urgentPromo.suggestedPayment - urgentPromo.minpay;
      const allocated = Math.min(availableExtra, needed);
      urgentPromo.suggestedPayment = urgentPromo.minpay + allocated;
      urgentPromo.priority = 1;
    } else {
      // Use avalanche method - add extra to highest APR
      topDebt.suggestedPayment = topDebt.minpay + Math.min(availableExtra, topDebt.balance - topDebt.minpay);
      topDebt.reason = `Highest APR (${topDebt.rate}%) - avalanche method`;
      topDebt.priority = 1;
    }
  }

  return debtsWithSuggestions.map(d => ({
    id: d.id,
    suggested: Math.min(d.suggestedPayment, d.balance),
    reason: d.reason,
    priority: d.priority
  }));
}

// ── INDEXEDDB STORAGE (More Reliable than localStorage) ──
const DB_NAME = 'BudgetingReadyDB';
const DB_VERSION = 1;
const STORE_NAME = 'budgetData';
let db = null;

// Initialize IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      console.error('IndexedDB failed to open, falling back to localStorage');
      resolve(false); // Fallback to localStorage
    };
    
    request.onsuccess = () => {
      db = request.result;
      resolve(true);
    };
    
    request.onupgradeneeded = (event) => {
      db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

// Save state to IndexedDB (with localStorage fallback)
function saveState() {
  // Save to localStorage as backup
  try {
    localStorage.setItem('budgetingready_v1', JSON.stringify(state));
  } catch(e) { /* quota exceeded */ }
  
  // Save to IndexedDB
  if (!db) return;
  
  try {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put({ id: 'currentBudget', data: state, timestamp: Date.now() });
  } catch(e) {
    console.error('IndexedDB save failed:', e);
  }
}

// Load state from IndexedDB (with localStorage fallback)
async function loadState() {
  if (!db) {
    // Fallback to localStorage
    const raw = localStorage.getItem('budgetingready_v1');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        state = { income: [], bills: [], debts: [], goals: [], ...parsed };
        return true;
      } catch(e) { /* corrupt */ }
    }
    return false;
  }
  
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get('currentBudget');
      
      request.onsuccess = () => {
        if (request.result && request.result.data) {
          state = { income: [], bills: [], debts: [], goals: [], ...request.result.data };
          resolve(true);
        } else {
          // Try localStorage fallback
          const raw = localStorage.getItem('budgetingready_v1');
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              state = { income: [], bills: [], debts: [], goals: [], ...parsed };
              saveState(); // Migrate to IndexedDB
              resolve(true);
              return;
            } catch(e) { /* corrupt */ }
          }
          resolve(false);
        }
      };
      
      request.onerror = () => resolve(false);
    } catch(e) {
      resolve(false);
    }
  });
}

// ── CALCULATIONS ─────────────────────────────────
function calcTotalIncome() {
  return state.income.reduce((sum, s) => sum + toMonthly(s.amount, s.freq), 0);
}

function calcTotalBills() {
  return state.bills.reduce((sum, b) => sum + b.amount, 0);
}

function calcTotalDebtMin() {
  return state.debts.reduce((sum, d) => sum + d.minpay, 0);
}

function calcTotalDebt() {
  return state.debts.reduce((sum, d) => sum + d.balance, 0);
}

function calcRemaining() {
  return calcTotalIncome() - calcTotalBills() - calcTotalDebtMin();
}

function calcHealthScore() {
  // 0–100 score based on fixed expense ratio, debt load, and remaining
  const income = calcTotalIncome();
  if (income === 0) return null;
  const ratio = (calcTotalBills() + calcTotalDebtMin()) / income;
  const debtToIncome = calcTotalDebt() / (income * 12);
  let score = 100;
  if (ratio > 0.5)  score -= (ratio - 0.5) * 120;
  if (ratio > 0.8)  score -= 20;
  if (debtToIncome > 1) score -= 15;
  if (debtToIncome > 3) score -= 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function spendingByCategory() {
  const cats = {};
  state.bills.forEach(b => {
    cats[b.category] = (cats[b.category] || 0) + b.amount;
  });
  // Add debt as its own category
  const totalDebt = calcTotalDebtMin();
  if (totalDebt > 0) cats['Debt Payments'] = totalDebt;
  return cats;
}

// ── TOAST NOTIFICATIONS ──────────────────────────
function showToast(msg, type = 'success', duration = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast'; }, duration);
}

// ── DASHBOARD / SUMMARY UPDATE ───────────────────
function updateDashboard() {
  const income   = calcTotalIncome();
  const bills    = calcTotalBills();
  const debtMin  = calcTotalDebtMin();
  const totalDebt = calcTotalDebt();
  const remaining = calcRemaining();
  const score    = calcHealthScore();

  // Stat cards
  document.getElementById('stat-income').textContent          = fmt(income);
  document.getElementById('stat-bills').textContent           = fmt(bills);
  document.getElementById('stat-debt-payments').textContent   = fmt(debtMin);
  document.getElementById('stat-total-debt').textContent      = fmt(totalDebt);

  // Balance card
  const balEl = document.getElementById('balance-display');
  const cardEl = document.getElementById('balance-card');
  balEl.textContent = fmtSigned(remaining);
  balEl.className = 'balance-amount';
  if (remaining < 0)     balEl.classList.add('negative');
  else if (remaining < income * 0.1 && income > 0) balEl.classList.add('warning');

  // Insight message
  const insightEl = document.getElementById('balance-insight');
  if (income === 0) {
    insightEl.textContent = 'Add your income sources to get started.';
  } else if (remaining < 0) {
    insightEl.textContent = `⚠️ You're overspending by ${fmt(Math.abs(remaining))} this month.`;
  } else if (remaining < income * 0.1) {
    insightEl.textContent = `⚠️ Very little wiggle room — try cutting ${fmt(income * 0.1 - remaining)} in expenses.`;
  } else {
    const savings = remaining * 0.2;
    insightEl.textContent = `✓ You can save up to ${fmt(savings)} this month. Keep it up!`;
  }

  // Mini progress bars
  if (income > 0) {
    document.getElementById('bar-income').style.width = '100%';
    document.getElementById('bar-bills').style.width  = Math.min(100, bills / income * 100) + '%';
    document.getElementById('bar-debt').style.width   = Math.min(100, debtMin / income * 100) + '%';
  }
  document.getElementById('lbl-income-sum').textContent = fmt(income);
  document.getElementById('lbl-bills-sum').textContent  = fmt(bills);
  document.getElementById('lbl-debt-sum').textContent   = fmt(debtMin);

  // Section badges
  document.getElementById('badge-income').textContent = fmt(income) + '/mo';
  document.getElementById('badge-bills').textContent  = fmt(bills) + '/mo';
  document.getElementById('badge-debt').textContent   = fmt(totalDebt) + ' total';

  // Health score
  const scoreEl = document.getElementById('health-score');
  if (score !== null) {
    scoreEl.textContent = score + '/100';
    scoreEl.style.color = score >= 70 ? 'var(--green)' : score >= 45 ? 'var(--yellow)' : 'var(--red)';
  } else {
    scoreEl.textContent = '—';
    scoreEl.style.color = 'var(--text3)';
  }

  // Cash flow section
  document.getElementById('cf-income').textContent    = fmt(income);
  document.getElementById('cf-bills').textContent     = '- ' + fmt(bills);
  document.getElementById('cf-debt').textContent      = '- ' + fmt(debtMin);
  const remEl = document.getElementById('cf-remaining');
  remEl.textContent = fmtSigned(remaining);
  remEl.className   = 'cf-value ' + (remaining < 0 ? 'red' : remaining < income * 0.1 ? 'yellow' : 'green');
  document.getElementById('cf-savings').textContent   = remaining > 0 ? fmt(remaining * 0.2) : '$0.00';
  const ratio = income > 0 ? Math.round((bills + debtMin) / income * 100) : 0;
  const ratioEl = document.getElementById('cf-ratio');
  ratioEl.textContent = ratio + '%';
  ratioEl.className   = 'cf-value ' + (ratio > 80 ? 'red' : ratio > 60 ? 'yellow' : 'green');

  updateSmartTips(income, bills, debtMin, remaining, ratio);
  updateChart();
}

// ── SMART TIPS ───────────────────────────────────
function updateSmartTips(income, bills, debtMin, remaining, ratio) {
  const tips = [];

  if (income === 0) {
    tips.push({ icon: '💡', text: 'Start by adding your income sources above.' });
  }

  if (ratio > 80) {
    tips.push({ icon: '🔴', text: `You're spending ${ratio}% of income on fixed expenses. The recommended limit is 50–60%.` });
  } else if (ratio > 60) {
    tips.push({ icon: '🟡', text: `Fixed expenses are at ${ratio}% of income. Try to get below 60% for financial flexibility.` });
  } else if (ratio > 0) {
    tips.push({ icon: '🟢', text: `Great! Your fixed expense ratio is ${ratio}% — within the healthy range.` });
  }

  // Debt strategy tip
  if (state.debts.length > 1) {
    const highApr = [...state.debts].sort((a, b) => b.rate - a.rate)[0];
    const lowBal  = [...state.debts].sort((a, b) => a.balance - b.balance)[0];
    tips.push({ icon: '💳', text: `Avalanche method: Pay extra on "${highApr.name}" (${highApr.rate}% APR) to minimize interest. Or Snowball: tackle "${lowBal.name}" (${fmt(lowBal.balance)}) first for momentum.` });
  }

  // Promo APR warning
  const promoDebts = state.debts.filter(d => d.promo);
  promoDebts.forEach(d => {
    const [m, y] = d.promo.split('/').map(Number);
    if (m && y) {
      const promoDate = new Date(y, m - 1, 1);
      const now = new Date();
      const diffDays = Math.round((promoDate - now) / (1000 * 60 * 60 * 24));
      if (diffDays > 0 && diffDays < 90) {
        tips.push({ icon: '⏰', text: `"${d.name}" promo APR ends in ${diffDays} days. Pay ${fmt(d.balance)} before then to avoid interest charges.` });
      }
    }
  });

  // Savings recommendation
  if (remaining > 0 && income > 0) {
    const emergencyTarget = income * 6;
    const totalSaved = state.goals.reduce((s, g) => s + g.saved, 0);
    if (totalSaved < emergencyTarget) {
      tips.push({ icon: '🏦', text: `Consider saving ${fmt(remaining * 0.2)}/mo. Your 6-month emergency fund target: ${fmt(emergencyTarget)}.` });
    }
  }

  if (remaining < 0) {
    tips.push({ icon: '⚠️', text: `You're over budget by ${fmt(Math.abs(remaining))}. Look for subscriptions or expenses to cut.` });
  }

  const container = document.getElementById('tips-body');
  if (tips.length === 0) {
    container.innerHTML = '<div class="no-tips">No tips yet — add your data above.</div>';
    return;
  }
  container.innerHTML = tips.map(t =>
    `<div class="tip-item"><span class="tip-icon">${t.icon}</span><span>${escHtml(t.text)}</span></div>`
  ).join('');
}

// ── PIE CHART ────────────────────────────────────
const CAT_COLORS = {
  'Housing':        '#4f8cff',
  'Utilities':      '#2dd4a0',
  'Transportation': '#f5834a',
  'Insurance':      '#a78bfa',
  'Subscriptions':  '#f5c842',
  'Food':           '#f05252',
  'Healthcare':     '#38bdf8',
  'Other':          '#9aa3be',
  'Debt Payments':  '#f05252'
};

function updateChart() {
  const cats = spendingByCategory();
  const labels = Object.keys(cats);
  const values = Object.values(cats);
  const chartEmpty = document.getElementById('chart-empty');

  if (labels.length === 0) {
    chartEmpty.style.display = 'flex';
    if (spendingChart) { spendingChart.destroy(); spendingChart = null; }
    return;
  }
  chartEmpty.style.display = 'none';

  const colors = labels.map(l => CAT_COLORS[l] || '#9aa3be');
  const ctx = document.getElementById('spendingChart').getContext('2d');

  if (spendingChart) {
    spendingChart.data.labels = labels;
    spendingChart.data.datasets[0].data   = values;
    spendingChart.data.datasets[0].backgroundColor = colors;
    spendingChart.update('none');
    return;
  }

  spendingChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#1e2230',
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#9aa3be',
            font: { family: 'DM Mono', size: 11 },
            padding: 12,
            boxWidth: 12
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${fmt(ctx.parsed)}`
          },
          bodyFont: { family: 'DM Mono', size: 12 },
          backgroundColor: '#252a3a',
          borderColor: '#2a2f42',
          borderWidth: 1,
          padding: 10
        }
      },
      cutout: '65%'
    }
  });
}

// ── INCOME SECTION ───────────────────────────────
function renderIncomeRows() {
  const tbody = document.getElementById('income-rows');
  const empty = document.getElementById('income-empty');
  const tableWrap = document.querySelector('#income-body .table-wrap');
  const sortSelect = document.getElementById('income-sort');

  if (state.income.length === 0) {
    empty.classList.add('show');
    tableWrap.style.display = 'none';
    if (sortSelect) sortSelect.parentElement.style.display = 'none';
    return;
  }
  empty.classList.remove('show');
  tableWrap.style.display = '';
  if (sortSelect) sortSelect.parentElement.style.display = '';

  // Sort income
  const sorted = [...state.income].sort((a, b) => {
    if (currentIncomeSort === 'amount') return toMonthly(b.amount, b.freq) - toMonthly(a.amount, a.freq);
    if (currentIncomeSort === 'name') return a.name.localeCompare(b.name);
    if (currentIncomeSort === 'frequency') return a.freq.localeCompare(b.freq);
    return 0;
  });

  tbody.innerHTML = sorted.map(src => {
    const monthly = toMonthly(src.amount, src.freq);
    const freqLabel = { weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly' }[src.freq];
    return `<tr data-id="${escHtml(src.id)}" onclick="openEditModal('income','${escHtml(src.id)}',event)" title="Click to edit">
      <td><span class="mono">${escHtml(src.name)}</span></td>
      <td><span class="mono">${fmt(src.amount)}</span></td>
      <td class="col-hide-sm">${escHtml(freqLabel)}</td>
      <td><span class="mono" style="color:var(--green)">${fmt(monthly)}</span></td>
      <td style="text-align:right">
        <button class="btn-icon" onclick="deleteItem('income','${escHtml(src.id)}');event.stopPropagation()" title="Delete">&#x2715;</button>
      </td>
    </tr>`;
  }).join('');
}

document.getElementById('btn-add-income').addEventListener('click', () => {
  const name   = document.getElementById('income-name').value.trim();
  const amount = parseFloat(document.getElementById('income-amount').value);
  const freq   = document.getElementById('income-freq').value;
  if (!name || isNaN(amount) || amount <= 0) {
    showToast('Please fill in a name and valid amount.', 'error'); return;
  }
  state.income.push({ id: uid(), name, amount, freq });
  saveState();
  renderIncomeRows();
  updateDashboard();
  document.getElementById('income-name').value = '';
  document.getElementById('income-amount').value = '';
  showToast('Income source added!');
});

// Income sort handler
const incomeSortEl = document.getElementById('income-sort');
if (incomeSortEl) {
  incomeSortEl.addEventListener('change', (e) => {
    currentIncomeSort = e.target.value;
    renderIncomeRows();
  });
}

// ── BILLS SECTION ────────────────────────────────
function renderBillRows() {
  const sort = document.getElementById('bills-sort').value;
  const tbody = document.getElementById('bills-rows');
  const empty = document.getElementById('bills-empty');
  const tableWrap = document.querySelector('#bills-body .table-wrap');

  if (state.bills.length === 0) {
    empty.classList.add('show');
    tableWrap.style.display = 'none';
    return;
  }
  empty.classList.remove('show');
  tableWrap.style.display = '';

  const sorted = [...state.bills].sort((a, b) => {
    if (sort === 'dueDate') return a.due - b.due;
    if (sort === 'amount')  return b.amount - a.amount;
    return a.name.localeCompare(b.name);
  });

  tbody.innerHTML = sorted.map(bill => {
    const status = billStatus(bill.due);
    const statusBadge = {
      overdue: '<span class="badge badge-red">Overdue</span>',
      soon:    '<span class="badge badge-yellow">Due Soon</span>',
      ok:      '<span class="badge badge-green">OK</span>'
    }[status];
    return `<tr data-id="${escHtml(bill.id)}" onclick="openEditModal('bills','${escHtml(bill.id)}',event)" title="Click to edit">
      <td><span class="mono">${escHtml(bill.name)}</span></td>
      <td><span class="mono">${fmt(bill.amount)}</span></td>
      <td class="col-hide-sm">Day ${bill.due}</td>
      <td class="col-hide-sm"><span class="badge badge-blue">${escHtml(bill.category)}</span></td>
      <td class="col-hide-sm">${bill.autopay ? '<span class="badge badge-green">&#x2713; Auto</span>' : '<span style="color:var(--text3);font-size:12px">Manual</span>'}</td>
      <td>${statusBadge}</td>
      <td style="text-align:right">
        <button class="btn-icon" onclick="deleteItem('bills','${escHtml(bill.id)}');event.stopPropagation()" title="Delete">&#x2715;</button>
      </td>
    </tr>`;
  }).join('');
}

document.getElementById('btn-add-bill').addEventListener('click', () => {
  const name     = document.getElementById('bill-name').value.trim();
  const amount   = parseFloat(document.getElementById('bill-amount').value);
  const due      = parseInt(document.getElementById('bill-due').value);
  const category = document.getElementById('bill-category').value;
  const autopay  = document.getElementById('bill-autopay').checked;
  if (!name || isNaN(amount) || amount <= 0 || isNaN(due) || due < 1 || due > 31) {
    showToast('Please fill in all bill fields correctly.', 'error'); return;
  }
  state.bills.push({ id: uid(), name, amount, due, category, autopay });
  saveState();
  renderBillRows();
  updateDashboard();
  document.getElementById('bill-name').value = '';
  document.getElementById('bill-amount').value = '';
  document.getElementById('bill-due').value = '';
  document.getElementById('bill-autopay').checked = false;
  showToast('Bill added!');
});

document.getElementById('bills-sort').addEventListener('change', renderBillRows);

// ── DEBT SECTION ──────────────────────────────────
function renderDebtCards() {
  const wrap  = document.getElementById('debt-cards-wrap');
  const empty = document.getElementById('debt-empty');
  const banner = document.getElementById('strategy-banner');
  const sortSelect = document.getElementById('debt-sort');

  if (state.debts.length === 0) {
    empty.classList.add('show');
    wrap.innerHTML = '';
    banner.classList.remove('show');
    if (sortSelect) sortSelect.parentElement.style.display = 'none';
    return;
  }
  empty.classList.remove('show');
  if (sortSelect) sortSelect.parentElement.style.display = '';

  // Calculate payment suggestions
  const suggestions = calculateSuggestedPayments();
  const suggestionMap = {};
  suggestions.forEach(s => { suggestionMap[s.id] = s; });

  // Sort debts based on current sort method
  let sorted = [...state.debts];
  if (currentDebtSort === 'avalanche') {
    sorted.sort((a, b) => b.rate - a.rate);
  } else if (currentDebtSort === 'snowball') {
    sorted.sort((a, b) => a.balance - b.balance);
  } else if (currentDebtSort === 'amount') {
    sorted.sort((a, b) => b.balance - a.balance);
  } else if (currentDebtSort === 'dueDate') {
    sorted.sort((a, b) => a.due - b.due);
  } else if (currentDebtSort === 'minPayment') {
    sorted.sort((a, b) => b.minpay - a.minpay);
  } else if (currentDebtSort === 'suggested') {
    sorted.sort((a, b) => {
      const sugA = suggestionMap[a.id]?.suggested || 0;
      const sugB = suggestionMap[b.id]?.suggested || 0;
      return sugB - sugA;
    });
  }

  // Strategy recommendation banner
  if (state.debts.length > 1) {
    const byApr = [...state.debts].sort((a, b) => b.rate - a.rate);
    const byBal = [...state.debts].sort((a, b) => a.balance - b.balance);
    banner.classList.add('show');
    banner.innerHTML = `📊 <strong>Debt Strategy:</strong> Avalanche — focus extra on <strong>${escHtml(byApr[0].name)}</strong> (${byApr[0].rate}% APR) to save interest. Or Snowball — tackle <strong>${escHtml(byBal[0].name)}</strong> (${fmt(byBal[0].balance)}) for quick wins.`;
  } else {
    banner.classList.remove('show');
  }

  const grid = document.createElement('div');
  grid.className = 'debt-cards-grid';

  grid.innerHTML = sorted.map(debt => {
    const suggestion = suggestionMap[debt.id];
    const months = payoffMonths(debt.balance, debt.rate, debt.minpay);
    const payoffStr = isFinite(months) ? `~${months} months (${Math.ceil(months/12)} yrs)` : 'Never at min payment';
    
    // Payoff with suggested payment
    const suggestedMonths = suggestion.suggested > debt.minpay 
      ? payoffMonths(debt.balance, debt.rate, suggestion.suggested)
      : months;
    const suggestedPayoffStr = isFinite(suggestedMonths) && suggestedMonths < months
      ? `~${suggestedMonths} months at suggested payment`
      : null;

    const utilPct = Math.min(100, Math.round((debt.balance / (debt.balance + 500)) * 100));
    const barClass = debt.rate > 20 ? 'danger' : debt.rate > 12 ? 'warning' : '';
    const isHighApr = debt.rate > 20;
    const hasPromo  = !!debt.promo;
    const isPriority = suggestion.priority === 1;

    let promoNote = '';
    if (hasPromo) {
      const [m, y] = debt.promo.split('/').map(Number);
      if (m && y) {
        const now = new Date();
        const monthsLeft = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());

        let badgeClass, label;
        if (monthsLeft <= 0) {
          badgeClass = 'badge-red';
          label = `Promo EXPIRED (${debt.promo})`;
        } else if (monthsLeft <= 2) {
          badgeClass = 'badge-red';
          label = `⚠️ Promo ends ${debt.promo} — only ${monthsLeft} month${monthsLeft === 1 ? '' : 's'} left!`;
        } else if (monthsLeft <= 4) {
          badgeClass = 'badge-yellow';
          label = `⏰ Promo ends ${debt.promo} — ${monthsLeft} months left`;
        } else {
          badgeClass = 'badge-blue';
          label = `Promo ends ${debt.promo} — ${monthsLeft} months left`;
        }

        promoNote = `<div class="badge ${badgeClass}" style="margin-top:8px;display:inline-block">${label}</div>`;
      }
    }

    // Build suggestion section
    let suggestionSection = '';
    if (suggestion.suggested > 0) {
      const extraPayment = suggestion.suggested - debt.minpay;
      const savingsNote = suggestedPayoffStr ? `<div class="suggestion-note">${suggestedPayoffStr}</div>` : '';
      
      suggestionSection = `
        <div class="suggestion-box ${isPriority ? 'priority' : ''}">
          <div class="suggestion-header">
            ${isPriority ? '⭐ ' : ''}💡 Suggested Payment
          </div>
          <div class="suggestion-amount">${fmt(suggestion.suggested)}/mo</div>
          <div class="suggestion-note">${escHtml(suggestion.reason)}</div>
          ${extraPayment > 0 ? `<div class="suggestion-note">Extra: ${fmt(extraPayment)}/mo</div>` : ''}
          ${savingsNote}
        </div>
      `;
    }

    return `<div class="debt-card ${isHighApr ? 'high-apr' : ''} ${hasPromo ? 'promo' : ''} ${isPriority ? 'priority-debt' : ''}" data-id="${escHtml(debt.id)}" onclick="openEditModal('debts','${escHtml(debt.id)}',event)" title="Click to edit">
      <div class="debt-card-header">
        <div class="debt-card-name">${escHtml(debt.name)}</div>
        <div style="display:flex;gap:6px;align-items:center">
          ${isHighApr ? '<span class="badge badge-red">High APR</span>' : ''}
          ${isPriority ? '<span class="badge badge-green">Priority</span>' : ''}
          <button class="btn-icon" onclick="deleteItem('debts','${escHtml(debt.id)}');event.stopPropagation()" title="Delete">&#x2715;</button>
        </div>
      </div>
      <div class="debt-card-meta">
        <div class="debt-meta-item">
          <span class="debt-meta-label">Balance</span>
          <span class="debt-meta-value" style="color:var(--red)">${fmt(debt.balance)}</span>
        </div>
        <div class="debt-meta-item">
          <span class="debt-meta-label">APR</span>
          <span class="debt-meta-value" style="color:${debt.rate > 20 ? 'var(--red)' : debt.rate > 12 ? 'var(--yellow)' : 'var(--green)'}">${debt.rate}%</span>
        </div>
        <div class="debt-meta-item">
          <span class="debt-meta-label">Min Payment</span>
          <span class="debt-meta-value">${fmt(debt.minpay)}</span>
        </div>
        <div class="debt-meta-item">
          <span class="debt-meta-label">Due Day</span>
          <span class="debt-meta-value">Day ${debt.due}</span>
        </div>
      </div>
      <div class="debt-progress-label">
        <span>Debt Load</span>
        <span>${utilPct}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-bar ${barClass}" style="width:${utilPct}%"></div>
      </div>
      <div class="debt-payoff-note">Payoff at min: ${payoffStr}</div>
      ${promoNote}
      ${suggestionSection}
      <div class="debt-card-edit-hint">&#x270E; click to edit</div>
    </div>`;
  }).join('');

  wrap.innerHTML = '';
  wrap.appendChild(grid);
}

document.getElementById('btn-add-debt').addEventListener('click', () => {
  const name    = document.getElementById('debt-name').value.trim();
  const balance = parseFloat(document.getElementById('debt-balance').value);
  const rate    = parseFloat(document.getElementById('debt-rate').value);
  const minpay  = parseFloat(document.getElementById('debt-minpay').value);
  const due     = parseInt(document.getElementById('debt-due').value);
  const promo   = document.getElementById('debt-promo').value.trim();
  if (!name || isNaN(balance) || balance < 0 || isNaN(rate) || isNaN(minpay) || isNaN(due)) {
    showToast('Please fill in all debt fields.', 'error'); return;
  }
  state.debts.push({ id: uid(), name, balance, rate, minpay, due, promo });
  saveState();
  renderDebtCards();
  updateDashboard();
  ['debt-name','debt-balance','debt-rate','debt-minpay','debt-due','debt-promo'].forEach(id => {
    document.getElementById(id).value = '';
  });
  showToast('Debt added!');
});

// Debt sort handler
const debtSortEl = document.getElementById('debt-sort');
if (debtSortEl) {
  debtSortEl.addEventListener('change', (e) => {
    currentDebtSort = e.target.value;
    renderDebtCards();
  });
}

// ── SAVINGS GOALS ─────────────────────────────────
function renderGoals() {
  const grid  = document.getElementById('goals-grid');
  const empty = document.getElementById('goals-empty');

  if (state.goals.length === 0) {
    empty.classList.add('show');
    grid.innerHTML = '';
    return;
  }
  empty.classList.remove('show');
  const remaining = calcRemaining();

  grid.className = 'goals-grid';
  grid.innerHTML = state.goals.map(goal => {
    const pct = goal.target > 0 ? Math.min(100, Math.round(goal.saved / goal.target * 100)) : 0;
    const left = Math.max(0, goal.target - goal.saved);
    const months = goal.monthly > 0 ? Math.ceil(left / goal.monthly) : Infinity;
    const completion = isFinite(months) && months > 0
      ? `~${months} months to go`
      : goal.monthly <= 0 ? 'Set a monthly contribution' : 'Goal reached! 🎉';

    const barClass = pct >= 80 ? '' : pct >= 40 ? 'warning' : 'danger';

    return `<div class="goal-card" data-id="${escHtml(goal.id)}" onclick="openEditModal('goals','${escHtml(goal.id)}',event)" title="Click to edit">
      <div class="goal-header">
        <div class="goal-name">${escHtml(goal.name)}</div>
        <button class="btn-icon" onclick="deleteItem('goals','${escHtml(goal.id)}');event.stopPropagation()" title="Delete">&#x2715;</button>
      </div>
      <div class="goal-amounts">
        <span>Saved: <strong>${fmt(goal.saved)}</strong></span>
        <span>Target: <strong>${fmt(goal.target)}</strong></span>
      </div>
      <div class="progress-track">
        <div class="progress-bar ${barClass}" style="width:${pct}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3);margin-top:4px">
        <span>${pct}% complete</span>
        <span>${fmt(left)} remaining</span>
      </div>
      <div class="goal-note">${escHtml(completion)}</div>
      ${goal.monthly > 0 ? `<div class="goal-note">Monthly: ${fmt(goal.monthly)}/mo</div>` : ''}
      <div class="goal-card-edit-hint">&#x270E; click to edit</div>
    </div>`;
  }).join('');
}

document.getElementById('btn-add-goal').addEventListener('click', () => {
  const name    = document.getElementById('goal-name').value.trim();
  const target  = parseFloat(document.getElementById('goal-target').value);
  const saved   = parseFloat(document.getElementById('goal-saved').value) || 0;
  const monthly = parseFloat(document.getElementById('goal-monthly').value) || 0;
  if (!name || isNaN(target) || target <= 0) {
    showToast('Please enter a goal name and target amount.', 'error'); return;
  }
  state.goals.push({ id: uid(), name, target, saved, monthly });
  saveState();
  renderGoals();
  ['goal-name','goal-target','goal-saved','goal-monthly'].forEach(id => {
    document.getElementById(id).value = '';
  });
  showToast('Goal added!');
});

// ── EDIT MODAL ENGINE ─────────────────────────────
// Tracks which item is currently being edited
let _editCtx = { section: null, id: null };

// Field definitions per section
const EDIT_FIELDS = {
  income: [
    { key: 'name',    label: 'Source Name', type: 'text'   },
    { key: 'amount',  label: 'Amount ($)',   type: 'number', min: 0, step: 0.01 },
    { key: 'freq',    label: 'Frequency',   type: 'select',
      options: [{ value:'weekly',label:'Weekly'},{value:'biweekly',label:'Biweekly'},{value:'monthly',label:'Monthly'}] },
    { key: 'comment', label: 'Comment (optional)', type: 'textarea' }
  ],
  bills: [
    { key: 'name',     label: 'Bill Name',      type: 'text' },
    { key: 'amount',   label: 'Amount ($)',      type: 'number', min: 0, step: 0.01 },
    { key: 'due',      label: 'Due Day (1–31)', type: 'number', min: 1, max: 31 },
    { key: 'category', label: 'Category',        type: 'select',
      options: ['Housing','Utilities','Transportation','Insurance','Subscriptions','Food','Healthcare','Other']
        .map(c => ({ value: c, label: c })) },
    { key: 'autopay',  label: 'Auto-Pay',        type: 'checkbox' },
    { key: 'comment',  label: 'Comment (optional)', type: 'textarea' }
  ],
  debts: [
    { key: 'name',    label: 'Debt / Card Name',       type: 'text' },
    { key: 'balance', label: 'Current Balance ($)',     type: 'number', min: 0, step: 0.01 },
    { key: 'rate',    label: 'APR (%)',                 type: 'number', min: 0, step: 0.01 },
    { key: 'minpay',  label: 'Min Payment ($)',         type: 'number', min: 0, step: 0.01 },
    { key: 'due',     label: 'Due Day (1–31)',          type: 'number', min: 1, max: 31 },
    { key: 'promo',   label: 'Promo End (MM/YYYY)',     type: 'text'  },
    { key: 'comment', label: 'Comment (optional)',      type: 'textarea' }
  ],
  goals: [
    { key: 'name',    label: 'Goal Name',               type: 'text' },
    { key: 'target',  label: 'Target Amount ($)',        type: 'number', min: 0, step: 1 },
    { key: 'saved',   label: 'Already Saved ($)',        type: 'number', min: 0, step: 0.01 },
    { key: 'monthly', label: 'Monthly Contribution ($)', type: 'number', min: 0, step: 0.01 },
    { key: 'comment', label: 'Comment (optional)',       type: 'textarea' }
  ]
};

const SECTION_ICONS = { income: '↑', bills: '📋', debts: '💳', goals: '🎯' };
const SECTION_LABELS = { income: 'Income Source', bills: 'Bill', debts: 'Debt', goals: 'Savings Goal' };

function openEditModal(section, id, event) {
  // Prevent row click firing when delete button clicked
  if (event && event.target.closest('.btn-icon')) return;

  const item = state[section].find(x => x.id === id);
  if (!item) return;

  _editCtx = { section, id };

  // Set modal title
  document.getElementById('edit-modal-title').innerHTML =
    `<span>${SECTION_ICONS[section]}</span> Edit ${SECTION_LABELS[section]}`;

  // Build fields
  const fields = EDIT_FIELDS[section];
  document.getElementById('edit-modal-fields').innerHTML = fields.map(f => {
    let input = '';
    if (f.type === 'select') {
      const opts = f.options.map(o =>
        `<option value="${escHtml(o.value)}"${item[f.key] === o.value ? ' selected' : ''}>${escHtml(o.label)}</option>`
      ).join('');
      input = `<select class="input" id="edf-${f.key}">${opts}</select>`;
    } else if (f.type === 'checkbox') {
      input = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="edf-${f.key}"${item[f.key] ? ' checked' : ''} style="accent-color:var(--accent);width:16px;height:16px"/>
        <span style="font-size:14px;color:var(--text2)">Enabled</span>
      </label>`;
    } else if (f.type === 'textarea') {
      const val = item[f.key] !== undefined ? escHtml(String(item[f.key])) : '';
      input = `<textarea class="input" id="edf-${f.key}" rows="3" placeholder="Add notes, reminders, or details...">${val}</textarea>`;
    } else {
      const extras = [
        f.min  !== undefined ? `min="${f.min}"`   : '',
        f.max  !== undefined ? `max="${f.max}"`   : '',
        f.step !== undefined ? `step="${f.step}"` : ''
      ].filter(Boolean).join(' ');
      const val = item[f.key] !== undefined ? escHtml(String(item[f.key])) : '';
      input = `<input type="${f.type}" class="input" id="edf-${f.key}" value="${val}" ${extras} />`;
    }
    return `<div class="modal-field"><label for="edf-${f.key}">${f.label}</label>${input}</div>`;
  }).join('');

  // Show modal and focus first field
  document.getElementById('edit-modal-overlay').classList.remove('hidden');
  const firstInput = document.querySelector('#edit-modal-fields input, #edit-modal-fields select');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

function closeEditModal() {
  document.getElementById('edit-modal-overlay').classList.add('hidden');
  _editCtx = { section: null, id: null };
}

function saveEditModal() {
  const { section, id } = _editCtx;
  if (!section || !id) return;

  const item = state[section].find(x => x.id === id);
  if (!item) return;

  const fields = EDIT_FIELDS[section];
  const errors = [];

  fields.forEach(f => {
    const el = document.getElementById(`edf-${f.key}`);
    if (!el) return;

    if (f.type === 'checkbox') {
      item[f.key] = el.checked;
    } else if (f.type === 'number') {
      const val = parseFloat(el.value);
      if (isNaN(val)) { errors.push(f.label); return; }
      item[f.key] = val;
    } else {
      const val = el.value.trim();
      if (f.key === 'name' && !val) { errors.push(f.label); return; }
      item[f.key] = val;
    }
  });

  if (errors.length) {
    showToast(`Fix these fields: ${errors.join(', ')}`, 'error', 3500);
    return;
  }

  saveState();
  closeEditModal();
  renderAll();
  showToast(`${SECTION_LABELS[section]} updated!`);
}

// Wire modal buttons
document.getElementById('edit-modal-cancel').addEventListener('click', closeEditModal);
document.getElementById('edit-modal-save').addEventListener('click', saveEditModal);

// Close on overlay click
document.getElementById('edit-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('edit-modal-overlay')) closeEditModal();
});

// Close on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeEditModal();
  if (e.key === 'Enter' && !document.getElementById('edit-modal-overlay').classList.contains('hidden')) {
    // Allow Enter inside textarea but save on Enter in inputs
    if (document.activeElement.tagName !== 'TEXTAREA') saveEditModal();
  }
});

// ── DELETE ITEM ───────────────────────────────────
function deleteItem(section, id) {
  if (!confirm('Remove this item?')) return;
  state[section] = state[section].filter(x => x.id !== id);
  saveState();
  renderAll();
  showToast('Item removed.', 'warning');
}

// ── COLLAPSIBLE SECTIONS ──────────────────────────
document.querySelectorAll('.section-header.collapsible').forEach(header => {
  header.addEventListener('click', () => {
    const targetId = header.dataset.target;
    const body = document.getElementById(targetId);
    const isCollapsed = body.classList.contains('collapsed');
    body.classList.toggle('collapsed', !isCollapsed);
    header.classList.toggle('collapsed', !isCollapsed);
  });
});

// ── EXPORT / IMPORT / RESET ───────────────────────
document.getElementById('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `budgetingready-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Data exported!');
});

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const parsed = JSON.parse(evt.target.result);
      state = { income: [], bills: [], debts: [], goals: [], ...parsed };
      saveState();
      renderAll();
      updateDashboard();
      showToast('Data imported successfully!');
    } catch {
      showToast('Invalid JSON file.', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm('Reset ALL data? This cannot be undone.')) return;
  state = { income: [], bills: [], debts: [], goals: [] };
  saveState();
  renderAll();
  updateDashboard();
  showToast('All data reset.', 'warning');
});

// ── RENDER ALL ────────────────────────────────────
function renderAll() {
  renderIncomeRows();
  renderBillRows();
  renderDebtCards();
  renderGoals();
  updateDashboard();
}

// ── ONBOARDING ────────────────────────────────────
function checkOnboarding() {
  const hasData = state.income.length > 0 || state.bills.length > 0 || state.debts.length > 0;
  const seen = localStorage.getItem('budgetingready_onboarded');
  if (!hasData && !seen) {
    document.getElementById('onboarding').classList.remove('hidden');
  }
}

document.getElementById('onboarding-start').addEventListener('click', () => {
  localStorage.setItem('budgetingready_onboarded', '1');
  document.getElementById('onboarding').classList.add('hidden');
  // Load sample data for first-timers
  if (state.income.length === 0 && state.bills.length === 0) {
    state = JSON.parse(JSON.stringify(SAMPLE_DATA));
    // Give fresh IDs
    ['income','bills','debts','goals'].forEach(k => {
      state[k].forEach(x => { x.id = uid(); });
    });
    saveState();
    renderAll();
    showToast('Sample data loaded! Edit or delete anything.', 'success', 4000);
  }
});

// ── AUTO-SAVE ON ANY INPUT CHANGES ───────────────
// (Already handled per-action; this is a safety fallback)
document.addEventListener('input', e => {
  if (e.target.closest('#income-form, #bills-form, #debt-form, #goals-form')) return;
  // If user edits inline table cells in the future, save here
});

// ── INIT ──────────────────────────────────────────
(async function init() {
  // Initialize IndexedDB first
  await initDB();
  
  const loaded = await loadState();
  renderAll();
  checkOnboarding();

  if (loaded && (state.income.length || state.bills.length || state.debts.length)) {
    // Silently note data was restored
    setTimeout(() => showToast('Your data was restored from last session.', 'success', 3000), 600);
  }
})();
