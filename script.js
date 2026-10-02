const SUPABASE_URL = 'https://ytmrxmbbyyvvplxrzdcx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0t_YLBixo8s_Kw3X1mMgFA_Vu9HUetc';
const REST_BASE = `${SUPABASE_URL}/rest/v1`;
const state = {
  members: [],
  packages: [],
  sales: [],
  report: null,
  currentView: 'dashboard',
  journalView: 'general',
  modalOpener: null
};

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0
});
const numberFormat = new Intl.NumberFormat('id-ID');
const dateFormat = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function money(value) {
  return rupiah.format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : dateFormat.format(date);
}

function todayString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function emptyRow(columns, message) {
  return `<tr><td colspan="${columns}" class="empty-cell">${escapeHtml(message)}</td></tr>`;
}

function toast(message, type = 'success') {
  const region = document.getElementById('toast-region');
  const item = document.createElement('div');
  item.className = `toast${type === 'error' ? ' toast-error' : ''}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 4500);
}

function restQuery(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  return params.toString();
}

async function postgrest(resource, filters = {}, options = {}) {
  let response;
  try {
    const query = restQuery(filters);
    response = await fetch(`${REST_BASE}/${resource}${query ? `?${query}` : ''}`, {
      method: options.method || 'GET',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
    });
  } catch {
    throw new Error('Tidak dapat menghubungi Supabase. Periksa koneksi, URL, dan publishable key.');
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }
  if (!response.ok) {
    throw new Error(data?.message || data?.error_description || data?.hint || 'Permintaan Supabase gagal.');
  }
  return data;
}

function apiError(message) {
  throw new Error(message);
}

async function getOne(resource, filters) {
  const rows = await postgrest(resource, { ...filters, limit: '1' });
  if (!rows?.length) apiError('Data tidak ditemukan.');
  return rows[0];
}

async function refreshMemberStatuses() {
  const today = todayString();
  const [members, activeSales] = await Promise.all([
    postgrest('members', { select: '*' }),
    postgrest('sales', { select: 'member_id', end_date: `gte.${today}` })
  ]);
  const activeIds = new Set(activeSales.map((sale) => sale.member_id));
  await Promise.all(members.filter((member) =>
    member.status !== (activeIds.has(member.id) ? 'active' : 'inactive')
  ).map((member) => postgrest('members', { id: `eq.${member.id}` }, {
    method: 'PATCH', body: { status: activeIds.has(member.id) ? 'active' : 'inactive' }
  })));
  return members.map((member) => ({ ...member, status: activeIds.has(member.id) ? 'active' : 'inactive' }));
}

async function getDashboardData() {
  const today = todayString();
  const sevenDays = new Date(`${today}T00:00:00.000Z`);
  sevenDays.setUTCDate(sevenDays.getUTCDate() + 7);
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonth = new Date(`${monthStart}T00:00:00.000Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const monthEnd = nextMonth.toISOString().slice(0, 10);
  const [members, futureSales, monthSales, latestSales] = await Promise.all([
    refreshMemberStatuses(),
    postgrest('sales', { select: 'member_id,end_date,members(id,member_code,name)', end_date: `gte.${today}` }),
    postgrest('sales', { select: '*', start_date: `gte.${monthStart}`, and: `(start_date.lt.${monthEnd})` }),
    postgrest('sales', { select: '*,members(id,member_code,name),packages(id,name)', order: 'created_at.desc', limit: '5' })
  ]);
  const latestEndDateByMember = new Map();
  for (const sale of futureSales) {
    const previous = latestEndDateByMember.get(sale.member_id);
    if (!previous || sale.end_date > previous) latestEndDateByMember.set(sale.member_id, sale.end_date);
  }
  const membersById = new Map(members.map((member) => [member.id, member]));
  const expiringSoon = [...latestEndDateByMember.entries()]
    .filter(([, endDate]) => endDate <= sevenDays.toISOString().slice(0, 10))
    .map(([memberId, endDate]) => ({ ...membersById.get(memberId), end_date: endDate }))
    .sort((left, right) => left.end_date.localeCompare(right.end_date));
  return {
    active_members: members.filter((member) => member.status === 'active').length,
    expiring_soon_count: expiringSoon.length,
    expiring_soon: expiringSoon,
    sales_this_month: monthSales.length,
    revenue_this_month: Math.round(monthSales.reduce((sum, sale) => sum + Number(sale.revenue_amount), 0) * 100) / 100,
    tax_this_month: Math.round(monthSales.reduce((sum, sale) => sum + Number(sale.tax_amount), 0) * 100) / 100,
    latest_sales: latestSales
  };
}

