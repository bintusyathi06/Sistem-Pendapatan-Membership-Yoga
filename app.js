const http = require('http');
const url = require('url');

// UAT only: paste the Supabase project URL and anon key here before running.
const SUPABASE_URL = 'https://ytmrxmbbyyvvplxrzdcx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0t_YLBixo8s_Kw3X1mMgFA_Vu9HUetc';
const PORT = 3000;
const API_ROOT = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`;
const MAX_BODY_BYTES = 1024 * 1024;

const ACCOUNTS = {
  cash: { code: '1-1000', name: 'Kas & Bank' },
  tax: { code: '2-2000', name: 'PPN Keluaran' },
  revenue: { code: '4-4000', name: 'Pendapatan Membership' }
};

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Send every API response as JSON with the configured CORS headers.
function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

// Read and parse a bounded JSON request body.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Ukuran request melebihi batas 1 MB.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, 'Body harus berupa JSON yang valid.'));
      }
    });
    req.on('error', reject);
  });
}

// Call Supabase PostgREST and normalize database errors.
async function supabaseRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_ROOT}/${path}`, {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new HttpError(502, 'Tidak dapat terhubung ke Supabase.', error.message);
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const code = data && data.code;
    const status = code === '23505' || code === '23503' ? 409
      : code === '23514' || code === '22P02' ? 400
        : response.status === 404 || code === 'PGRST116' ? 404
          : 502;
    throw new HttpError(status, data?.message || 'Permintaan Supabase gagal.', data);
  }
  return data;
}

// Build a PostgREST query string from key/value filters.
function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  return params.toString();
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function requireId(value) {
  if (!/^\d+$/.test(String(value))) throw new HttpError(400, 'ID harus berupa angka positif.');
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'ID harus berupa angka positif.');
  return id;
}

function validateEmail(email) {
  return email === null || email === undefined || email === '' ||
    (typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function validatePhone(phone) {
  return phone === null || phone === undefined || phone === '' ||
    (typeof phone === 'string' && /^[0-9+() .-]{7,20}$/.test(phone));
}

function validateMember(payload) {
  if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 100) {
    throw new HttpError(400, 'Nama wajib diisi dan maksimal 100 karakter.');
  }
  if (!validateEmail(payload.email)) throw new HttpError(400, 'Format email tidak valid.');
  if (!validatePhone(payload.phone)) throw new HttpError(400, 'Format nomor telepon tidak valid.');
  if (payload.join_date !== undefined && !isValidDate(payload.join_date)) {
    throw new HttpError(400, 'Format join_date harus YYYY-MM-DD.');
  }
  if (payload.status !== undefined && !['active', 'inactive'].includes(payload.status)) {
    throw new HttpError(400, 'Status member hanya active atau inactive.');
  }
}

function validatePackage(payload) {
  if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 50) {
    throw new HttpError(400, 'Nama paket wajib diisi dan maksimal 50 karakter.');
  }
  if (!Number.isInteger(Number(payload.duration_months)) || Number(payload.duration_months) <= 0 ||
      !Number.isInteger(Number(payload.duration_days)) || Number(payload.duration_days) <= 0) {
    throw new HttpError(400, 'Durasi paket harus berupa angka positif.');
  }
  if (!Number.isFinite(Number(payload.price)) || Number(payload.price) <= 0) {
    throw new HttpError(400, 'Harga paket harus lebih besar dari nol.');
  }
  const taxRate = Number(payload.tax_rate ?? 11);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    throw new HttpError(400, 'Tax rate harus berada di antara 0 dan 100.');
  }
  if (payload.is_active !== undefined && typeof payload.is_active !== 'boolean') {
    throw new HttpError(400, 'is_active harus berupa boolean.');
  }
}

function pick(source, fields) {
  const result = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
  }
  return result;
}

