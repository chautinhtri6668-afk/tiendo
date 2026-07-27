const CONFIG = {
  // Dán URL Web App Apps Script sau khi deploy để lấy dữ liệu live.
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycby1EbI_tkRBtKM8VxpkcGeKo1rnehJrlBPBIxH_BYl_U3KWJDWCiQLgQeZjs-jB-xZP5w/exec',
  fallbackCsv: './sheet.csv',
  contactsSpreadsheetId: '1Xd88BoxLjjv7oY05yQEz-8NcPJCC0iUe',
  contactSheets: ['TTVT8', '18 Trung tâm Viễn Thông', 'Lãnh đạo P.HT', 'Danh bạ P.HT', 'DB mới 1-10', 'VNPT địa bàn'],
  contactsCsvUrl: 'https://docs.google.com/spreadsheets/d/1Xd88BoxLjjv7oY05yQEz-8NcPJCC0iUe/export?format=csv&gid=1904024602',
  contactsFallbackCsv: './contacts.csv',
  pageSize: 18,
  autoRefreshMs: 60000,
  // Nhap dd/MM cho ngay le lap lai hang nam, dd/MM/yyyy cho ngay le rieng tung nam.
  holidays: [
    '01/01',
    '16/02/2026', '17/02/2026', '18/02/2026', '19/02/2026', '20/02/2026',
    '26/04/2026', '27/04/2026',
    '30/04',
    '01/05',
    '01/09/2026', '02/09'
  ]
};

const state = { all: [], filtered: [], contacts: [], contactFiltered: [], page: 1, contactSheet: CONFIG.contactSheets[0], sortMode: 'assigned-desc' };
const $ = (id) => document.getElementById(id);

function parseCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && quoted && n === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell); if (row.some(v => v.trim())) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function normalizeRows(rows) {
  return rows.slice(1).filter(r => r.slice(0, 8).some(Boolean)).map((r, index) => ({
    id: index + 1, assigned: r[0]?.trim() || '', transaction: normalizeTransaction(r[1], r[2]),
    subscriber: r[2]?.trim() || '', service: r[3]?.trim() || '', employee: r[4]?.trim() || 'Chưa phân công',
    status: r[5]?.trim() || 'Chưa cập nhật', completed: r[6]?.trim() || '', issue: r[7]?.trim() || '', note: r[8]?.trim() || ''
  }));
}

function normalizeTransaction(transaction, subscriber) {
  const text = String(transaction ?? '').trim();
  if (!text || String(subscriber ?? '').trim()) return text;
  if (text.startsWith('000')) return text;
  return /^\d{1,7}$/.test(text) ? text.padStart(text.length + 3, '0') : text;
}

function isSurveyInstall(item) {
  return Boolean(item?.transaction && !String(item?.subscriber || '').trim());
}

function normalizeContactRows(rows) {
  let center = '';
  return rows.slice(1).map((r, index) => {
    if (r[0]?.trim()) center = r[0].trim();
    const raw = r.map(v => (v || '').replace(/\s+/g, ' ').trim());
    const emailIndex = raw.findIndex(v => /@/.test(v));
    const phoneIndex = raw.findIndex((v, i) => i > 1 && /(?:\+?84|0)?\d[\d\s.]{6,}/.test(v));
    const titleIndex = raw.findIndex(v => /^(GĐ|PGĐ|GD|PGD)$/i.test(v));
    const name = raw[2] || '';
    const team = raw[1] || '';
    const email = emailIndex >= 0 ? raw[emailIndex].replace(/[<>]/g, '') : '';
    const phone = phoneIndex >= 0 ? raw[phoneIndex] : '';
    const title = titleIndex >= 0 ? raw[titleIndex] : '';
    const birthday = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw[3]) ? raw[3] : '';
    const note = raw.slice(3).filter((v, i) => {
      const absoluteIndex = i + 3;
      return v && absoluteIndex !== emailIndex && absoluteIndex !== phoneIndex && absoluteIndex !== titleIndex && v !== birthday;
    }).join(' ');
    return { id: index + 1, center, team, name, birthday, email, phone, title, note };
  }).filter(x => x.center && (x.name || x.team || x.email || x.phone));
}