async function getRevenueReportData(query) {
  const filters = { select: '*,members(id,member_code,name),packages(id,name)', order: 'start_date.asc,created_at.asc' };
  if (query.start) filters.start_date = `gte.${query.start}`;
  if (query.end) filters.and = `(start_date.lte.${query.end})`;
  if (query.method) filters.payment_method = `eq.${query.method}`;
  const sales = await postgrest('sales', filters);
  const groups = new Map();
  for (const sale of sales) {
    const key = String(sale.tax_rate);
    const group = groups.get(key) || { tax_rate: Number(key), taxable_revenue: 0, tax_amount: 0, gross_total: 0 };
    group.taxable_revenue += Number(sale.revenue_amount);
    group.tax_amount += Number(sale.tax_amount);
    group.gross_total += Number(sale.price_paid);
    groups.set(key, group);
  }
  const round = (value) => Math.round(value * 100) / 100;
  const taxBreakdown = [...groups.values()].map((group) => ({
    ...group,
    taxable_revenue: round(group.taxable_revenue),
    tax_amount: round(group.tax_amount),
    gross_total: round(group.gross_total)
  }));
  return {
    period: { start: query.start || null, end: query.end || null, method: query.method || null },
    totals: {
      sales_count: sales.length,
      gross_total: round(sales.reduce((sum, sale) => sum + Number(sale.price_paid), 0)),
      revenue_amount: round(sales.reduce((sum, sale) => sum + Number(sale.revenue_amount), 0)),
      tax_amount: round(sales.reduce((sum, sale) => sum + Number(sale.tax_amount), 0))
    },
    tax_breakdown: taxBreakdown,
    sales
  };
}

// Map the existing UI calls directly to Supabase PostgREST and RPC.
async function api(path, options = {}) {
  const parsedUrl = new URL(path, 'http://healthy-yoga.local');
  const route = parsedUrl.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/';
  const query = parsedUrl.searchParams;
  const method = (options.method || 'GET').toUpperCase();
  const payload = options.body ? JSON.parse(options.body) : {};
  let match;

  if (route === '/members' && method === 'GET') {
    const members = await refreshMemberStatuses();
    const search = String(query.get('search') || '').trim().toLowerCase();
    return search ? members.filter((member) =>
      `${member.member_code} ${member.name} ${member.email || ''} ${member.phone || ''}`.toLowerCase().includes(search)
    ) : members;
  }
  if (route === '/members' && method === 'POST') {
    const rows = await postgrest('members', { select: '*' }, {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: {
        name: payload.name.trim(), email: payload.email || null, phone: payload.phone || null,
        join_date: payload.join_date || todayString(), status: payload.status || 'inactive'
      }
    });
    return rows[0];
  }
  if ((match = route.match(/^\/members\/(\d+)\/sales$/)) && method === 'GET') {
    return postgrest('sales', {
      select: '*,packages(id,name)', member_id: `eq.${match[1]}`, order: 'start_date.desc,created_at.desc'
    });
  }
  if ((match = route.match(/^\/members\/(\d+)$/))) {
    const id = match[1];
    if (method === 'GET') return getOne('members', { select: '*', id: `eq.${id}` });
    if (method === 'PUT') {
      const update = Object.fromEntries(['name', 'email', 'phone', 'join_date', 'status']
        .filter((key) => Object.prototype.hasOwnProperty.call(payload, key)).map((key) => [key, payload[key]]));
      if (update.name) update.name = update.name.trim();
      const rows = await postgrest('members', { id: `eq.${id}`, select: '*' }, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: update
      });
      if (!rows.length) apiError('Member tidak ditemukan.');
      return rows[0];
    }
    if (method === 'DELETE') {
      const [activeSales, allSales] = await Promise.all([
        postgrest('sales', { select: 'id', member_id: `eq.${id}`, end_date: `gte.${todayString()}`, limit: '1' }),
        postgrest('sales', { select: 'id', member_id: `eq.${id}`, limit: '1' })
      ]);
      if (activeSales.length) apiError('Member masih memiliki membership aktif.');
      if (allSales.length) apiError('Member memiliki riwayat sales dan tidak dapat dihapus demi menjaga audit trail.');
      await postgrest('members', { id: `eq.${id}` }, { method: 'DELETE' });
      return { message: 'Member berhasil dihapus.' };
    }
  }

  if (route === '/packages' && method === 'GET') {
    const filters = { select: '*', order: 'duration_days.asc' };
    if (query.get('active') === 'true') filters.is_active = 'eq.true';
    if (query.get('active') === 'false') filters.is_active = 'eq.false';
    return postgrest('packages', filters);
  }
  if (route === '/packages' && method === 'POST') {
    const rows = await postgrest('packages', { select: '*' }, {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: {
        name: payload.name.trim(), duration_months: Number(payload.duration_months),
        duration_days: Number(payload.duration_days), price: Number(payload.price),
        tax_rate: Number(payload.tax_rate ?? 11), is_active: payload.is_active ?? true
      }
    });
    return rows[0];
  }
  if ((match = route.match(/^\/packages\/(\d+)$/))) {
    const id = match[1];
    if (method === 'GET') return getOne('packages', { select: '*', id: `eq.${id}` });
    if (method === 'PUT') {
      const rows = await postgrest('packages', { id: `eq.${id}`, select: '*' }, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: {
          name: payload.name.trim(), duration_months: Number(payload.duration_months),
          duration_days: Number(payload.duration_days), price: Number(payload.price),
          tax_rate: Number(payload.tax_rate), is_active: payload.is_active
        }
      });
      if (!rows.length) apiError('Paket tidak ditemukan.');
      return rows[0];
    }
  }
  if ((match = route.match(/^\/packages\/(\d+)\/(archive|activate)$/)) && method === 'PATCH') {
    const rows = await postgrest('packages', { id: `eq.${match[1]}`, select: '*' }, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: { is_active: match[2] === 'activate' }
    });
    if (!rows.length) apiError('Paket tidak ditemukan.');
    return rows[0];
  }

  if (route === '/sales' && method === 'GET') {
    const filters = { select: '*,members(id,member_code,name),packages(id,name)', order: 'start_date.desc,created_at.desc' };
    if (query.get('start')) filters.start_date = `gte.${query.get('start')}`;
    if (query.get('end')) filters.and = `(start_date.lte.${query.get('end')})`;
    if (query.get('member_id')) filters.member_id = `eq.${query.get('member_id')}`;
    if (query.get('method')) filters.payment_method = `eq.${query.get('method')}`;
    return postgrest('sales', filters);
  }
  if (route === '/sales' && method === 'POST') {
    return postgrest('rpc/create_sale_with_journal', {}, {
      method: 'POST', body: {
        p_member_id: Number(payload.member_id), p_package_id: Number(payload.package_id),
        p_start_date: payload.start_date, p_payment_method: payload.payment_method,
        p_notes: payload.notes || null
      }
    });
  }
  if ((match = route.match(/^\/sales\/(\d+)$/))) {
    const id = match[1];
    if (method === 'GET') return getOne('sales', {
      select: '*,members(id,member_code,name),packages(id,name),journals(id,journal_no,journal_date)', id: `eq.${id}`
    });
    if (method === 'PATCH' || method === 'PUT') {
      const rows = await postgrest('sales', { id: `eq.${id}`, select: '*' }, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { notes: payload.notes || null }
      });
      if (!rows.length) apiError('Transaksi tidak ditemukan.');
      return rows[0];
    }
    if (method === 'DELETE') {
      const journals = await postgrest('journals', { select: 'id', reference_id: `eq.${id}`, limit: '1' });
      if (journals.length) apiError('Sales tidak dapat dihapus karena memiliki jurnal audit.');
      await postgrest('sales', { id: `eq.${id}` }, { method: 'DELETE' });
      return { message: 'Transaksi berhasil dihapus.' };
    }
  }

  if (route === '/journals' && method === 'GET') {
    const filters = { select: '*,sales(sales_no,member_id,package_id,price_paid)', order: 'journal_date.desc,created_at.desc' };
    if (query.get('start')) filters.journal_date = `gte.${query.get('start')}`;
    if (query.get('end')) filters.and = `(journal_date.lte.${query.get('end')})`;
    return postgrest('journals', filters);
  }
  if ((match = route.match(/^\/journals\/(\d+)$/)) && method === 'GET') {
    return getOne('journals', {
      select: '*,journal_entries(*),sales(sales_no,member_id,package_id,price_paid,tax_amount,revenue_amount)',
      id: `eq.${match[1]}`
    });
  }
  if (route === '/dashboard' && method === 'GET') return getDashboardData();
  if (route === '/reports/revenue' && method === 'GET') {
    return getRevenueReportData({ start: query.get('start'), end: query.get('end'), method: query.get('method') });
  }
  apiError('Endpoint tidak ditemukan.');
}