// Generate the next sequential identifier for the current month.
async function nextMonthlyNumber(table, column, prefix) {
  const filter = `${column}=like.${prefix}-*`;
  const rows = await supabaseRequest(`${table}?${queryString({
    select: column,
    [column]: `like.${prefix}-*`,
    order: `${column}.desc`,
    limit: '1'
  })}`);
  const lastValue = rows?.[0]?.[column];
  const lastSequence = lastValue ? Number(lastValue.split('-').pop()) : 0;
  if (!Number.isSafeInteger(lastSequence)) throw new HttpError(500, `Format ${column} di database tidak valid.`);
  return `${prefix}-${String(lastSequence + 1).padStart(4, '0')}`;
}

async function nextMemberCode() {
  const rows = await supabaseRequest('members?select=member_code&order=id.desc&limit=1');
  const lastCode = rows?.[0]?.member_code || '';
  const lastSequence = Number(lastCode.match(/^MBR-(\d+)$/)?.[1] || 0);
  return `MBR-${String(lastSequence + 1).padStart(4, '0')}`;
}

// Synchronize stored member status with whether a membership is valid today.
async function refreshMemberStatuses() {
  const [members, activeSales] = await Promise.all([
    supabaseRequest('members?select=id,status'),
    supabaseRequest(`sales?${queryString({
      select: 'member_id',
      end_date: `gte.${todayUtc()}`
    })}`)
  ]);
  const activeIds = new Set(activeSales.map((sale) => sale.member_id));
  const updates = members.filter((member) => member.status !== (activeIds.has(member.id) ? 'active' : 'inactive'));
  await Promise.all(updates.map((member) => supabaseRequest(`members?id=eq.${member.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: activeIds.has(member.id) ? 'active' : 'inactive' })
  })));
  return members.map((member) => ({ ...member, status: activeIds.has(member.id) ? 'active' : 'inactive' }));
}

// Return package by ID or raise a consistent not-found response.
async function getPackage(id) {
  const rows = await supabaseRequest(`packages?${queryString({ select: '*', id: `eq.${id}`, limit: '1' })}`);
  if (!rows.length) throw new HttpError(404, 'Paket tidak ditemukan.');
  return rows[0];
}

// Return member by ID or raise a consistent not-found response.
async function getMember(id) {
  const rows = await supabaseRequest(`members?${queryString({ select: '*', id: `eq.${id}`, limit: '1' })}`);
  if (!rows.length) throw new HttpError(404, 'Member tidak ditemukan.');
  return rows[0];
}

// Create a paid sale and its three-line automatic journal.
async function createSale(payload) {
  const memberId = requireId(payload.member_id);
  const packageId = requireId(payload.package_id);
  if (!isValidDate(payload.start_date)) throw new HttpError(400, 'start_date wajib berformat YYYY-MM-DD.');
  if (!['cash', 'transfer'].includes(payload.payment_method)) {
    throw new HttpError(400, 'payment_method hanya cash atau transfer.');
  }

  const [member, selectedPackage] = await Promise.all([getMember(memberId), getPackage(packageId)]);
  if (!selectedPackage.is_active) throw new HttpError(400, 'Paket sudah diarsipkan.');

  const pricePaid = roundMoney(Number(selectedPackage.price));
  const taxRate = Number(selectedPackage.tax_rate);
  const revenueAmount = roundMoney(pricePaid / (1 + taxRate / 100));
  const taxAmount = roundMoney(pricePaid - revenueAmount);
  const endDate = addDays(payload.start_date, Number(selectedPackage.duration_days));
  if (endDate < payload.start_date) throw new HttpError(400, 'end_date tidak boleh sebelum start_date.');
  if (Math.abs(pricePaid - revenueAmount - taxAmount) > 0.01) {
    throw new HttpError(400, 'Perhitungan debit dan kredit tidak seimbang.');
  }

  const monthPrefix = `SLS-${payload.start_date.slice(0, 4)}${payload.start_date.slice(5, 7)}`;
  const salesNo = await nextMonthlyNumber('sales', 'sales_no', monthPrefix);
  const insertedSales = await supabaseRequest('sales', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      sales_no: salesNo,
      member_id: memberId,
      package_id: packageId,
      start_date: payload.start_date,
      end_date: endDate,
      price_paid: pricePaid,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      revenue_amount: revenueAmount,
      payment_method: payload.payment_method,
      notes: typeof payload.notes === 'string' ? payload.notes : null
    })
  });
  const sale = insertedSales[0];

  try {
    const journalPrefix = `JV-${payload.start_date.slice(0, 4)}${payload.start_date.slice(5, 7)}`;
    const journalNo = await nextMonthlyNumber('journals', 'journal_no', journalPrefix);
    const journalDescription = `Penjualan paket ${selectedPackage.name} - ${member.name}`;
    const insertedJournals = await supabaseRequest('journals', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        journal_no: journalNo,
        journal_date: payload.start_date,
        description: journalDescription,
        reference_type: 'sale',
        reference_id: sale.id
      })
    });
    const journal = insertedJournals[0];
    const entries = [
      {
        journal_id: journal.id,
        ...ACCOUNTS.cash,
        debit: pricePaid,
        credit: 0,
        description: journalDescription
      },
      {
        journal_id: journal.id,
        ...ACCOUNTS.revenue,
        debit: 0,
        credit: revenueAmount,
        description: journalDescription
      },
      {
        journal_id: journal.id,
        ...ACCOUNTS.tax,
        debit: 0,
        credit: taxAmount,
        description: journalDescription
      }
    ];
    const totalDebit = entries.reduce((sum, entry) => sum + entry.debit, 0);
    const totalCredit = entries.reduce((sum, entry) => sum + entry.credit, 0);
    if (entries.length < 2 || Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new HttpError(400, 'Validasi jurnal gagal: total debit dan kredit berbeda.');
    }

    const createdEntries = await supabaseRequest('journal_entries', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(entries)
    });

    await supabaseRequest(`members?id=eq.${memberId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'active' })
    });
    return { ...sale, journal, journal_entries: createdEntries };
  } catch (error) {
    error.partialSaleId = sale.id;
    throw error;
  }
}