async function loadData(showMessage = false) {
  $('refreshBtn').disabled = true;
  try {
    if (CONFIG.appsScriptUrl) {
      const res = await fetch(appsScriptEndpoint({ action: 'progress', ts: Date.now() }), { cache: 'no-store' });
      if (!res.ok) throw new Error('Không thể kết nối Apps Script');
      const json = await res.json();
      state.all = (Array.isArray(json) ? json : json.data).map(x => ({ ...x, transaction: normalizeTransaction(x.transaction, x.subscriber), status: x.status?.trim() || 'Chưa cập nhật', note: x.note || '' }));
      $('sourceLabel').textContent = `Đồng bộ Google Sheet - ${state.all.length.toLocaleString('vi-VN')} phiếu`;
    } else {
      const res = await fetch(CONFIG.fallbackCsv, { cache: 'no-store' });
      if (!res.ok) throw new Error('Không tìm thấy sheet.csv');
      state.all = normalizeRows(parseCSV(await res.text()));
      $('sourceLabel').textContent = 'Bản dữ liệu Google Sheet gần nhất';
    }
    populateFilters(); applyFilters();
    if (showMessage) toast('Đã làm mới dữ liệu');
  } catch (err) {
    $('sourceLabel').textContent = 'Không thể tải dữ liệu';
    $('workTable').innerHTML = `<tr><td colspan="11" class="empty">${escapeHtml(err.message)}. Hãy chạy site qua web server.</td></tr>`;
    toast(err.message);
  } finally { $('refreshBtn').disabled = false; }
}

async function fetchCsvWithFallback(url, fallbackUrl) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Không tải được Google Sheet');
    return { text: await res.text(), live: true };
  } catch (err) {
    const res = await fetch(fallbackUrl, { cache: 'no-store' });
    if (!res.ok) throw err;
    return { text: await res.text(), live: false };
  }
}