function setLoading(elementId, columns, text = 'Memuat data...') {
  document.getElementById(elementId).innerHTML = emptyRow(columns, text);
}

function memberName(member) {
  return member?.name || 'Member tidak ditemukan';
}

function packageName(packageInfo) {
  return packageInfo?.name || 'Paket tidak ditemukan';
}

function statusBadge(status) {
  const active = status === 'active';
  return `<span class="status ${active ? 'status-active' : 'status-inactive'}">${active ? 'Aktif' : 'Tidak aktif'}</span>`;
}

function actionButton(action, label, id, style = 'button-secondary') {
  return `<button class="button ${style} button-small" type="button" data-action="${action}" data-id="${escapeHtml(id)}">${label}</button>`;
}

function updateTodayLabel() {
  document.getElementById('today-label').textContent = dateFormat.format(new Date());
  document.getElementById('dashboard-period').textContent = dateFormat.format(new Date());
}

async function loadMembers(search = '') {
  setLoading('members-table', 6);
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  const members = await api(`/members${params.size ? `?${params}` : ''}`);
  state.members = members;
  renderMembers(members);
  renderMemberOptions();
}

function renderMembers(members) {
  document.getElementById('member-count').textContent = `${numberFormat.format(members.length)} member${members.length === 1 ? '' : 's'}`;
  document.getElementById('members-table').innerHTML = members.length ? members.map((member) => `
    <tr>
      <td><span class="table-primary">${escapeHtml(member.member_code)}</span></td>
      <td><span class="table-primary">${escapeHtml(member.name)}</span><span class="table-secondary">${escapeHtml(member.email || 'Tanpa email')}</span></td>
      <td>${escapeHtml(member.phone || '—')}</td>
      <td>${formatDate(member.join_date)}</td>
      <td>${statusBadge(member.status)}</td>
      <td><div class="table-actions">
        ${actionButton('member-detail', 'Detail', member.id, 'button-secondary')}
        ${actionButton('edit-member', 'Edit', member.id, 'button-edit')}
        ${actionButton('delete-member', 'Hapus', member.id, 'button-danger')}
      </div></td>
    </tr>`).join('') : emptyRow(6, 'Belum ada member yang cocok.');
}

