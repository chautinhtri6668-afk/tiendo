/**
 * Google Apps Script API cho dashboard tiến độ.
 * Tạo Apps Script gắn với Sheet, dán file này, Deploy > New deployment > Web app.
 */
const SHEET_ID = '1-IF5c92exMTG1BNiuHuSq4NA1tyrTPiQLXcokGNTRAI';
const SHEET_GID = 565968762;
const CONTACTS_SHEET_ID = '1Xd88BoxLjjv7oY05yQEz-8NcPJCC0iUe';
const CONTACT_SHEETS = ['TTVT8', '18 Trung tâm Viễn Thông', 'Lãnh đạo P.HT', 'Danh bạ P.HT', 'DB mới 1-10', 'VNPT địa bàn'];

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'contacts') return getContacts_(e.parameter.sheet || CONTACT_SHEETS[0]);
  if (action === 'contactSheets') return json_({ sheets: CONTACT_SHEETS });
  return getProgress_();
}

function getProgress_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_GID);
  if (!sheet) return json_({ error: 'Không tìm thấy sheet gid ' + SHEET_GID });
  ensureNoteHeader_(sheet);
  const values = sheet.getDataRange().getDisplayValues();
  const data = values.slice(1).map((r, i) => ({ values: r, row: i + 2 })).filter(x => x.values.slice(0, 9).some(Boolean)).map(x => {
    const r = x.values;
    return {
    id: x.row,
    assigned: r[0] || '', transaction: normalizeTransaction_(r[1], r[2]), subscriber: r[2] || '',
    service: r[3] || '', employee: r[4] || 'Chưa phân công',
    status: r[5] || 'Chưa cập nhật', completed: r[6] || '', issue: r[7] || '', note: r[8] || ''
  }});
  return json_({ data: data, updatedAt: new Date().toISOString() });
}

function getContacts_(sheetName) {
  if (!CONTACT_SHEETS.includes(sheetName)) return json_({ error: 'Sheet không hợp lệ: ' + sheetName });
  const ss = SpreadsheetApp.openById(CONTACTS_SHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return json_({ error: 'Không tìm thấy sheet: ' + sheetName });
  const values = sheet.getDataRange().getDisplayValues();
  return json_({ data: normalizeContacts_(values), sheet: sheetName, updatedAt: new Date().toISOString() });
}

function normalizeContacts_(values) {
  let center = '';
  return values.slice(1).map((r, index) => {
    if (String(r[0] || '').trim()) center = String(r[0]).trim();
    const raw = r.map(v => String(v || '').replace(/\s+/g, ' ').trim());
    const emailIndex = raw.findIndex(v => /@/.test(v));
    const phoneIndex = raw.findIndex((v, i) => i > 1 && /(?:\+?84|0)?\d[\d\s.]{6,}/.test(v));
    const titleIndex = raw.findIndex(v => /^(GĐ|PGĐ|GD|PGD)$/i.test(v));
    const birthday = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw[3]) ? raw[3] : '';
    const note = raw.slice(3).filter((v, i) => {
      const absoluteIndex = i + 3;
      return v && absoluteIndex !== emailIndex && absoluteIndex !== phoneIndex && absoluteIndex !== titleIndex && v !== birthday;
    }).join(' ');
    return {
      id: index + 1,
      center: center,
      team: raw[1] || '',
      name: raw[2] || '',
      birthday: birthday,
      email: emailIndex >= 0 ? raw[emailIndex].replace(/[<>]/g, '') : '',
      phone: phoneIndex >= 0 ? raw[phoneIndex] : '',
      title: titleIndex >= 0 ? raw[titleIndex] : '',
      note: note
    };
  }).filter(x => x.center && (x.name || x.team || x.email || x.phone));
}

function doPost(e) {
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(10000);
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action !== 'update') throw new Error('Thao tác không hợp lệ');
    if (!['Đã hoàn công', 'Đang xử lý', 'Chưa cập nhật'].includes(body.status)) throw new Error('Trạng thái không hợp lệ');
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_GID);
    if (!sheet) throw new Error('Không tìm thấy sheet');
    ensureNoteHeader_(sheet);
    const row = Number(body.id);
    if (!Number.isInteger(row) || row < 2 || row > sheet.getLastRow()) throw new Error('Phiếu không tồn tại');
    const transaction = normalizeTransaction_(sheet.getRange(row, 2).getDisplayValue(), sheet.getRange(row, 3).getDisplayValue());
    if (body.transaction && transaction !== body.transaction) throw new Error('Dữ liệu đã thay đổi, trang sẽ tự làm mới. Hãy sửa lại đúng dòng vừa cập nhật');
    const oldStatus = sheet.getRange(row, 6).getDisplayValue();
    const completedCell = sheet.getRange(row, 7);
    if (oldStatus === 'Đã hoàn công' && !completedCell.isBlank()) throw new Error('Phiếu đã hoàn công và đã bị khóa');
    let completedText = completedCell.getDisplayValue();

    if (body.status !== oldStatus) {
      sheet.getRange(row, 6).setValue(body.status);
      if (body.status === 'Đã hoàn công' && completedCell.isBlank()) {
        const completedAt = new Date();
        completedCell.setValue(completedAt).setNumberFormat('dd/MM/yyyy HH:mm:ss');
        completedText = Utilities.formatDate(completedAt, ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy HH:mm:ss');
      }
      if (body.status === 'Đang xử lý' || body.status === 'Chưa cập nhật') {
        completedCell.clearContent();
        completedText = '';
      }
    }

    const issueText = String(body.issue || '');
    const noteText = String(body.note || '');
    if (sheet.getRange(row, 8).getDisplayValue() !== issueText) sheet.getRange(row, 8).setValue(issueText);
    if (sheet.getRange(row, 9).getDisplayValue() !== noteText) sheet.getRange(row, 9).setValue(noteText);
    SpreadsheetApp.flush();
    return json_({ ok: true, data: { id: row, status: body.status, completed: completedText, issue: issueText, note: noteText } });
  } catch (err) {
    const message = String(err && err.message || err);
    if (message.includes('protected') || message.includes('bảo vệ')) return json_({ ok: false, error: 'Sheet đang khóa ô cần cập nhật. Hãy bỏ bảo vệ cột Ghi chú/Vướng mắc/Trạng thái hoặc deploy Web App với Execute as: Me.' });
    return json_({ ok: false, error: message });
  } finally {
    lock.releaseLock();
  }
}

function ensureNoteHeader_(sheet) {
  const cell = sheet.getRange(1, 9);
  if (!cell.getValue()) {
    try {
      cell.setValue('Ghi chú');
    } catch (err) {
      // Header may be protected; updates can still work if the data cells are editable.
    }
  }
}

function normalizeTransaction_(transaction, subscriber) {
  const text = String(transaction || '').trim();
  if (!text || String(subscriber || '').trim()) return text;
  if (text.indexOf('000') === 0) return text;
  return /^\d{1,7}$/.test(text) ? text.padStart(text.length + 3, '0') : text;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