// Aggregate dashboard cards and the members whose memberships expire soon.
async function getDashboard() {
  const today = todayUtc();
  const sevenDays = addDays(today, 7);
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonthDate = new Date(`${monthStart}T00:00:00.000Z`);
  nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
  const monthEnd = nextMonthDate.toISOString().slice(0, 10);

  const [members, futureSales, monthSales, latestSales] = await Promise.all([
    refreshMemberStatuses(),
    supabaseRequest(`sales?${queryString({ select: 'member_id,end_date,members(id,member_code,name)', end_date: `gte.${today}` })}`),
    supabaseRequest(`sales?${queryString({ select: '*', start_date: `gte.${monthStart}`, and: `(start_date.lt.${monthEnd})` })}`),
    supabaseRequest(`sales?${queryString({ select: '*,members(id,member_code,name),packages(id,name)', order: 'created_at.desc', limit: '5' })}`)
  ]);

  const latestEndDateByMember = new Map();
  for (const sale of futureSales) {
    const previous = latestEndDateByMember.get(sale.member_id);
    if (!previous || sale.end_date > previous) latestEndDateByMember.set(sale.member_id, sale.end_date);
  }
  const membersById = new Map(members.map((member) => [member.id, member]));
  const expiringSoon = [...latestEndDateByMember.entries()]
    .filter(([, endDate]) => endDate <= sevenDays)
    .map(([memberId, endDate]) => ({ ...membersById.get(memberId), end_date: endDate }))
    .sort((left, right) => left.end_date.localeCompare(right.end_date));

  return {
    active_members: members.filter((member) => member.status === 'active').length,
    expiring_soon_count: expiringSoon.length,
    expiring_soon: expiringSoon,
    sales_this_month: monthSales.length,
    revenue_this_month: roundMoney(monthSales.reduce((sum, sale) => sum + Number(sale.revenue_amount), 0)),
    tax_this_month: roundMoney(monthSales.reduce((sum, sale) => sum + Number(sale.tax_amount), 0)),
    latest_sales: latestSales
  };
}