function appsScriptEndpoint(params) {
  const url = new URL(CONFIG.appsScriptUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

async function fetchContactsFromAppsScript(sheetName) {
  const res = await fetch(appsScriptEndpoint({ action: 'contacts', sheet: sheetName }), { cache: 'no-store' });
  if (!res.ok) throw new Error('Không kết nối được Apps Script danh bạ');
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  if (json.sheet !== sheetName) throw new Error('Apps Script chưa cập nhật API danh bạ');
  return Array.isArray(json.data) ? json.data : [];
}

async function loadContacts() {
  try {
    populateContactSheets();
    if (CONFIG.appsScriptUrl) {
      try {
        state.contacts = await fetchContactsFromAppsScript(state.contactSheet);
        $('contactSourceLabel').textContent = `Đọc qua Apps Script: ${state.contactSheet}`;
      } catch (scriptErr) {
        const { text } = await fetchCsvWithFallback(CONFIG.contactsCsvUrl, CONFIG.contactsFallbackCsv);
        state.contacts = normalizeContactRows(parseCSV(text));
        $('contactSourceLabel').textContent = `${scriptErr.message}; đang dùng contacts.csv`;
      }
    } else {
      const { text, live } = await fetchCsvWithFallback(CONFIG.contactsCsvUrl, CONFIG.contactsFallbackCsv);
      state.contacts = normalizeContactRows(parseCSV(text));
      $('contactSourceLabel').textContent = live ? `Đọc trực tiếp từ Google Sheet HNI: ${state.contactSheet}` : 'Bản danh bạ HNI gần nhất';
    }
    populateContactCenters(); applyContactFilters();
  } catch (err) {
    $('contactSourceLabel').textContent = 'Không thể tải danh bạ HNI';
    $('contactsTable').innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(err.message)}</td></tr>`;
  }
}

function unique(key) { return [...new Set(state.all.map(x => x[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'vi')); }
function fillSelect(id, values) {
  const select = $(id), current = select.value, first = select.options[0].outerHTML;
  select.innerHTML = first + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  select.value = current;
}
function populateFilters() {
  fillSelect('employeeFilter', unique('employee'));
  const statusSelect = $('statusFilter'), currentStatus = statusSelect.value;
  statusSelect.innerHTML = '<option value="">Tất cả trạng thái</option><option value="Đã hoàn công">Đã hoàn thành</option><option value="Đang xử lý">Đang xử lý</option><option value="Chưa cập nhật">Chưa cập nhật</option>';
  statusSelect.value = currentStatus;
  fillSelect('serviceFilter', unique('service'));
}
function populateContactCenters() {
  const centers = [...new Set(state.contacts.map(x => x.center).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'vi'));
  const select = $('contactCenterFilter'), current = select.value;
  select.innerHTML = '<option value="">Tất cả trung tâm</option>' + centers.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  select.value = current;
}
function populateContactSheets() {
  const select = $('contactSheetFilter'), current = select.value || state.contactSheet;
  select.innerHTML = CONFIG.contactSheets.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  select.value = CONFIG.contactSheets.includes(current) ? current : CONFIG.contactSheets[0];
  state.contactSheet = select.value;
}
function isDone(x) { return /đã hoàn công|hoàn thành|completed/i.test(x.status); }
function isLocked(x) { return isDone(x) && Boolean(x.completed); }
function hasIssue(x) { return Boolean(x.issue && !/^(không|ko|không có)$/i.test(x.issue)); }

function compactText(value) {
  return String(value ?? '').toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim();
}
function compactDate(value) {
  const match = String(value || '').match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
  if (!match) return '';
  const day = match[1].padStart(2, '0'), month = match[2].padStart(2, '0');
  const year = match[3] ? (match[3].length === 2 ? `20${match[3]}` : match[3]) : '';
  return `${day}${month}${year}`;
}
function compactCode(value) {
  return String(value ?? '').toLocaleLowerCase('vi').replace(/[^a-z0-9]/gi, '');
}
function compactDateDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (![4, 8].includes(digits.length)) return '';
  const day = Number(digits.slice(0, 2)), month = Number(digits.slice(2, 4));
  if (day < 1 || day > 31 || month < 1 || month > 12) return '';
  return digits;
}
function itemSearchText(item) {
  return Object.values(item).map(compactText).join(' ');
}
function itemSearchCode(item) {
  return Object.values(item).map(compactCode).join(' ');
}
function matchesSearch(item, query) {
  const normalized = compactText(query);
  const compactQuery = compactDate(normalized) || compactDateDigits(normalized);
  const looksLikeDate = Boolean(compactQuery);
  if (looksLikeDate) {
    const assignedText = compactText(item.assigned);
    const assignedCompact = compactDate(item.assigned);
    return assignedText.includes(normalized) || assignedCompact.includes(compactQuery);
  }
  const codeQuery = compactCode(normalized);
  return itemSearchText(item).includes(normalized) || (codeQuery.length >= 3 && itemSearchCode(item).includes(codeQuery));
}

function matchesSlaFilter(item, filter) {
  if (!filter) return true;
  const className = slaInfo(item).className;
  if (filter === 'overdue') return className === 'overdue';
  if (filter === 'in-date') return className !== 'overdue' && className !== 'unknown';
  return true;
}

function applyFilters() {
  const q = $('searchInput').value.trim();
  const employee = $('employeeFilter').value, status = $('statusFilter').value, service = $('serviceFilter').value, sla = $('slaFilter').value;
  state.filtered = state.all.filter(x => (!employee || x.employee === employee) && (!status || x.status === status) && (!service || x.service === service) && matchesSlaFilter(x, sla) && (!q || matchesSearch(x, q)));
  sortFiltered();
  state.page = 1; render();
}

function sortFiltered() {
  const direction = state.sortMode === 'assigned-asc' ? 1 : -1;
  state.filtered.sort((a, b) => {
    const timeA = parseVnDate(a.assigned)?.getTime() || 0;
    const timeB = parseVnDate(b.assigned)?.getTime() || 0;
    return (timeA - timeB) * direction || (Number(a.id) - Number(b.id)) * direction;
  });
}

function render() { renderMetrics(); renderStatus(); renderTeam(); renderTable(); }
function renderMetrics() {
  const total = state.filtered.length, done = state.filtered.filter(isDone).length, issues = state.filtered.filter(hasIssue).length, working = total - done;
  const rate = total ? Math.round(done / total * 100) : 0;
  $('totalMetric').textContent = total.toLocaleString('vi-VN'); $('doneMetric').textContent = done.toLocaleString('vi-VN');
  $('workingMetric').textContent = working.toLocaleString('vi-VN'); $('issueMetric').textContent = issues.toLocaleString('vi-VN');
  $('donePercent').textContent = `${rate}% tổng công việc`; $('heroRate').textContent = `${rate}%`;
  $('filteredNote').textContent = total === state.all.length ? 'Trong dữ liệu hiện tại' : `Đã lọc từ ${state.all.length.toLocaleString('vi-VN')} việc`;
}
function renderStatus() {
  const counts = {}; state.filtered.forEach(x => { const label = statusLabel(x.status); counts[label] = (counts[label] || 0) + 1; });
  const max = Math.max(...Object.values(counts), 1);
  $('statusBars').innerHTML = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,count]) => `<div class="status-row"><div class="status-row-head"><span>${escapeHtml(name)}</span><b>${count.toLocaleString('vi-VN')}</b></div><div class="track"><div class="fill" style="width:${count/max*100}%"></div></div></div>`).join('') || '<div class="empty">Không có dữ liệu</div>';
}
function initials(name) { return name.split(/\s+/).slice(-2).map(w=>w[0]).join('').toUpperCase(); }
function renderTeam() {
  const people = {}; state.filtered.forEach(x => { const p = people[x.employee] ||= { total:0, done:0 }; p.total++; if (isDone(x)) p.done++; });
  const sorted = Object.entries(people).sort((a,b) => {
    const rateA = a[1].done / a[1].total, rateB = b[1].done / b[1].total;
    return rateB - rateA || b[1].done - a[1].done || b[1].total - a[1].total;
  });
  $('teamCount').textContent = `${sorted.length} nhân viên`;
  $('teamList').innerHTML = sorted.map(([name,p]) => { const rate = Math.round(p.done/p.total*100); return `<div class="team-row"><div class="avatar">${escapeHtml(initials(name))}</div><div class="person"><b>${escapeHtml(name)}</b><small>${p.done}/${p.total} công việc hoàn thành</small></div><div class="person-score"><b>${rate}%</b><small>TIẾN ĐỘ</small></div></div>`; }).join('') || '<div class="empty">Không có dữ liệu</div>';
}
function statusLabel(status) { return status?.trim() || 'Chưa cập nhật'; }
function badgeClass(status) { return isDone({status}) ? 'done' : /đang xử lý/i.test(status || '') ? 'working' : 'pending'; }
function parseVnDate(value) {
  const match = String(value || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) return null;
  const [, day, month, year, hour = '0', minute = '0', second = '0'] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isNaN(date.getTime()) ? null : date;
}
function slaHours(item) { return isSurveyInstall(item) || /fiber/i.test(item?.service || '') ? 24 : 48; }
function dateKey(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return { annual: `${day}/${month}`, exact: `${day}/${month}/${date.getFullYear()}` };
}
function isHoliday(date) {
  const keys = dateKey(date);
  return CONFIG.holidays.includes(keys.annual) || CONFIG.holidays.includes(keys.exact);
}
function isNonWorkingDay(date) {
  const day = date.getDay();
  return day === 0 || day === 6 || isHoliday(date);
}
function moveToNextDay(date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next;
}
function startOfNextDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}
function nextWorkingMoment(date) {
  let cursor = new Date(date);
  let guard = 0;
  while (isNonWorkingDay(cursor) && guard < 370) {
    cursor = moveToNextDay(cursor);
    guard++;
  }
  return cursor;
}
function addWorkingHours(start, hours) {
  let cursor = nextWorkingMoment(start);
  let remaining = hours * 60 * 60 * 1000;
  let guard = 0;
  while (remaining > 0 && guard < 1000) {
    if (isNonWorkingDay(cursor)) {
      cursor = nextWorkingMoment(cursor);
      guard++;
      continue;
    }
    const boundary = startOfNextDay(cursor);
    const available = boundary.getTime() - cursor.getTime();
    if (remaining <= available) return new Date(cursor.getTime() + remaining);
    remaining -= available;
    cursor = nextWorkingMoment(boundary);
    guard++;
  }
  return cursor;
}
function workingMsBetween(from, to) {
  const start = from.getTime() <= to.getTime() ? from : to;
  const end = from.getTime() <= to.getTime() ? to : from;
  let cursor = nextWorkingMoment(start), total = 0, guard = 0;
  while (cursor.getTime() < end.getTime() && guard < 1000) {
    if (isNonWorkingDay(cursor)) {
      cursor = nextWorkingMoment(cursor);
      guard++;
      continue;
    }
    const boundary = startOfNextDay(cursor);
    const segmentEnd = Math.min(boundary.getTime(), end.getTime());
    total += Math.max(0, segmentEnd - cursor.getTime());
    cursor = nextWorkingMoment(new Date(segmentEnd));
    guard++;
  }
  return from.getTime() <= to.getTime() ? total : -total;
}
function formatDeadline(date) {
  return new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(date);
}
function formatTableDate(value) {
  const text = escapeHtml(value || '');
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/\d{4}(?:\s+(\d{1,2}):(\d{1,2}))?/);
  return match ? `<span class="date-stack"><b>${match[1]}/${match[2]}</b><small>${match[3] ? `${match[3]}:${match[4]}` : ''}</small></span>` : text || '—';
}
function formatDuration(ms) {
  const totalMinutes = Math.max(1, Math.ceil(Math.abs(ms) / 60000));
  const days = Math.floor(totalMinutes / 1440), hours = Math.floor((totalMinutes % 1440) / 60), minutes = totalMinutes % 60;
  if (days) return `${days} ngày ${hours} giờ`;
  if (hours) return `${hours} giờ ${minutes} phút`;
  return `${minutes} phút`;
}
function slaInfo(item) {
  const assignedAt = parseVnDate(item.assigned);
  if (!assignedAt) return { className: 'unknown', label: 'Chưa có giờ giao', shortLabel: 'N/A', meta: 'Không tính được hạn xử lý' };
  const hours = slaHours(item);
  const deadline = addWorkingHours(assignedAt, hours);
  const completedAt = parseVnDate(item.completed);
  const checkAt = isDone(item) && completedAt ? completedAt : new Date();
  const remaining = workingMsBetween(checkAt, deadline);
  const meta = `Hạn ${formatDeadline(deadline)} (${hours}h, không tính T7/CN/ngày lễ)`;
  if (isDone(item)) return remaining >= 0
    ? { className: 'done', label: 'Hoàn công đúng hạn', shortLabel: 'Đúng hạn', meta }
    : { className: 'overdue', label: `Hoàn công trễ ${formatDuration(remaining)}`, shortLabel: `Trễ ${shortDuration(remaining)}`, meta };
  if (remaining < 0) return { className: 'overdue', label: `Quá hạn ${formatDuration(remaining)}`, shortLabel: `Quá ${shortDuration(remaining)}`, meta };
  if (remaining <= 6 * 60 * 60 * 1000) return { className: 'urgent', label: `Sắp hết hạn ${formatDuration(remaining)}`, shortLabel: `Còn ${shortDuration(remaining)}`, meta };
  if (remaining <= 12 * 60 * 60 * 1000) return { className: 'warn', label: `Còn ${formatDuration(remaining)}`, shortLabel: `Còn ${shortDuration(remaining)}`, meta };
  return { className: 'ok', label: `Còn ${formatDuration(remaining)}`, shortLabel: `Còn ${shortDuration(remaining)}`, meta };
}
function shortDuration(ms) {
  const totalMinutes = Math.max(1, Math.ceil(Math.abs(ms) / 60000));
  const days = Math.floor(totalMinutes / 1440), hours = Math.floor((totalMinutes % 1440) / 60), minutes = totalMinutes % 60;
  if (days) return `${days}d${hours ? hours + 'h' : ''}`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}
function renderTable() {
  const pages = Math.max(1, Math.ceil(state.filtered.length / CONFIG.pageSize)); if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * CONFIG.pageSize, data = state.filtered.slice(start, start + CONFIG.pageSize);
  $('resultCount').textContent = `${state.filtered.length.toLocaleString('vi-VN')} kết quả`;
  $('workTable').innerHTML = data.map(x => {
    const sla = slaInfo(x);
    const tooltip = `${sla.label} | ${sla.meta}`;
    const serviceLabel = isSurveyInstall(x) ? 'Khảo sát' : x.service;
    return `<tr data-id="${x.id}" class="${isLocked(x)?'locked-row':''}"><td class="date-cell">${formatTableDate(x.assigned)}</td><td class="transaction-cell">${escapeHtml(x.transaction)}</td><td>${escapeHtml(x.subscriber) || '—'}</td><td>${escapeHtml(serviceLabel)}</td><td><span class="sla-chip ${sla.className}" data-tooltip="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}">${escapeHtml(sla.shortLabel)}</span></td><td class="employee-cell">${escapeHtml(x.employee)}</td><td><span class="badge status-view ${badgeClass(x.status)}">${escapeHtml(statusLabel(x.status))}</span><select class="edit-field row-status edit-control"><option value="Chưa cập nhật" ${x.status==='Chưa cập nhật'||!x.status?'selected':''}>Chưa cập nhật</option><option value="Đang xử lý" ${x.status==='Đang xử lý'?'selected':''}>Đang xử lý</option><option value="Đã hoàn công" ${isDone(x)?'selected':''}>Đã hoàn công</option></select></td><td class="completed-cell date-cell">${formatTableDate(x.completed)}</td><td class="issue-cell" data-full="${escapeHtml(x.issue || 'Không có vướng mắc')}"><div class="cell-view hover-full multiline" title="${escapeHtml(x.issue || 'Không có vướng mắc')}">${escapeHtml(x.issue) || '—'}</div><textarea class="edit-field row-issue edit-control" placeholder="Nội dung vướng mắc">${escapeHtml(x.issue)}</textarea></td><td class="note-cell"><div class="cell-view note-view multiline" title="${escapeHtml(x.note || 'Không có ghi chú')}">${escapeHtml(x.note || '') || '—'}</div><textarea class="edit-field row-note edit-control" placeholder="Đầu mối kỹ thuật, thi công...">${escapeHtml(x.note || '')}</textarea></td><td class="action-cell">${isLocked(x)?'<span class="lock-icon" title="Phiếu đã hoàn công">✓</span>':`<button class="icon-btn edit-btn" onclick="editRow(${x.id}, this)" title="Sửa phiếu" aria-label="Sửa phiếu">✎</button><button class="icon-btn save-btn edit-control" onclick="saveRow(${x.id}, this)" title="Lưu phiếu" aria-label="Lưu phiếu">✓</button>`}</td></tr>`;
  }).join('') || '<tr><td colspan="11" class="empty">Không tìm thấy công việc phù hợp</td></tr>';
  $('pageLabel').textContent = `Trang ${state.page} / ${pages}`; $('prevPage').disabled = state.page <= 1; $('nextPage').disabled = state.page >= pages;
}
function applyContactFilters() {
  const q = $('contactSearchInput').value.trim().toLocaleLowerCase('vi');
  const center = $('contactCenterFilter').value;
  state.contactFiltered = state.contacts.filter(x => (!center || x.center === center) && (!q || [x.center, x.team, x.name, x.email, x.phone, x.title, x.note].some(v => String(v).toLocaleLowerCase('vi').includes(q))));
  renderContacts();
}
function renderContacts() {
  $('contactCount').textContent = `${state.contactFiltered.length.toLocaleString('vi-VN')} đầu mối`;
  $('contactsTable').innerHTML = state.contactFiltered.map(x => `<tr><td>${escapeHtml(x.center)}</td><td>${escapeHtml(x.team) || '—'}</td><td><b>${escapeHtml(x.name) || '—'}</b>${x.title ? `<small>${escapeHtml(x.title)}</small>` : ''}</td><td>${escapeHtml(x.phone) || '—'}</td><td>${x.email ? `<a href="mailto:${escapeHtml(x.email)}">${escapeHtml(x.email)}</a>` : '—'}</td><td>${escapeHtml(x.birthday) || '—'}</td><td><div class="cell-view expandable" onclick="toggleCell(this)" title="Bấm để xem đầy đủ">${escapeHtml(x.note) || '—'}</div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Không tìm thấy đầu mối phù hợp</td></tr>';
}
function exportCSV() {
  const headers = ['Ngày giao','Mã giao dịch','Mã thuê bao','Dịch vụ','Cảnh báo','Hạn xử lý','Người thực hiện','Trạng thái','Ngày hoàn công','Nội dung vướng mắc','Ghi chú'];
  const csvRows = state.filtered.map(x => {
    const sla = slaInfo(x);
    return [x.assigned, x.transaction, x.subscriber, isSurveyInstall(x) ? 'Khảo sát' : x.service, sla.label, sla.meta, x.employee, x.status, x.completed, x.issue, x.note];
  });
  const csv = '\ufeff' + [headers, ...csvRows].map(r=>r.map(v=>`"${String(v||'').replaceAll('"','""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download = `tien-do-kenh-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(a.href); toast('Đã xuất dữ liệu đang lọc');
}
function escapeHtml(v) { return String(v ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(msg) { $('toast').textContent = msg; $('toast').classList.add('show'); setTimeout(()=>$('toast').classList.remove('show'),2200); }

async function saveRow(id, button) {
  if (!CONFIG.appsScriptUrl) return toast('Chưa cấu hình Apps Script');
  const tr = button.closest('tr'), item = state.all.find(x => Number(x.id) === Number(id));
  const payload = { action:'update', id:Number(id), transaction:item?.transaction || '', status:tr.querySelector('.row-status').value, issue:tr.querySelector('.row-issue').value.trim(), note:tr.querySelector('.row-note').value.trim() };
  button.disabled = true; button.textContent = 'Đang lưu...';
  try {
    const res = await fetch(CONFIG.appsScriptUrl, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Không thể cập nhật phiếu');
    Object.assign(item, json.data);
    if (json.data.status === 'Đã hoàn công' && !item.completed) item.completed = formatNow();
    render(); toast('Đã cập nhật phiếu ' + item.transaction);
  } catch (err) {
    toast(err.message);
    if (String(err.message || '').includes('Dữ liệu đã thay đổi')) loadData(false);
  }
  finally { button.disabled = false; button.textContent = '✓'; }
}

function editRow(id, button) {
  const tr = button.closest('tr');
  tr.classList.add('editing');
  tr.querySelector('.row-status').focus();
}

function toggleCell(element) {
  element.classList.toggle('expanded');
}

function formatNow() {
  const parts = new Intl.DateTimeFormat('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function startAutoRefresh() {
  if (!CONFIG.autoRefreshMs) return;
  setInterval(() => {
    if (document.querySelector('tr.editing')) return;
    loadData(false);
  }, CONFIG.autoRefreshMs);
}

$('searchInput').addEventListener('input', applyFilters); ['employeeFilter','statusFilter','serviceFilter','slaFilter'].forEach(id=>$(id).addEventListener('change',applyFilters));
$('clearFilters').onclick = () => { $('searchInput').value=''; ['employeeFilter','statusFilter','serviceFilter','slaFilter'].forEach(id=>$(id).value=''); applyFilters(); };
$('contactSearchInput').addEventListener('input', applyContactFilters); $('contactCenterFilter').addEventListener('change', applyContactFilters);
$('contactSheetFilter').addEventListener('change', () => { state.contactSheet = $('contactSheetFilter').value; loadContacts(); });
$('clearContactFilters').onclick = () => { $('contactSearchInput').value=''; $('contactCenterFilter').value=''; applyContactFilters(); };
$('sortMode').addEventListener('change', () => { state.sortMode = $('sortMode').value; sortFiltered(); state.page = 1; render(); });
$('prevPage').onclick=()=>{state.page--;renderTable()}; $('nextPage').onclick=()=>{state.page++;renderTable()}; $('exportBtn').onclick=exportCSV; $('refreshBtn').onclick=()=>loadData(true);
$('menuBtn').onclick=()=>document.querySelector('.sidebar').classList.toggle('open'); document.querySelectorAll('.sidebar a').forEach(a=>a.onclick=()=>document.querySelector('.sidebar').classList.remove('open'));
$('today').textContent = new Intl.DateTimeFormat('vi-VN',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
loadData();
loadContacts();
startAutoRefresh();
