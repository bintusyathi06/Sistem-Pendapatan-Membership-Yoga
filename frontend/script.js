const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const byId = (id) => document.getElementById(id);
const moneyFormat = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const today = new Date();
today.setHours(0, 0, 0, 0);

function dateOffset(days) {
  const date = new Date(today);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function money(value) {
  return moneyFormat.format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : dateFormat.format(date);
}

function setText(id, value) {
  const node = byId(id);
  if (node) node.textContent = value;
}

function setHtml(id, value) {
  const node = byId(id);
  if (node) node.innerHTML = value;
}

function emptyRow(columns, text) {
  return `<tr><td class="empty-cell" colspan="${columns}">${escapeHtml(text)}</td></tr>`;
}

const state = {
  view: 'dashboard',
  journalView: 'general',
  modalOpener: null,
  report: null,
  members: [
    { id: 1, member_code: 'MBR-0001', name: 'Rina Wijaya', email: 'rina@example.com', phone: '0812-1111-2222', join_date: dateOffset(-210) },
    { id: 2, member_code: 'MBR-0002', name: 'Ani Kartika', email: 'ani@example.com', phone: '0813-2222-3333', join_date: dateOffset(-185) },
    { id: 3, member_code: 'MBR-0003', name: 'Dewi Lestari', email: 'dewi@example.com', phone: '0815-3333-4444', join_date: dateOffset(-150) },
    { id: 4, member_code: 'MBR-0004', name: 'Sinta Maharani', email: 'sinta@example.com', phone: '0817-4444-5555', join_date: dateOffset(-120) },
    { id: 5, member_code: 'MBR-0005', name: 'Eka Putri', email: 'eka@example.com', phone: '0821-5555-6666', join_date: dateOffset(-90) }
  ],
  packages: [
    { id: 1, name: '1 Bulan', duration_months: 1, duration_days: 30, price: 500000, tax_rate: 11, is_active: true },
    { id: 2, name: '3 Bulan', duration_months: 3, duration_days: 90, price: 1350000, tax_rate: 11, is_active: true },
    { id: 3, name: '6 Bulan', duration_months: 6, duration_days: 180, price: 2500000, tax_rate: 11, is_active: true },
    { id: 4, name: '1 Tahun', duration_months: 12, duration_days: 365, price: 4500000, tax_rate: 11, is_active: true }
  ],
  sales: [],
  journals: [],
  nextMemberId: 6,
  nextPackageId: 5,
  nextSaleId: 9,
  nextJournalId: 6
};

function makeSale(id, memberId, packageId, daysAgo, paymentMethod) {
  const membershipPackage = state.packages.find((item) => item.id === packageId);
  const startDate = dateOffset(-daysAgo);
  const revenue = Math.round((membershipPackage.price / (1 + membershipPackage.tax_rate / 100) + Number.EPSILON) * 100) / 100;
  const tax = Math.round((membershipPackage.price - revenue + Number.EPSILON) * 100) / 100;
  return {
    id,
    sales_no: `SLS-${startDate.slice(0, 4)}${startDate.slice(5, 7)}-${String(id).padStart(4, '0')}`,
    member_id: memberId,
    package_id: packageId,
    start_date: startDate,
    end_date: addDays(startDate, membershipPackage.duration_days),
    price_paid: membershipPackage.price,
    tax_rate: membershipPackage.tax_rate,
    tax_amount: tax,
    revenue_amount: revenue,
    payment_method: paymentMethod,
    notes: '',
    journal_id: null
  };
}

state.sales = [
  makeSale(1, 1, 1, 27, 'cash'), makeSale(2, 2, 2, 89, 'transfer'),
  makeSale(3, 3, 3, 176, 'cash'), makeSale(4, 4, 4, 360, 'transfer'),
  makeSale(5, 5, 1, 38, 'cash'), makeSale(6, 1, 2, 85, 'transfer'),
  makeSale(7, 3, 1, 25, 'cash'), makeSale(8, 2, 1, 4, 'cash')
];

function memberById(id) {
  return state.members.find((member) => member.id === Number(id));
}

function packageById(id) {
  return state.packages.find((item) => item.id === Number(id));
}

function syncMemberStatuses() {
  const currentDate = dateOffset(0);
  state.members.forEach((member) => {
    const mostRecentEnd = state.sales.filter((sale) => sale.member_id === member.id)
      .map((sale) => sale.end_date).sort().at(-1);
    member.status = mostRecentEnd && mostRecentEnd >= currentDate ? 'active' : 'inactive';
  });
}

function makeJournal(sale, journalId, journalNo) {
  const member = memberById(sale.member_id);
  const membershipPackage = packageById(sale.package_id);
  const description = `Penjualan paket ${membershipPackage.name} - ${member.name}`;
  return {
    id: journalId,
    journal_no: journalNo,
    journal_date: sale.start_date,
    description,
    reference_type: 'sale',
    reference_id: sale.id,
    sale_no: sale.sales_no,
    journal_entries: [
      { account_code: '1-1000', account_name: 'Kas & Bank', debit: sale.price_paid, credit: 0 },
      { account_code: '4-4000', account_name: 'Pendapatan Membership', debit: 0, credit: sale.revenue_amount },
      { account_code: '2-2000', account_name: 'PPN Keluaran', debit: 0, credit: sale.tax_amount }
    ]
  };
}

state.sales.slice(0, 5).forEach((sale, index) => {
  const month = sale.start_date.slice(0, 4) + sale.start_date.slice(5, 7);
  sale.journal_id = index + 1;
  state.journals.push(makeJournal(sale, index + 1, `JV-${month}-${String(index + 1).padStart(4, '0')}`));
});

// Show a temporary success/error toast without assuming the target exists.
function toast(message, type = 'success') {
  const region = byId('toast-region');
  if (!region) return;
  const item = document.createElement('div');
  item.className = `toast${type === 'error' ? ' toast-error' : ''}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 3600);
}

function actionButton(action, label, id, style = 'button-secondary') {
  return `<button class="button ${style} button-small" type="button" data-action="${action}" data-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
}

function renderDashboard() {
  syncMemberStatuses();
  const month = dateOffset(0).slice(0, 7);
  const monthlySales = state.sales.filter((sale) => sale.start_date.startsWith(month));
  setText('today-label', dateFormat.format(today));
  setText('dashboard-period', dateFormat.format(today));
  setText('metric-active', String(state.members.filter((member) => member.status === 'active').length));
  setText('metric-sales', String(monthlySales.length));
  setText('metric-revenue', money(monthlySales.reduce((sum, sale) => sum + sale.revenue_amount, 0)));
  setText('metric-tax', money(monthlySales.reduce((sum, sale) => sum + sale.tax_amount, 0)));

  const edge = dateOffset(7);
  const expiring = state.members.map((member) => {
    const lastEnd = state.sales.filter((sale) => sale.member_id === member.id).map((sale) => sale.end_date).sort().at(-1);
    return lastEnd ? { ...member, end_date: lastEnd } : null;
  }).filter((member) => member && member.end_date >= dateOffset(0) && member.end_date <= edge)
    .sort((a, b) => a.end_date.localeCompare(b.end_date));
  setText('expiring-count', String(expiring.length));
  setHtml('dashboard-expiring', expiring.length ? expiring.map((member) => `
    <tr><td data-label="Member"><span class="table-primary">${escapeHtml(member.name)}</span><span class="table-secondary">${escapeHtml(member.member_code)}</span></td>
    <td data-label="Berakhir">${formatDate(member.end_date)}</td><td data-label="Status"><span class="status status-expiring">Segera expired</span></td>
    <td data-label="Aksi">${actionButton('renew-member', 'Perpanjang', member.id, 'button-primary')}</td></tr>`).join('') : emptyRow(4, 'Belum ada member yang segera expired, nih~'));
  const recent = [...state.sales].sort((a, b) => b.start_date.localeCompare(a.start_date)).slice(0, 5);
  setHtml('dashboard-sales', recent.map((sale) => `
    <tr><td data-label="No. sales"><span class="table-primary">${escapeHtml(sale.sales_no)}</span></td>
    <td data-label="Member">${escapeHtml(memberById(sale.member_id)?.name || '—')}</td><td data-label="Paket">${escapeHtml(packageById(sale.package_id)?.name || '—')}</td>
    <td data-label="Tanggal">${formatDate(sale.start_date)}</td><td data-label="Total">${money(sale.price_paid)}</td></tr>`).join('') || emptyRow(5, 'Belum ada transaksi.'));
}

// Render member rows and refresh member selectors.
function renderMembers(search = '') {
  syncMemberStatuses();
  const normalized = search.trim().toLowerCase();
  const members = state.members.filter((member) => `${member.member_code} ${member.name} ${member.email} ${member.phone}`.toLowerCase().includes(normalized));
  setText('member-count', `${members.length} member`);
  setHtml('members-table', members.map((member) => `
    <tr><td data-label="Kode"><span class="table-primary">${escapeHtml(member.member_code)}</span></td>
    <td data-label="Nama"><span class="table-primary">${escapeHtml(member.name)}</span></td><td data-label="Email">${escapeHtml(member.email || '—')}</td>
    <td data-label="Phone">${escapeHtml(member.phone || '—')}</td><td data-label="Join date">${formatDate(member.join_date)}</td>
    <td data-label="Status"><span class="status ${member.status === 'active' ? 'status-active' : 'status-inactive'}">${member.status === 'active' ? 'Aktif' : 'Tidak aktif'}</span></td>
    <td data-label="Aksi"><div class="table-actions">${actionButton('member-detail', 'Detail', member.id)}${actionButton('edit-member', 'Edit', member.id, 'button-edit')}${actionButton('delete-member', 'Hapus', member.id, 'button-danger')}</div></td></tr>`).join('') || emptyRow(7, 'Belum ada member yang cocok, nih~'));
  const empty = byId('members-empty');
  if (empty) empty.hidden = members.length > 0;
  renderMemberOptions();
}

function renderMemberOptions() {
  const options = state.members.map((member) => `<option value="${member.id}">${escapeHtml(member.member_code)} · ${escapeHtml(member.name)}</option>`).join('');
  const saleMember = byId('sale-member');
  if (saleMember) {
    const selected = saleMember.value;
    saleMember.innerHTML = `<option value="">Pilih member</option>${options}`;
    saleMember.value = selected;
  }
  const memberFilter = $('#sales-filter select[name="member_id"]');
  if (memberFilter) {
    const selected = memberFilter.value;
    memberFilter.innerHTML = `<option value="">Semua member</option>${options}`;
    memberFilter.value = selected;
  }
}

// Render active and archived package cards.
function renderPackages() {
  const filter = byId('package-filter')?.value || 'all';
  const packages = state.packages.filter((item) => filter === 'all' || String(item.is_active) === filter);
  setText('package-count', `${packages.length} paket`);
  setHtml('packages-grid', packages.map((item) => `
    <article class="package-card${item.is_active ? '' : ' is-archived'}">
      <div class="package-card-top"><h2>${escapeHtml(item.name)}</h2>${item.is_active ? '<span class="status status-active">Aktif</span>' : '<span class="archived-pill">Archived</span>'}</div>
      <p class="package-duration">${item.duration_months} bulan · ${item.duration_days} hari</p><p class="package-price">${money(item.price)}</p>
      <span class="package-tax">Harga termasuk PPN ${Number(item.tax_rate).toLocaleString('id-ID')}%</span>
      <div class="package-actions">${actionButton('edit-package', 'Edit', item.id, 'button-edit')}${item.is_active ? actionButton('archive-package', 'Archive', item.id, 'button-archive') : actionButton('activate-package', 'Aktifkan', item.id, 'button-primary')}</div>
    </article>`).join(''));
  const empty = byId('packages-empty');
  if (empty) empty.hidden = packages.length > 0;
  renderPackageOptions();
}

function renderPackageOptions() {
  const select = byId('sale-package');
  if (!select) return;
  const selected = select.value;
  select.innerHTML = `<option value="">Pilih paket</option>${state.packages.filter((item) => item.is_active).map((item) => `<option value="${item.id}">${escapeHtml(item.name)} · ${money(item.price)}</option>`).join('')}`;
  select.value = selected;
  updateSalePreview();
}

// Apply current sales filters and render the transaction history.
function renderSales() {
  const form = byId('sales-filter');
  const filter = form ? Object.fromEntries(new FormData(form).entries()) : {};
  const sales = state.sales.filter((sale) => (!filter.start || sale.start_date >= filter.start) && (!filter.end || sale.start_date <= filter.end) && (!filter.member_id || sale.member_id === Number(filter.member_id)) && (!filter.method || sale.payment_method === filter.method)).sort((a, b) => b.start_date.localeCompare(a.start_date));
  setText('sales-count', `${sales.length} transaksi`);
  setHtml('sales-table', sales.map((sale) => `
    <tr><td data-label="No. sales"><span class="table-primary">${escapeHtml(sale.sales_no)}</span></td><td data-label="Tanggal">${formatDate(sale.start_date)}</td>
    <td data-label="Member">${escapeHtml(memberById(sale.member_id)?.name || '—')}</td><td data-label="Paket">${escapeHtml(packageById(sale.package_id)?.name || '—')}</td>
    <td data-label="Metode"><span class="badge badge-pink">${sale.payment_method === 'cash' ? 'Cash' : 'Transfer'}</span></td><td data-label="Total">${money(sale.price_paid)}</td>
    <td data-label="Aksi"><div class="table-actions">${actionButton('sale-detail', 'Detail', sale.id)}</div></td></tr>`).join('') || emptyRow(7, 'Belum ada transaksi pada filter ini.'));
}

// Render journal rows and show a balance indicator for each journal.
function renderJournals() {
  const form = byId('journal-filter');
  const filter = form ? Object.fromEntries(new FormData(form).entries()) : {};
  const journals = state.journals.filter((journal) => (!filter.start || journal.journal_date >= filter.start) && (!filter.end || journal.journal_date <= filter.end)).sort((a, b) => b.journal_date.localeCompare(a.journal_date));
  setHtml('journals-table', journals.map((journal) => {
    const debit = journal.journal_entries.reduce((sum, entry) => sum + entry.debit, 0);
    const credit = journal.journal_entries.reduce((sum, entry) => sum + entry.credit, 0);
    const balanced = Math.abs(debit - credit) <= 0.01;
    return `<tr><td data-label="No. jurnal"><span class="table-primary">${escapeHtml(journal.journal_no)}</span></td><td data-label="Tanggal">${formatDate(journal.journal_date)}</td>
      <td data-label="Deskripsi">${escapeHtml(journal.description)}</td><td data-label="Referensi">${escapeHtml(journal.sale_no)}</td>
      <td data-label="Balance"><span class="status ${balanced ? 'status-active' : 'status-inactive'}">${balanced ? '✓ Balance' : 'Periksa'}</span></td>
      <td data-label="Aksi"><div class="table-actions">${actionButton('journal-detail', 'Detail', journal.id)}</div></td></tr>`;
  }).join('') || emptyRow(6, 'Belum ada jurnal, nih~'));
}

// Render revenue totals, tax breakdown, and report detail rows.
function renderReport() {
  const form = byId('report-filter');
  const filter = form ? Object.fromEntries(new FormData(form).entries()) : {};
  const sales = state.sales.filter((sale) => (!filter.start || sale.start_date >= filter.start) && (!filter.end || sale.start_date <= filter.end) && (!filter.method || sale.payment_method === filter.method)).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const gross = sales.reduce((sum, sale) => sum + sale.price_paid, 0);
  const revenue = sales.reduce((sum, sale) => sum + sale.revenue_amount, 0);
  const tax = sales.reduce((sum, sale) => sum + sale.tax_amount, 0);
  state.report = { sales, gross, revenue, tax };
  setHtml('report-summary', `<div class="report-total"><span>Total penjualan · ${sales.length} transaksi</span><strong>${money(gross)}</strong></div><div class="report-total"><span>Pendapatan (DPP)</span><strong>${money(revenue)}</strong></div><div class="report-total"><span>PPN keluaran</span><strong>${money(tax)}</strong></div>`);
  const rate = new Map();
  sales.forEach((sale) => {
    const totals = rate.get(sale.tax_rate) || { dpp: 0, tax: 0, gross: 0 };
    totals.dpp += sale.revenue_amount; totals.tax += sale.tax_amount; totals.gross += sale.price_paid;
    rate.set(sale.tax_rate, totals);
  });
  setHtml('report-tax-table', [...rate.entries()].map(([taxRate, values]) => `<tr><td data-label="Tarif PPN">${taxRate}%</td><td data-label="DPP">${money(values.dpp)}</td><td data-label="PPN">${money(values.tax)}</td><td data-label="Total bruto">${money(values.gross)}</td></tr>`).join('') || emptyRow(4, 'Tidak ada data pajak pada periode ini.'));
  setHtml('report-sales-table', sales.map((sale) => `<tr><td data-label="No. sales">${escapeHtml(sale.sales_no)}</td><td data-label="Tanggal">${formatDate(sale.start_date)}</td><td data-label="Member">${escapeHtml(memberById(sale.member_id)?.name || '—')}</td><td data-label="Total">${money(sale.price_paid)}</td><td data-label="DPP">${money(sale.revenue_amount)}</td><td data-label="PPN">${money(sale.tax_amount)}</td></tr>`).join('') || emptyRow(6, 'Belum ada transaksi pada periode ini.'));
}

// Open a dialog while preserving the control that launched it.
function showModal(title, eyebrow, content, wide = false) {
  const backdrop = byId('modal-backdrop');
  const modal = $('.modal');
  if (!backdrop || !modal) return;
  state.modalOpener = document.activeElement;
  setText('modal-title', title); setText('modal-eyebrow', eyebrow); setHtml('modal-content', content);
  modal.classList.toggle('modal-wide', wide);
  backdrop.hidden = false;
  $('[data-action="close-modal"]', modal)?.focus();
}

function closeModal() {
  const backdrop = byId('modal-backdrop');
  if (!backdrop) return;
  backdrop.hidden = true;
  state.modalOpener?.focus?.();
}

function openMemberForm(member = null) {
  const editing = Boolean(member);
  showModal(editing ? 'Edit member' : 'Tambah member', editing ? 'PERBARUI DATA' : 'MEMBER BARU', `
    <form id="member-form" class="modal-form" data-id="${escapeHtml(member?.id || '')}">
      <label class="field field-full"><span>Nama lengkap <i>*</i></span><input name="name" maxlength="100" required value="${escapeHtml(member?.name || '')}"></label>
      <label class="field"><span>Email</span><input type="email" name="email" maxlength="100" value="${escapeHtml(member?.email || '')}"></label>
      <label class="field"><span>Telepon</span><input type="tel" name="phone" maxlength="20" value="${escapeHtml(member?.phone || '')}"></label>
      <label class="field"><span>Tanggal bergabung</span><input type="date" name="join_date" value="${escapeHtml(member?.join_date || dateOffset(0))}"></label>
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

function openMemberDetail(id) {
  const member = memberById(id);
  if (!member) return toast('Member tidak ditemukan.', 'error');
  const history = state.sales.filter((sale) => sale.member_id === member.id).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const rows = history.length ? `<div class="table-wrap"><table><thead><tr><th>Sales</th><th>Paket</th><th>Mulai</th><th>Berakhir</th><th>Total</th></tr></thead><tbody>${history.map((sale) => `<tr><td>${escapeHtml(sale.sales_no)}</td><td>${escapeHtml(packageById(sale.package_id)?.name || '—')}</td><td>${formatDate(sale.start_date)}</td><td>${formatDate(sale.end_date)}</td><td>${money(sale.price_paid)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="modal-note">Belum ada riwayat membership.</p>';
  showModal(member.name, `MEMBER · ${member.member_code}`, `<div class="detail-list"><div class="detail-item"><span>Status</span><strong>${member.status === 'active' ? 'Aktif' : 'Tidak aktif'}</strong></div><div class="detail-item"><span>Tanggal bergabung</span><strong>${formatDate(member.join_date)}</strong></div><div class="detail-item"><span>Email</span><strong>${escapeHtml(member.email || '—')}</strong></div><div class="detail-item"><span>Telepon</span><strong>${escapeHtml(member.phone || '—')}</strong></div></div><div class="detail-block"><h3>Riwayat sales</h3>${rows}</div>`, true);
}

function openSaleDetail(id) {
  const sale = state.sales.find((item) => item.id === Number(id));
  if (!sale) return toast('Transaksi tidak ditemukan.', 'error');
  const journal = state.journals.find((item) => item.id === sale.journal_id);
  const journalButton = journal ? `<button class="button button-secondary" type="button" data-action="open-related-journal" data-id="${journal.id}">Buka jurnal ${escapeHtml(journal.journal_no)} →</button>` : '<p class="modal-note">Jurnal demo tidak tersedia.</p>';
  showModal(`Transaksi ${sale.sales_no}`, 'DETAIL SALES', `<div class="detail-list"><div class="detail-item"><span>Member</span><strong>${escapeHtml(memberById(sale.member_id)?.name || '—')}</strong></div><div class="detail-item"><span>Paket</span><strong>${escapeHtml(packageById(sale.package_id)?.name || '—')}</strong></div><div class="detail-item"><span>Periode membership</span><strong>${formatDate(sale.start_date)} – ${formatDate(sale.end_date)}</strong></div><div class="detail-item"><span>Metode bayar</span><strong>${sale.payment_method === 'cash' ? 'Cash' : 'Transfer'} · Lunas</strong></div><div class="detail-item"><span>Total dibayar</span><strong>${money(sale.price_paid)}</strong></div><div class="detail-item"><span>DPP</span><strong>${money(sale.revenue_amount)}</strong></div><div class="detail-item"><span>PPN ${sale.tax_rate}%</span><strong>${money(sale.tax_amount)}</strong></div><div class="detail-item"><span>Catatan</span><strong>${escapeHtml(sale.notes || '—')}</strong></div></div><div class="detail-block"><h3>Jurnal otomatis</h3>${journalButton}</div><form id="sale-notes-form" class="modal-form" data-id="${sale.id}"><label class="field field-full"><span>Ubah catatan sales</span><input name="notes" maxlength="500" value="${escapeHtml(sale.notes || '')}"></label><div class="modal-form-actions"><button class="button button-primary" type="submit">Simpan catatan</button></div></form>`, true);
}

function openJournalDetail(id) {
  const journal = state.journals.find((item) => item.id === Number(id));
  if (!journal) return toast('Jurnal tidak ditemukan.', 'error');
  const sale = state.sales.find((item) => item.id === journal.reference_id);
  const debit = journal.journal_entries.reduce((sum, entry) => sum + entry.debit, 0);
  const credit = journal.journal_entries.reduce((sum, entry) => sum + entry.credit, 0);
  const rows = journal.journal_entries.map((entry) => `<tr><td data-label="Akun"><span class="table-primary">${escapeHtml(entry.account_name)}</span><span class="table-secondary">${escapeHtml(entry.account_code)}</span></td><td data-label="Debit">${entry.debit ? money(entry.debit) : '—'}</td><td data-label="Kredit">${entry.credit ? money(entry.credit) : '—'}</td></tr>`).join('');
  showModal(`Jurnal ${journal.journal_no}`, 'JURNAL UMUM', `<div class="detail-list"><div class="detail-item"><span>Tanggal</span><strong>${formatDate(journal.journal_date)}</strong></div><div class="detail-item"><span>Referensi</span><strong>${escapeHtml(sale?.sales_no || `Sale #${journal.reference_id}`)}</strong></div><div class="detail-item"><span>Deskripsi</span><strong>${escapeHtml(journal.description)}</strong></div><div class="detail-item"><span>Balance</span><strong>${Math.abs(debit - credit) <= 0.01 ? '✓ Seimbang' : 'Periksa'}</strong></div></div><div class="detail-block"><h3>Baris jurnal</h3><div class="table-wrap"><table><thead><tr><th>Akun</th><th>Debit</th><th>Kredit</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th>Total</th><th>${money(debit)}</th><th>${money(credit)}</th></tr></tfoot></table></div></div>`, true);
}

// Update the payment, DPP, tax, and membership-end preview.
function updateSalePreview() {
  const preview = byId('sale-preview');
  const item = packageById(Number(byId('sale-package')?.value));
  const startDate = byId('sale-start')?.value || dateOffset(0);
  if (!preview) return;
  if (!item) { preview.innerHTML = '<p class="empty-copy">Pilih paket untuk melihat detail membership.</p>'; return; }
  const revenue = Math.round((item.price / (1 + item.tax_rate / 100) + Number.EPSILON) * 100) / 100;
  const tax = Math.round((item.price - revenue + Number.EPSILON) * 100) / 100;
  preview.innerHTML = `<div class="preview-row"><span>Harga include</span><strong>${money(item.price)}</strong></div><div class="preview-row"><span>Pendapatan / DPP</span><strong>${money(revenue)}</strong></div><div class="preview-row"><span>PPN ${item.tax_rate}%</span><strong>${money(tax)}</strong></div><div class="preview-row"><span>Aktif sampai</span><strong>${formatDate(addDays(startDate, item.duration_days))}</strong></div><div class="preview-row preview-total"><span>Total bayar</span><strong>${money(item.price)}</strong></div>`;
}

function nextNumber(prefix, collection) {
  const date = dateOffset(0);
  const month = date.slice(0, 4) + date.slice(5, 7);
  const field = prefix === 'SLS' ? 'sales_no' : 'journal_no';
  const highest = collection.filter((item) => item[field]?.startsWith(`${prefix}-${month}-`)).map((item) => Number(item[field].split('-').at(-1)) || 0).reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}-${month}-${String(highest + 1).padStart(4, '0')}`;
}

// Create a demo sale and its three balanced journal entries locally.
function createSale(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const member = memberById(data.member_id);
  const item = packageById(data.package_id);
  if (!member || !item || !item.is_active) throw new Error('Pilih member dan paket aktif.');
  const startDate = data.start_date || dateOffset(0);
  const revenue = Math.round((item.price / (1 + item.tax_rate / 100) + Number.EPSILON) * 100) / 100;
  const tax = Math.round((item.price - revenue + Number.EPSILON) * 100) / 100;
  const id = state.nextSaleId++;
  const sale = { id, sales_no: nextNumber('SLS', state.sales), member_id: member.id, package_id: item.id, start_date: startDate, end_date: addDays(startDate, item.duration_days), price_paid: item.price, tax_rate: item.tax_rate, tax_amount: tax, revenue_amount: revenue, payment_method: data.payment_method || 'cash', notes: data.notes.trim(), journal_id: null };
  const journalId = state.nextJournalId++;
  const journalMonth = startDate.slice(0, 4) + startDate.slice(5, 7);
  const journalNo = `JV-${journalMonth}-${String(journalId).padStart(4, '0')}`;
  const journal = makeJournal(sale, journalId, journalNo);
  sale.journal_id = journal.id;
  state.sales.unshift(sale);
  state.journals.unshift(journal);
  syncMemberStatuses();
  return { sale, journal };
}

function navigateTo(view) {
  state.view = view;
  $$('.nav-tab').forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  $$('.view').forEach((panel) => {
    const active = panel.id === `view-${view}`;
    panel.classList.toggle('is-visible', active);
    panel.hidden = !active;
  });
  if (view === 'dashboard') renderDashboard();
  if (view === 'members') renderMembers($('#member-search')?.value || '');
  if (view === 'packages') renderPackages();
  if (view === 'sales') { renderMemberOptions(); renderPackageOptions(); renderSales(); }
  if (view === 'journals') state.journalView === 'general' ? renderJournals() : renderReport();
}

function setJournalView(view) {
  state.journalView = view;
  $$('.subnav-tab').forEach((tab) => {
    const active = tab.dataset.journalView === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  $$('.journal-pane').forEach((panel) => {
    const active = panel.id === `journal-${view}`;
    panel.classList.toggle('is-visible', active);
    panel.hidden = !active;
  });
  view === 'general' ? renderJournals() : renderReport();
}

function deleteMember(id) {
  const member = memberById(id);
  if (!member) return;
  const endDates = state.sales.filter((sale) => sale.member_id === member.id).map((sale) => sale.end_date).sort();
  if (endDates.at(-1) >= dateOffset(0)) return toast('Member masih memiliki membership aktif.', 'error');
  if (endDates.length) return toast('Riwayat transaksi dipertahankan untuk audit demo.', 'error');
  if (!confirm(`Hapus member ${member.name}?`)) return;
  state.members = state.members.filter((item) => item.id !== member.id);
  renderMembers($('#member-search')?.value || '');
  toast('Member berhasil dihapus.');
}

function downloadReport() {
  if (!state.report) renderReport();
  const rows = [['No Sales', 'Tanggal', 'Member', 'Paket', 'Metode', 'Total Bruto', 'DPP', 'PPN'], ...state.report.sales.map((sale) => [sale.sales_no, sale.start_date, memberById(sale.member_id)?.name || '', packageById(sale.package_id)?.name || '', sale.payment_method, sale.price_paid, sale.revenue_amount, sale.tax_amount])];
  const csv = rows.map((row) => row.map((value) => {
    let cell = String(value ?? '');
    if (/^[=+@-]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' }));
  link.href = objectUrl; link.download = `laporan-membership-${dateOffset(0)}.csv`; link.click();
  URL.revokeObjectURL(objectUrl);
}

function onClick(event) {
  const navigation = event.target.closest('[data-view], [data-go-view]');
  if (navigation) { event.preventDefault(); navigateTo(navigation.dataset.view || navigation.dataset.goView); return; }
  const journalTab = event.target.closest('[data-journal-view]');
  if (journalTab) { setJournalView(journalTab.dataset.journalView); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = Number(button.dataset.id);
  const member = memberById(id);
  const item = packageById(id);
  try {
    switch (button.dataset.action) {
      case 'refresh-dashboard': renderDashboard(); toast('Ringkasan diperbarui.'); break;
      case 'new-member': openMemberForm(); break;
      case 'edit-member': openMemberForm(member); break;
      case 'member-detail': openMemberDetail(id); break;
      case 'delete-member': deleteMember(id); break;
      case 'new-package': openPackageForm(); break;
      case 'edit-package': openPackageForm(item); break;
      case 'archive-package': if (item && confirm(`Arsipkan paket ${item.name}?`)) { item.is_active = false; renderPackages(); toast('Paket diarsipkan.'); } break;
      case 'activate-package': if (item) { item.is_active = true; renderPackages(); toast('Paket diaktifkan.'); } break;
      case 'renew-member': navigateTo('sales'); if (byId('sale-member')) byId('sale-member').value = String(id); updateSalePreview(); break;
      case 'sale-detail': openSaleDetail(id); break;
      case 'journal-detail': openJournalDetail(id); break;
      case 'open-related-journal': closeModal(); navigateTo('journals'); openJournalDetail(id); break;
      case 'export-report': downloadReport(); break;
      case 'print-report': window.print(); break;
      case 'close-modal': closeModal(); break;
      default: break;
    }
  } catch (error) { toast(error.message || 'Aksi gagal diproses.', 'error'); }
}

function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  try {
    if (form.id === 'member-form') {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const id = Number(form.dataset.id);
      if (id) Object.assign(memberById(id), { ...data, email: data.email.trim(), phone: data.phone.trim() });
      else state.members.push({ id: state.nextMemberId, member_code: `MBR-${String(state.nextMemberId++).padStart(4, '0')}`, name: data.name.trim(), email: data.email.trim(), phone: data.phone.trim(), join_date: data.join_date || dateOffset(0), status: 'inactive' });
      closeModal(); renderMembers($('#member-search')?.value || ''); toast(id ? 'Data member diperbarui.' : 'Member berhasil ditambahkan.');
    } else if (form.id === 'package-form') {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const id = Number(form.dataset.id);
      const values = { name: data.name.trim(), duration_months: Number(data.duration_months), duration_days: Number(data.duration_days), price: Number(data.price), tax_rate: Number(data.tax_rate), is_active: data.is_active ? data.is_active === 'true' : true };
      if (id) Object.assign(packageById(id), values); else state.packages.push({ id: state.nextPackageId++, ...values });
      closeModal(); renderPackages(); toast(id ? 'Paket diperbarui.' : 'Paket ditambahkan.');
    } else if (form.id === 'sale-form') {
      event.preventDefault();
      const { sale, journal } = createSale(form);
      form.reset(); if (byId('sale-start')) byId('sale-start').value = dateOffset(0);
      updateSalePreview(); renderDashboard(); renderSales(); renderMemberOptions();
      toast(`Transaksi ${sale.sales_no} dan jurnal ${journal.journal_no} berhasil dibuat.`);
    } else if (form.id === 'sale-notes-form') {
      event.preventDefault();
      const sale = state.sales.find((item) => item.id === Number(form.dataset.id));
      if (sale) sale.notes = new FormData(form).get('notes').trim();
      toast('Catatan sales diperbarui.'); if (sale) openSaleDetail(sale.id);
    } else if (form.id === 'sales-filter') { event.preventDefault(); renderSales(); }
    else if (form.id === 'journal-filter') { event.preventDefault(); renderJournals(); }
    else if (form.id === 'report-filter') { event.preventDefault(); renderReport(); }
  } catch (error) { toast(error.message || 'Form belum dapat disimpan.', 'error'); }
}

// Bind the form, tab, filter, and dialog controls.
function bindEvents() {
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  byId('package-filter')?.addEventListener('change', renderPackages);
  byId('member-search')?.addEventListener('input', (event) => renderMembers(event.target.value));
  byId('sale-package')?.addEventListener('change', updateSalePreview);
  byId('sale-start')?.addEventListener('change', updateSalePreview);
  byId('sales-filter')?.addEventListener('reset', () => window.setTimeout(renderSales));
  byId('journal-filter')?.addEventListener('reset', () => window.setTimeout(renderJournals));
  byId('report-filter')?.addEventListener('reset', () => window.setTimeout(renderReport));
  byId('modal-backdrop')?.addEventListener('click', (event) => { if (event.target.id === 'modal-backdrop') closeModal(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && byId('modal-backdrop') && !byId('modal-backdrop').hidden) closeModal(); });
}

// Initialize the preview data and show the dashboard.
function startApp() {
  const dateTarget = byId('today-label');
  if (dateTarget) dateTarget.textContent = dateFormat.format(today);
  bindEvents();
  syncMemberStatuses();
  renderDashboard(); renderMembers(); renderPackages(); renderSales(); renderJournals(); renderReport();
  navigateTo('dashboard');
}

startApp();