// Build revenue, tax, and payment-method totals for the selected period.
async function getRevenueReport(query) {
  if (query.start && !isValidDate(query.start)) throw new HttpError(400, 'Parameter start harus YYYY-MM-DD.');
  if (query.end && !isValidDate(query.end)) throw new HttpError(400, 'Parameter end harus YYYY-MM-DD.');
  if (query.start && query.end && query.start > query.end) throw new HttpError(400, 'start tidak boleh setelah end.');
  if (query.method && !['cash', 'transfer'].includes(query.method)) {
    throw new HttpError(400, 'Parameter method hanya cash atau transfer.');
  }

  const filters = { select: '*,members(id,member_code,name),packages(id,name)', order: 'start_date.asc,created_at.asc' };
  if (query.start) filters.start_date = `gte.${query.start}`;
  if (query.end) filters.and = `(start_date.lte.${query.end})`;
  if (query.method) filters.payment_method = `eq.${query.method}`;
  const sales = await supabaseRequest(`sales?${queryString(filters)}`);
  const byTaxRate = {};
  for (const sale of sales) {
    const rate = String(sale.tax_rate);
    byTaxRate[rate] ||= { tax_rate: Number(rate), taxable_revenue: 0, tax_amount: 0, gross_total: 0 };
    byTaxRate[rate].taxable_revenue += Number(sale.revenue_amount);
    byTaxRate[rate].tax_amount += Number(sale.tax_amount);
    byTaxRate[rate].gross_total += Number(sale.price_paid);
  }
  for (const group of Object.values(byTaxRate)) {
    group.taxable_revenue = roundMoney(group.taxable_revenue);
    group.tax_amount = roundMoney(group.tax_amount);
    group.gross_total = roundMoney(group.gross_total);
  }
  return {
    period: { start: query.start || null, end: query.end || null, method: query.method || null },
    totals: {
      sales_count: sales.length,
      gross_total: roundMoney(sales.reduce((sum, sale) => sum + Number(sale.price_paid), 0)),
      revenue_amount: roundMoney(sales.reduce((sum, sale) => sum + Number(sale.revenue_amount), 0)),
      tax_amount: roundMoney(sales.reduce((sum, sale) => sum + Number(sale.tax_amount), 0))
    },
    tax_breakdown: Object.values(byTaxRate),
    sales
  };
}