function renderMemberOptions() {
  const options = state.members.map((member) =>
    `<option value="${escapeHtml(member.id)}">${escapeHtml(member.member_code)} · ${escapeHtml(member.name)}${member.status === 'inactive' ? ' · tidak aktif' : ''}</option>`
  ).join('');
  const saleSelect = document.getElementById('sale-member');
  const saleCurrent = saleSelect.value;
  saleSelect.innerHTML = `<option value="">Pilih member</option>${options}`;
  if ([...saleSelect.options].some((option) => option.value === saleCurrent)) saleSelect.value = saleCurrent;
  const filterSelect = document.querySelector('#sales-filter select[name="member_id"]');
  const filterCurrent = filterSelect.value;
  filterSelect.innerHTML = `<option value="">Semua member</option>${options}`;
  if ([...filterSelect.options].some((option) => option.value === filterCurrent)) filterSelect.value = filterCurrent;
}

async function loadPackages() {
  setLoading('packages-table', 6);
  const filter = document.getElementById('package-filter').value;
  const params = filter === 'all' ? '' : `?active=${encodeURIComponent(filter)}`;
  state.packages = await api(`/packages${params}`);
  renderPackages(state.packages);
  renderPackageOptions();
}

function renderPackages(packages) {
  document.getElementById('package-count').textContent = `${numberFormat.format(packages.length)} paket`;
  document.getElementById('packages-table').innerHTML = packages.length ? packages.map((item) => `
    <tr>
      <td><span class="table-primary">${escapeHtml(item.name)}</span><span class="table-secondary">${numberFormat.format(item.duration_months)} bulan</span></td>
      <td>${numberFormat.format(item.duration_days)} hari</td>
      <td><span class="table-primary">${money(item.price)}</span></td>
      <td>${Number(item.tax_rate).toLocaleString('id-ID')}%</td>
      <td>${statusBadge(item.is_active ? 'active' : 'inactive')}</td>
      <td><div class="table-actions">
        ${actionButton('edit-package', 'Edit', item.id, 'button-edit')}
        ${item.is_active
          ? actionButton('archive-package', 'Arsip', item.id, 'button-archive')
          : actionButton('activate-package', 'Aktifkan', item.id, 'button-primary')}
      </div></td>
    </tr>`).join('') : emptyRow(6, 'Tidak ada paket pada filter ini.');
}

