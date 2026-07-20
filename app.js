const CONFIG = {
  // Dán URL Web App Apps Script sau khi deploy để lấy dữ liệu live.
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycby1EbI_tkRBtKM8VxpkcGeKo1rnehJrlBPBIxH_BYl_U3KWJDWCiQLgQeZjs-jB-xZP5w/exec',
  fallbackCsv: './sheet.csv',
  pageSize: 18
};

const state = { all: [], filtered: [], page: 1 };
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
    id: index + 1, assigned: r[0]?.trim() || '', transaction: r[1]?.trim() || '',
    subscriber: r[2]?.trim() || '', service: r[3]?.trim() || '', employee: r[4]?.trim() || 'Chưa phân công',
    status: r[5]?.trim() || 'Chưa cập nhật', completed: r[6]?.trim() || '', issue: r[7]?.trim() || '', note: r[8]?.trim() || ''
  }));
}

async function loadData(showMessage = false) {
  $('refreshBtn').disabled = true;
  try {
    if (CONFIG.appsScriptUrl) {
      const res = await fetch(CONFIG.appsScriptUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('Không thể kết nối Apps Script');
      const json = await res.json();
      state.all = (Array.isArray(json) ? json : json.data).map(x => ({ ...x, status: x.status?.trim() || 'Chưa cập nhật', note: x.note || '' }));
      $('sourceLabel').textContent = 'Đồng bộ trực tiếp từ Google Sheet';
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
    $('workTable').innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(err.message)}. Hãy chạy site qua web server.</td></tr>`;
    toast(err.message);
  } finally { $('refreshBtn').disabled = false; }
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
function isDone(x) { return /đã hoàn công|hoàn thành|completed/i.test(x.status); }
function isLocked(x) { return isDone(x) && Boolean(x.completed); }
function hasIssue(x) { return Boolean(x.issue && !/^(không|ko|không có)$/i.test(x.issue)); }

function applyFilters() {
  const q = $('searchInput').value.trim().toLocaleLowerCase('vi');
  const employee = $('employeeFilter').value, status = $('statusFilter').value, service = $('serviceFilter').value;
  state.filtered = state.all.filter(x => (!employee || x.employee === employee) && (!status || x.status === status) && (!service || x.service === service) && (!q || Object.values(x).some(v => String(v).toLocaleLowerCase('vi').includes(q))));
  state.page = 1; render();
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
function renderTable() {
  const pages = Math.max(1, Math.ceil(state.filtered.length / CONFIG.pageSize)); if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * CONFIG.pageSize, data = state.filtered.slice(start, start + CONFIG.pageSize);
  $('resultCount').textContent = `${state.filtered.length.toLocaleString('vi-VN')} kết quả`;
  $('workTable').innerHTML = data.map(x => `<tr data-id="${x.id}" class="${isLocked(x)?'locked-row':''}"><td>${escapeHtml(x.assigned)}</td><td>${escapeHtml(x.transaction)}</td><td>${escapeHtml(x.subscriber)}</td><td>${escapeHtml(x.service)}</td><td>${escapeHtml(x.employee)}</td><td><span class="badge status-view ${badgeClass(x.status)}">${escapeHtml(statusLabel(x.status))}</span><select class="edit-field row-status edit-control"><option value="Chưa cập nhật" ${x.status==='Chưa cập nhật'||!x.status?'selected':''}>Chưa cập nhật</option><option value="Đang xử lý" ${x.status==='Đang xử lý'?'selected':''}>Đang xử lý</option><option value="Đã hoàn công" ${isDone(x)?'selected':''}>Đã hoàn công</option></select></td><td class="completed-cell">${escapeHtml(x.completed) || '—'}</td><td><div class="cell-view expandable" onclick="toggleCell(this)" title="Bấm để xem đầy đủ">${escapeHtml(x.issue) || '—'}</div><textarea class="edit-field row-issue edit-control" placeholder="Nội dung vướng mắc">${escapeHtml(x.issue)}</textarea></td><td><div class="cell-view expandable" onclick="toggleCell(this)" title="Bấm để xem đầy đủ">${escapeHtml(x.note || '') || '—'}</div><textarea class="edit-field row-note edit-control" placeholder="Đầu mối kỹ thuật, thi công...">${escapeHtml(x.note || '')}</textarea></td><td class="action-cell">${isLocked(x)?'<span class="lock-icon" title="Phiếu đã hoàn công">✓</span>':`<button class="icon-btn edit-btn" onclick="editRow(${x.id}, this)" title="Sửa phiếu" aria-label="Sửa phiếu">✎</button><button class="icon-btn save-btn edit-control" onclick="saveRow(${x.id}, this)" title="Lưu phiếu" aria-label="Lưu phiếu">✓</button>`}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">Không tìm thấy công việc phù hợp</td></tr>';
  $('pageLabel').textContent = `Trang ${state.page} / ${pages}`; $('prevPage').disabled = state.page <= 1; $('nextPage').disabled = state.page >= pages;
}
function exportCSV() {
  const headers = ['Ngày giao','Mã giao dịch','Mã thuê bao','Dịch vụ','Người thực hiện','Trạng thái','Ngày hoàn công','Nội dung vướng mắc','Ghi chú'];
  const keys = ['assigned','transaction','subscriber','service','employee','status','completed','issue','note'];
  const csv = '\ufeff' + [headers, ...state.filtered.map(x=>keys.map(k=>x[k]))].map(r=>r.map(v=>`"${String(v||'').replaceAll('"','""')}"`).join(',')).join('\r\n');
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
  } catch (err) { toast(err.message); }
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

$('searchInput').addEventListener('input', applyFilters); ['employeeFilter','statusFilter','serviceFilter'].forEach(id=>$(id).addEventListener('change',applyFilters));
$('clearFilters').onclick = () => { $('searchInput').value=''; ['employeeFilter','statusFilter','serviceFilter'].forEach(id=>$(id).value=''); applyFilters(); };
$('prevPage').onclick=()=>{state.page--;renderTable()}; $('nextPage').onclick=()=>{state.page++;renderTable()}; $('exportBtn').onclick=exportCSV; $('refreshBtn').onclick=()=>loadData(true);
$('menuBtn').onclick=()=>document.querySelector('.sidebar').classList.toggle('open'); document.querySelectorAll('.sidebar a').forEach(a=>a.onclick=()=>document.querySelector('.sidebar').classList.remove('open'));
$('today').textContent = new Intl.DateTimeFormat('vi-VN',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
loadData();