// Route API requests to their handlers.
async function handleApi(req, res, parsedUrl) {
  const pathname = decodeURIComponent(parsedUrl.pathname.replace(/\/$/, '') || '/');
  const method = req.method;
  const query = parsedUrl.query;
  let match;

  if (method === 'GET' && pathname === '/api/members') {
    const members = await refreshMemberStatuses();
    const search = String(query.search || '').trim().toLowerCase();
    return sendJson(res, 200, search ? members.filter((member) =>
      `${member.member_code} ${member.name} ${member.email || ''} ${member.phone || ''}`.toLowerCase().includes(search)
    ) : members);
  }
  if (method === 'POST' && pathname === '/api/members') {
    const payload = await readBody(req);
    validateMember(payload);
    const member = {
      member_code: await nextMemberCode(),
      name: payload.name.trim(),
      email: payload.email || null,
      phone: payload.phone || null,
      join_date: payload.join_date || todayUtc(),
      status: payload.status || 'inactive'
    };
    const created = await supabaseRequest('members', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(member)
    });
    return sendJson(res, 201, created[0]);
  }
  if ((match = pathname.match(/^\/api\/members\/(\d+)\/sales$/)) && method === 'GET') {
    const id = requireId(match[1]);
    await getMember(id);
    const sales = await supabaseRequest(`sales?${queryString({
      select: '*,packages(id,name)', member_id: `eq.${id}`, order: 'start_date.desc,created_at.desc'
    })}`);
    return sendJson(res, 200, sales);
  }
  if ((match = pathname.match(/^\/api\/members\/(\d+)$/))) {
    const id = requireId(match[1]);
    if (method === 'GET') return sendJson(res, 200, await getMember(id));
    if (method === 'PUT') {
      const payload = await readBody(req);
      const current = await getMember(id);
      const update = pick(payload, ['name', 'email', 'phone', 'join_date', 'status']);
      validateMember({ ...current, ...update });
      update.name = update.name?.trim();
      const rows = await supabaseRequest(`members?id=eq.${id}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(update)
      });
      return sendJson(res, 200, rows[0]);
    }
    if (method === 'DELETE') {
      const [activeSales, allSales] = await Promise.all([
        supabaseRequest(`sales?${queryString({ select: 'id', member_id: `eq.${id}`, end_date: `gte.${todayUtc()}`, limit: '1' })}`),
        supabaseRequest(`sales?${queryString({ select: 'id', member_id: `eq.${id}`, limit: '1' })}`)
      ]);
      if (activeSales.length) throw new HttpError(409, 'Member masih memiliki membership aktif.');
      if (allSales.length) throw new HttpError(409, 'Member memiliki riwayat sales dan tidak dapat dihapus demi menjaga audit trail.');
      await supabaseRequest(`members?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return sendJson(res, 200, { message: 'Member berhasil dihapus.' });
    }
  }

  if (method === 'GET' && pathname === '/api/packages') {
    const filters = { select: '*', order: 'duration_days.asc' };
    if (query.active === 'true') filters.is_active = 'eq.true';
    if (query.active === 'false') filters.is_active = 'eq.false';
    return sendJson(res, 200, await supabaseRequest(`packages?${queryString(filters)}`));
  }
  if (method === 'POST' && pathname === '/api/packages') {
    const payload = await readBody(req);
    validatePackage(payload);
    const created = await supabaseRequest('packages', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
        name: payload.name.trim(),
        duration_months: Number(payload.duration_months),
        duration_days: Number(payload.duration_days),
        price: roundMoney(Number(payload.price)),
        tax_rate: Number(payload.tax_rate ?? 11),
        is_active: payload.is_active ?? true
      })
    });
    return sendJson(res, 201, created[0]);
  }
  if ((match = pathname.match(/^\/api\/packages\/(\d+)$/))) {
    const id = requireId(match[1]);
    if (method === 'GET') return sendJson(res, 200, await getPackage(id));
    if (method === 'PUT') {
      const payload = await readBody(req);
      const current = await getPackage(id);
      const update = { ...current, ...pick(payload, [
        'name', 'duration_months', 'duration_days', 'price', 'tax_rate', 'is_active'
      ]) };
      validatePackage(update);
      const rows = await supabaseRequest(`packages?id=eq.${id}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
          name: update.name.trim(),
          duration_months: Number(update.duration_months),
          duration_days: Number(update.duration_days),
          price: roundMoney(Number(update.price)),
          tax_rate: Number(update.tax_rate),
          is_active: update.is_active
        })
      });
      return sendJson(res, 200, rows[0]);
    }
  }
  if ((match = pathname.match(/^\/api\/packages\/(\d+)\/(archive|activate)$/)) && method === 'PATCH') {
    const id = requireId(match[1]);
    const isActive = match[2] === 'activate';
    const rows = await supabaseRequest(`packages?id=eq.${id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ is_active: isActive })
    });
    if (!rows.length) throw new HttpError(404, 'Paket tidak ditemukan.');
    return sendJson(res, 200, rows[0]);
  }

  if (method === 'GET' && pathname === '/api/sales') {
    const filters = { select: '*,members(id,member_code,name),packages(id,name)', order: 'start_date.desc,created_at.desc' };
    if (query.start && !isValidDate(query.start)) throw new HttpError(400, 'Parameter start harus YYYY-MM-DD.');
    if (query.end && !isValidDate(query.end)) throw new HttpError(400, 'Parameter end harus YYYY-MM-DD.');
    if (query.start) filters.start_date = `gte.${query.start}`;
    if (query.end) filters.and = `(start_date.lte.${query.end})`;
    if (query.member_id) filters.member_id = `eq.${requireId(query.member_id)}`;
    if (query.method) {
      if (!['cash', 'transfer'].includes(query.method)) throw new HttpError(400, 'method hanya cash atau transfer.');
      filters.payment_method = `eq.${query.method}`;
    }
    return sendJson(res, 200, await supabaseRequest(`sales?${queryString(filters)}`));
  }
  if (method === 'POST' && pathname === '/api/sales') {
    const payload = await readBody(req);
    const result = await createSale(payload);
    return sendJson(res, 201, result);
  }
  if ((match = pathname.match(/^\/api\/sales\/(\d+)$/))) {
    const id = requireId(match[1]);
    if (method === 'GET') {
      const rows = await supabaseRequest(`sales?${queryString({
        select: '*,members(id,member_code,name),packages(id,name),journals(id,journal_no,journal_date)',
        id: `eq.${id}`, limit: '1'
      })}`);
      if (!rows.length) throw new HttpError(404, 'Transaksi tidak ditemukan.');
      return sendJson(res, 200, rows[0]);
    }
    if (method === 'PUT' || method === 'PATCH') {
      const payload = await readBody(req);
      const rows = await supabaseRequest(`sales?id=eq.${id}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ notes: typeof payload.notes === 'string' ? payload.notes : null })
      });
      if (!rows.length) throw new HttpError(404, 'Transaksi tidak ditemukan.');
      return sendJson(res, 200, rows[0]);
    }
    if (method === 'DELETE') {
      const journals = await supabaseRequest(`journals?${queryString({ select: 'id', reference_id: `eq.${id}`, limit: '1' })}`);
      if (journals.length) throw new HttpError(409, 'Sales tidak dapat dihapus karena memiliki jurnal audit.');
      await supabaseRequest(`sales?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return sendJson(res, 200, { message: 'Transaksi berhasil dihapus.' });
    }
  }

  if (method === 'GET' && pathname === '/api/journals') {
    if (query.start && !isValidDate(query.start)) throw new HttpError(400, 'Parameter start harus YYYY-MM-DD.');
    if (query.end && !isValidDate(query.end)) throw new HttpError(400, 'Parameter end harus YYYY-MM-DD.');
    const filters = { select: '*,sales(sales_no,member_id,package_id,price_paid)', order: 'journal_date.desc,created_at.desc' };
    if (query.start) filters.journal_date = `gte.${query.start}`;
    if (query.end) filters.and = `(journal_date.lte.${query.end})`;
    return sendJson(res, 200, await supabaseRequest(`journals?${queryString(filters)}`));
  }
  if ((match = pathname.match(/^\/api\/journals\/(\d+)$/)) && method === 'GET') {
    const id = requireId(match[1]);
    const rows = await supabaseRequest(`journals?${queryString({
      select: '*,journal_entries(*),sales(sales_no,member_id,package_id,price_paid,tax_amount,revenue_amount)',
      id: `eq.${id}`, limit: '1'
    })}`);
    if (!rows.length) throw new HttpError(404, 'Jurnal tidak ditemukan.');
    return sendJson(res, 200, rows[0]);
  }
  if (method === 'GET' && pathname === '/api/reports/revenue') {
    return sendJson(res, 200, await getRevenueReport(query));
  }
  if (method === 'GET' && pathname === '/api/dashboard') {
    return sendJson(res, 200, await getDashboard());
  }

  throw new HttpError(404, 'Endpoint tidak ditemukan.');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    const parsedUrl = url.parse(req.url, true);
    if (!parsedUrl.pathname.startsWith('/api/')) throw new HttpError(404, 'Endpoint tidak ditemukan.');
    await handleApi(req, res, parsedUrl);
  } catch (error) {
    if (res.headersSent) return res.end();
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(res, status, {
      error: error.message || 'Terjadi kesalahan pada server.',
      ...(error.details ? { details: error.details } : {}),
      ...(error.partialSaleId ? {
        partial_sale_id: error.partialSaleId,
        warning: 'Sales sudah tercatat, tetapi pembuatan jurnal gagal. Periksa data sebelum mencoba ulang.'
      } : {})
    });
  }
});

server.listen(PORT, () => {
  console.log(`Healthy Yoga API berjalan di http://localhost:${PORT}`);
  if (SUPABASE_URL.includes('xxxxx') || SUPABASE_KEY.includes('...')) {
    console.warn('Isi SUPABASE_URL dan SUPABASE_KEY di app.js sebelum menjalankan request API.');
  }
});