function renderPackageOptions() {
  const select = document.getElementById('sale-package');
  const current = select.value;
  const active = state.packages.filter((item) => item.is_active);
  select.innerHTML = `<option value="">Pilih paket aktif</option>${active.map((item) =>
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${money(item.price)}</option>`
  ).join('')}`;
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  updateSalePreview();
}

async function loadSales(filters = {}) {
  setLoading('sales-table', 7);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  state.sales = await api(`/sales${params.size ? `?${params}` : ''}`);
  renderSales(state.sales);
}

function renderSales(sales) {
  document.getElementById('sales-count').textContent = `${numberFormat.format(sales.length)} transaksi`;
  document.getElementById('sales-table').innerHTML = sales.length ? sales.map((sale) => `
    <tr>
      <td><span class="table-primary">${escapeHtml(sale.sales_no)}</span></td>
      <td>${formatDate(sale.start_date)}</td>
      <td>${escapeHtml(memberName(sale.members))}</td>
      <td>${escapeHtml(packageName(sale.packages))}</td>
      <td>${sale.payment_method === 'cash' ? 'Cash' : 'Transfer'}</td>
      <td><span class="table-primary">${money(sale.price_paid)}</span></td>
      <td><div class="table-actions">${actionButton('sale-detail', 'Detail', sale.id)}</div></td>
    </tr>`).join('') : emptyRow(7, 'Belum ada transaksi pada periode ini.');
}

async function loadDashboard() {
  for (const id of ['dashboard-sales', 'dashboard-expiring']) setLoading(id, id === 'dashboard-sales' ? 5 : 3);
  const dashboard = await api('/dashboard');
  document.getElementById('metric-active').textContent = numberFormat.format(dashboard.active_members || 0);
  document.getElementById('metric-expiring').textContent = numberFormat.format(dashboard.expiring_soon_count || 0);
  document.getElementById('metric-sales').textContent = numberFormat.format(dashboard.sales_this_month || 0);
  document.getElementById('metric-revenue').textContent = money(dashboard.revenue_this_month);
  document.getElementById('metric-tax').textContent = money(dashboard.tax_this_month);
  document.getElementById('expiring-count').textContent = numberFormat.format(dashboard.expiring_soon_count || 0);
  document.getElementById('dashboard-sales').innerHTML = dashboard.latest_sales?.length ? dashboard.latest_sales.map((sale) => `
    <tr>
      <td><span class="table-primary">${escapeHtml(sale.sales_no)}</span></td>
      <td>${escapeHtml(memberName(sale.members))}</td>
      <td>${escapeHtml(packageName(sale.packages))}</td>
      <td>${formatDate(sale.start_date)}</td>
      <td>${money(sale.price_paid)}</td>
    </tr>`).join('') : emptyRow(5, 'Belum ada transaksi.');
  document.getElementById('dashboard-expiring').innerHTML = dashboard.expiring_soon?.length ? dashboard.expiring_soon.map((member) => `
    <tr>
      <td><span class="table-primary">${escapeHtml(member.name)}</span><span class="table-secondary">${escapeHtml(member.member_code)}</span></td>
      <td><span class="status status-expiring">${formatDate(member.end_date)}</span></td>
      <td>${actionButton('renew-member', 'Perpanjang', member.id, 'button-primary')}</td>
    </tr>`).join('') : emptyRow(3, 'Tidak ada membership yang segera berakhir.');
}

async function loadJournals(filters = {}) {
  setLoading('journals-table', 5);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const journals = await api(`/journals${params.size ? `?${params}` : ''}`);
  document.getElementById('journals-table').innerHTML = journals.length ? journals.map((journal) => `
    <tr>
      <td><span class="table-primary">${escapeHtml(journal.journal_no)}</span></td>
      <td>${formatDate(journal.journal_date)}</td>
      <td>${escapeHtml(journal.description)}</td>
      <td>${escapeHtml(journal.sales?.sales_no || `Sale #${journal.reference_id}`)}</td>
      <td><div class="table-actions">${actionButton('journal-detail', 'Detail', journal.id)}</div></td>
    </tr>`).join('') : emptyRow(5, 'Belum ada jurnal pada periode ini.');
}

async function loadReport(filters = {}) {
  document.getElementById('report-tax-table').innerHTML = emptyRow(4, 'Memuat laporan...');
  document.getElementById('report-sales-table').innerHTML = emptyRow(6, 'Memuat transaksi...');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const report = await api(`/reports/revenue${params.size ? `?${params}` : ''}`);
  state.report = report;
  const summary = document.getElementById('report-summary');
  summary.innerHTML = `
    <div class="report-total"><span>Total penjualan · ${numberFormat.format(report.totals.sales_count)} transaksi</span><strong>${money(report.totals.gross_total)}</strong></div>
    <div class="report-total"><span>Pendapatan (DPP)</span><strong>${money(report.totals.revenue_amount)}</strong></div>
    <div class="report-total"><span>PPN keluaran</span><strong>${money(report.totals.tax_amount)}</strong></div>`;
  document.getElementById('report-tax-table').innerHTML = report.tax_breakdown.length ? report.tax_breakdown.map((item) => `
    <tr><td>${Number(item.tax_rate).toLocaleString('id-ID')}%</td><td>${money(item.taxable_revenue)}</td><td>${money(item.tax_amount)}</td><td>${money(item.gross_total)}</td></tr>`).join('') : emptyRow(4, 'Tidak ada data pajak pada periode ini.');
  document.getElementById('report-sales-table').innerHTML = report.sales.length ? report.sales.map((sale) => `
    <tr><td>${escapeHtml(sale.sales_no)}</td><td>${formatDate(sale.start_date)}</td><td>${escapeHtml(memberName(sale.members))}</td><td>${money(sale.price_paid)}</td><td>${money(sale.revenue_amount)}</td><td>${money(sale.tax_amount)}</td></tr>`).join('') : emptyRow(6, 'Tidak ada transaksi pada periode ini.');
}

function showModal(title, eyebrow, content, wide = false) {
  const backdrop = document.getElementById('modal-backdrop');
  state.modalOpener = document.activeElement;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-eyebrow').textContent = eyebrow;
  document.getElementById('modal-content').innerHTML = content;
  document.querySelector('.modal').classList.toggle('modal-wide', wide);
  backdrop.hidden = false;
  document.querySelector('.modal [data-action="close-modal"]').focus();
}

function closeModal() {
  document.getElementById('modal-backdrop').hidden = true;
  state.modalOpener?.focus?.();
}

function openMemberForm(member = null) {
  const editing = Boolean(member);
  showModal(editing ? 'Edit member' : 'Tambah member', editing ? 'PERBARUI DATA' : 'MEMBER BARU', `
    <form id="member-form" class="modal-form" data-id="${escapeHtml(member?.id || '')}">
      <label class="field field-full"><span>Nama lengkap <i>*</i></span><input name="name" maxlength="100" required value="${escapeHtml(member?.name || '')}"></label>
      <label class="field"><span>Email</span><input type="email" name="email" maxlength="100" value="${escapeHtml(member?.email || '')}"></label>
      <label class="field"><span>Telepon</span><input type="tel" name="phone" maxlength="20" value="${escapeHtml(member?.phone || '')}"></label>
      <label class="field"><span>Tanggal bergabung</span><input type="date" name="join_date" value="${escapeHtml(member?.join_date || todayString())}"></label>
      ${editing ? `<label class="field"><span>Status</span><select name="status"><option value="active" ${member.status === 'active' ? 'selected' : ''}>Aktif</option><option value="inactive" ${member.status === 'inactive' ? 'selected' : ''}>Tidak aktif</option></select></label>` : ''}
      <div class="modal-form-actions"><button class="button button-quiet" type="button" data-action="close-modal">Batal</button><button class="button button-primary" type="submit">${editing ? 'Simpan perubahan' : 'Tambah member'}</button></div>
    </form>`);
}

function openPackageForm(item = null) {
  const editing = Boolean(item);
  showModal(editing ? 'Edit paket' : 'Tambah paket', 'MEMBERSHIP PLAN', `
    <form id="package-form" class="modal-form" data-id="${escapeHtml(item?.id || '')}">
      <label class="field field-full"><span>Nama paket <i>*</i></span><input name="name" maxlength="50" required value="${escapeHtml(item?.name || '')}"></label>
      <label class="field"><span>Durasi (bulan) <i>*</i></span><input type="number" name="duration_months" min="1" step="1" required value="${escapeHtml(item?.duration_months || '')}"></label>
      <label class="field"><span>Durasi (hari) <i>*</i></span><input type="number" name="duration_days" min="1" step="1" required value="${escapeHtml(item?.duration_days || '')}"></label>
      <label class="field"><span>Harga termasuk PPN <i>*</i></span><input type="number" name="price" min="1" step="0.01" required value="${escapeHtml(item?.price || '')}"></label>
      <label class="field"><span>Tarif PPN (%) <i>*</i></span><input type="number" name="tax_rate" min="0" max="100" step="0.01" required value="${escapeHtml(item?.tax_rate ?? 11)}"></label>
      ${editing ? `<label class="field field-full"><span>Status</span><select name="is_active"><option value="true" ${item.is_active ? 'selected' : ''}>Aktif</option><option value="false" ${!item.is_active ? 'selected' : ''}>Diarsipkan</option></select></label>` : ''}
      <div class="modal-form-actions"><button class="button button-quiet" type="button" data-action="close-modal">Batal</button><button class="button button-primary" type="submit">${editing ? 'Simpan perubahan' : 'Tambah paket'}</button></div>
    </form>`);
}

async function openMemberDetail(id) {
  const [member, sales] = await Promise.all([api(`/members/${id}`), api(`/members/${id}/sales`)]);
  const history = sales.length ? `<div class="table-wrap"><table><thead><tr><th>Sales</th><th>Paket</th><th>Mulai</th><th>Berakhir</th><th>Total</th></tr></thead><tbody>${sales.map((sale) => `
    <tr><td>${escapeHtml(sale.sales_no)}</td><td>${escapeHtml(packageName(sale.packages))}</td><td>${formatDate(sale.start_date)}</td><td>${formatDate(sale.end_date)}</td><td>${money(sale.price_paid)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="modal-note">Belum ada riwayat membership.</p>';
  showModal(member.name, `MEMBER · ${member.member_code}`, `
    <div class="detail-list">
      <div class="detail-item"><span>Status</span><strong>${member.status === 'active' ? 'Aktif' : 'Tidak aktif'}</strong></div>
      <div class="detail-item"><span>Tanggal bergabung</span><strong>${formatDate(member.join_date)}</strong></div>
      <div class="detail-item"><span>Email</span><strong>${escapeHtml(member.email || '—')}</strong></div>
      <div class="detail-item"><span>Telepon</span><strong>${escapeHtml(member.phone || '—')}</strong></div>
    </div>
    <div class="detail-block"><h3>Riwayat sales</h3>${history}</div>`, true);
}

async function openSaleDetail(id) {
  const sale = await api(`/sales/${id}`);
  const journalValue = Array.isArray(sale.journals) ? sale.journals[0] : sale.journals;
  const journalLink = journalValue ? `<button class="button button-secondary" type="button" data-action="open-related-journal" data-id="${escapeHtml(journalValue.id)}">Buka jurnal ${escapeHtml(journalValue.journal_no)} →</button>` : '<p class="modal-note">Jurnal tidak ditemukan.</p>';
  showModal(`Transaksi ${sale.sales_no}`, 'DETAIL SALES', `
    <div class="detail-list">
      <div class="detail-item"><span>Member</span><strong>${escapeHtml(memberName(sale.members))}</strong></div>
      <div class="detail-item"><span>Paket</span><strong>${escapeHtml(packageName(sale.packages))}</strong></div>
      <div class="detail-item"><span>Periode membership</span><strong>${formatDate(sale.start_date)} – ${formatDate(sale.end_date)}</strong></div>
      <div class="detail-item"><span>Metode bayar</span><strong>${sale.payment_method === 'cash' ? 'Cash' : 'Transfer'} · Lunas</strong></div>
      <div class="detail-item"><span>Total dibayar</span><strong>${money(sale.price_paid)}</strong></div>
      <div class="detail-item"><span>DPP</span><strong>${money(sale.revenue_amount)}</strong></div>
      <div class="detail-item"><span>PPN ${Number(sale.tax_rate).toLocaleString('id-ID')}%</span><strong>${money(sale.tax_amount)}</strong></div>
      <div class="detail-item"><span>Catatan</span><strong>${escapeHtml(sale.notes || '—')}</strong></div>
    </div>
    <div class="detail-block"><h3>Jurnal otomatis</h3>${journalLink}</div>
    <form id="sale-notes-form" class="modal-form" data-id="${escapeHtml(sale.id)}">
      <label class="field field-full"><span>Ubah catatan sales</span><input name="notes" maxlength="500" value="${escapeHtml(sale.notes || '')}"></label>
      <div class="modal-form-actions"><button class="button button-primary" type="submit">Simpan catatan</button></div>
    </form>`, true);
}

async function openJournalDetail(id) {
  const journal = await api(`/journals/${id}`);
  const entries = journal.journal_entries || [];
  showModal(`Jurnal ${journal.journal_no}`, 'JURNAL UMUM', `
    <div class="detail-list">
      <div class="detail-item"><span>Tanggal</span><strong>${formatDate(journal.journal_date)}</strong></div>
      <div class="detail-item"><span>Referensi</span><strong>${escapeHtml(journal.sales?.sales_no || `Sale #${journal.reference_id}`)}</strong></div>
      <div class="detail-item"><span>Deskripsi</span><strong>${escapeHtml(journal.description)}</strong></div>
      <div class="detail-item"><span>Jenis referensi</span><strong>${escapeHtml(journal.reference_type)}</strong></div>
    </div>
    <div class="detail-block"><h3>Baris jurnal</h3><div class="table-wrap"><table><thead><tr><th>Akun</th><th>Debit</th><th>Kredit</th></tr></thead><tbody>${entries.map((entry) => `
      <tr><td><span class="table-primary">${escapeHtml(entry.account_name)}</span><span class="table-secondary">${escapeHtml(entry.account_code)}</span></td><td>${Number(entry.debit) ? money(entry.debit) : '—'}</td><td>${Number(entry.credit) ? money(entry.credit) : '—'}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th>${money(entries.reduce((sum, entry) => sum + Number(entry.debit), 0))}</th><th>${money(entries.reduce((sum, entry) => sum + Number(entry.credit), 0))}</th></tr></tfoot></table></div></div>`, true);
}

function collectFilter(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function updateSalePreview() {
  const preview = document.getElementById('sale-preview');
  const selected = state.packages.find((item) => String(item.id) === document.getElementById('sale-package').value);
  const startDate = document.getElementById('sale-start').value;
  if (!selected) {
    preview.innerHTML = '<span>Pilih paket untuk melihat ringkasan transaksi.</span>';
    return;
  }
  const revenue = Math.round((Number(selected.price) / (1 + Number(selected.tax_rate) / 100) + Number.EPSILON) * 100) / 100;
  const tax = Math.round((Number(selected.price) - revenue + Number.EPSILON) * 100) / 100;
  let endDate = '—';
  if (startDate) {
    const end = new Date(`${startDate}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + Number(selected.duration_days));
    endDate = dateFormat.format(end);
  }
  preview.innerHTML = `
    <div class="preview-item"><span>Total dibayar</span><strong>${money(selected.price)}</strong></div><i class="preview-divider"></i>
    <div class="preview-item"><span>DPP</span><strong>${money(revenue)}</strong></div><i class="preview-divider"></i>
    <div class="preview-item"><span>PPN ${Number(selected.tax_rate).toLocaleString('id-ID')}%</span><strong>${money(tax)}</strong></div><i class="preview-divider"></i>
    <div class="preview-item"><span>Berakhir</span><strong>${endDate}</strong></div>`;
}

function downloadReport() {
  if (!state.report) return toast('Tampilkan laporan terlebih dahulu.', 'error');
  const rows = [
    ['No Sales', 'Tanggal', 'Member', 'Paket', 'Metode', 'Total Bruto', 'DPP', 'PPN'],
    ...state.report.sales.map((sale) => [
      sale.sales_no, sale.start_date, sale.members?.name || '', sale.packages?.name || '',
      sale.payment_method, sale.price_paid, sale.revenue_amount, sale.tax_amount
    ])
  ];
  const csv = rows.map((row) => row.map((value) => {
    let cell = String(value ?? '');
    if (/^[=+@-]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `laporan-pendapatan-${todayString()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function loadView(view, force = false) {
  state.currentView = view;
  if (view === 'dashboard') return loadDashboard();
  if (view === 'members') return loadMembers(document.getElementById('member-search').value);
  if (view === 'packages') return loadPackages();
  if (view === 'sales') {
    const [members, packages] = await Promise.all([loadMembersForSales(), api('/packages?active=true')]);
    state.packages = packages;
    renderPackageOptions();
    document.getElementById('sale-start').value ||= todayString();
    updateSalePreview();
    if (force || !state.sales.length) return loadSales(collectFilter(document.getElementById('sales-filter')));
    return undefined;
  }
  if (view === 'journals') {
    if (state.journalView === 'general') return loadJournals(collectFilter(document.getElementById('journal-filter')));
    return loadReport(collectFilter(document.getElementById('report-filter')));
  }
}

async function loadMembersForSales() {
  const members = await api('/members');
  state.members = members;
  renderMemberOptions();
  return members;
}

function navigateTo(view) {
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.view').forEach((section) => {
    const active = section.id === `view-${view}`;
    section.classList.toggle('is-visible', active);
    section.hidden = !active;
  });
  return loadView(view).catch((error) => toast(error.message, 'error'));
}

async function onClick(event) {
  const viewButton = event.target.closest('[data-view], [data-go-view]');
  if (viewButton) {
    event.preventDefault();
    navigateTo(viewButton.dataset.view || viewButton.dataset.goView);
    return;
  }
  const journalButton = event.target.closest('[data-journal-view]');
  if (journalButton) {
    state.journalView = journalButton.dataset.journalView;
    document.querySelectorAll('.subnav-tab').forEach((tab) => {
      const active = tab === journalButton;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.journal-pane').forEach((pane) => {
      const active = pane.id === `journal-${state.journalView}`;
      pane.classList.toggle('is-visible', active);
      pane.hidden = !active;
    });
    loadView('journals').catch((error) => toast(error.message, 'error'));
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button) {
    if (event.target.id === 'modal-backdrop') closeModal();
    return;
  }
  const id = button.dataset.id;
  try {
    switch (button.dataset.action) {
      case 'refresh-dashboard': await loadDashboard(); break;
      case 'new-member': openMemberForm(); break;
      case 'edit-member': openMemberForm(state.members.find((item) => String(item.id) === id) || await api(`/members/${id}`)); break;
      case 'member-detail': await openMemberDetail(id); break;
      case 'delete-member': {
        const member = state.members.find((item) => String(item.id) === id);
        if (confirm(`Hapus member ${member?.name || ''}? Penghapusan hanya diizinkan jika tidak ada sales.`)) {
          await api(`/members/${id}`, { method: 'DELETE' });
          toast('Member berhasil dihapus.');
          await loadMembers(document.getElementById('member-search').value);
        }
        break;
      }
      case 'new-package': openPackageForm(); break;
      case 'edit-package': openPackageForm(state.packages.find((item) => String(item.id) === id) || await api(`/packages/${id}`)); break;
      case 'archive-package':
        if (confirm('Arsipkan paket ini? Paket tidak akan muncul untuk transaksi baru.')) {
          await api(`/packages/${id}/archive`, { method: 'PATCH' });
          toast('Paket berhasil diarsipkan.');
          await loadPackages();
        }
        break;
      case 'activate-package':
        await api(`/packages/${id}/activate`, { method: 'PATCH' });
        toast('Paket berhasil diaktifkan.');
        await loadPackages();
        break;
      case 'sale-detail': await openSaleDetail(id); break;
      case 'journal-detail': await openJournalDetail(id); break;
      case 'open-related-journal': closeModal(); navigateTo('journals'); await openJournalDetail(id); break;
      case 'renew-member':
        await navigateTo('sales');
        document.getElementById('sale-member').value = id;
        document.getElementById('sale-package').focus();
        updateSalePreview();
        break;
      case 'export-report': downloadReport(); break;
      case 'close-modal': closeModal(); break;
      default: break;
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function onSubmit(event) {
  const form = event.target;
  try {
    if (form.id === 'member-form') {
      event.preventDefault();
      const id = form.dataset.id;
      const data = Object.fromEntries(new FormData(form).entries());
      const body = {
        ...data,
        email: data.email.trim() || null,
        phone: data.phone.trim() || null
      };
      await api(id ? `/members/${id}` : '/members', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(body)
      });
      closeModal();
      toast(id ? 'Data member diperbarui.' : 'Member berhasil ditambahkan.');
      await loadMembers(document.getElementById('member-search').value);
    } else if (form.id === 'package-form') {
      event.preventDefault();
      const id = form.dataset.id;
      const data = Object.fromEntries(new FormData(form).entries());
      const body = {
        ...data,
        duration_months: Number(data.duration_months),
        duration_days: Number(data.duration_days),
        price: Number(data.price),
        tax_rate: Number(data.tax_rate),
        ...(data.is_active !== undefined ? { is_active: data.is_active === 'true' } : {})
      };
      await api(id ? `/packages/${id}` : '/packages', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(body)
      });
      closeModal();
      toast(id ? 'Paket berhasil diperbarui.' : 'Paket berhasil ditambahkan.');
      await loadPackages();
    } else if (form.id === 'sale-form') {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const result = await api('/sales', { method: 'POST', body: JSON.stringify(data) });
      toast(`Transaksi ${result.sales_no} dan jurnal ${result.journal?.journal_no || ''} berhasil dibuat.`);
      form.reset();
      document.getElementById('sale-start').value = todayString();
      updateSalePreview();
      await Promise.all([loadSales(collectFilter(document.getElementById('sales-filter'))), loadMembersForSales()]);
    } else if (form.id === 'sale-notes-form') {
      event.preventDefault();
      await api(`/sales/${form.dataset.id}`, {
        method: 'PATCH', body: JSON.stringify({ notes: new FormData(form).get('notes') })
      });
      toast('Catatan sales diperbarui.');
      const id = form.dataset.id;
      await openSaleDetail(id);
    } else if (form.id === 'sales-filter') {
      event.preventDefault();
      await loadSales(collectFilter(form));
    } else if (form.id === 'journal-filter') {
      event.preventDefault();
      await loadJournals(collectFilter(form));
    } else if (form.id === 'report-filter') {
      event.preventDefault();
      await loadReport(collectFilter(form));
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

function bindEvents() {
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.getElementById('package-filter').addEventListener('change', () => {
    loadPackages().catch((error) => toast(error.message, 'error'));
  });
  document.getElementById('member-search').addEventListener('input', (event) => {
    window.clearTimeout(window.memberSearchTimer);
    window.memberSearchTimer = window.setTimeout(() => {
      loadMembers(event.target.value).catch((error) => toast(error.message, 'error'));
    }, 220);
  });
  document.getElementById('sale-package').addEventListener('change', updateSalePreview);
  document.getElementById('sale-start').addEventListener('change', updateSalePreview);
  document.getElementById('sales-filter').addEventListener('reset', () => {
    window.setTimeout(() => loadSales().catch((error) => toast(error.message, 'error')));
  });
  document.getElementById('journal-filter').addEventListener('reset', () => {
    window.setTimeout(() => loadJournals().catch((error) => toast(error.message, 'error')));
  });
  document.getElementById('report-filter').addEventListener('reset', () => {
    window.setTimeout(() => loadReport().catch((error) => toast(error.message, 'error')));
  });
  document.getElementById('modal-backdrop').addEventListener('click', (event) => {
    if (event.target.id === 'modal-backdrop') closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('modal-backdrop').hidden) closeModal();
  });
}

function startApp() {
  updateTodayLabel();
  document.getElementById('sale-start').value = todayString();
  bindEvents();
  navigateTo('dashboard');
}

startApp();
