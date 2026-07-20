/**
 * Google Apps Script API cho dashboard tiến độ.
 * Tạo Apps Script gắn với Sheet, dán file này, Deploy > New deployment > Web app.
 */
const SHEET_ID = '1-IF5c92exMTG1BNiuHuSq4NA1tyrTPiQLXcokGNTRAI';
const SHEET_GID = 565968762;

function doGet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_GID);
  if (!sheet) return json_({ error: 'Không tìm thấy sheet gid ' + SHEET_GID });
  ensureNoteHeader_(sheet);
  const values = sheet.getDataRange().getDisplayValues();
  const data = values.slice(1).map((r, i) => ({ values: r, row: i + 2 })).filter(x => x.values.slice(0, 9).some(Boolean)).map(x => {
    const r = x.values;
    return {
    id: x.row,
    assigned: r[0] || '', transaction: r[1] || '', subscriber: r[2] || '',
    service: r[3] || '', employee: r[4] || 'Chưa phân công',
    status: r[5] || 'Chưa cập nhật', completed: r[6] || '', issue: r[7] || '', note: r[8] || ''
  }});
  return json_({ data: data, updatedAt: new Date().toISOString() });
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
    const transaction = sheet.getRange(row, 2).getDisplayValue();
    if (body.transaction && transaction !== body.transaction) throw new Error('Dữ liệu đã thay đổi, hãy làm mới trang');
    const oldStatus = sheet.getRange(row, 6).getDisplayValue();
    const completedCell = sheet.getRange(row, 7);
    if (oldStatus === 'Đã hoàn công' && !completedCell.isBlank()) throw new Error('Phiếu đã hoàn công và đã bị khóa');
    sheet.getRange(row, 6).setValue(body.status);
    let completedText = completedCell.getDisplayValue();
    if (body.status === 'Đã hoàn công' && completedCell.isBlank()) {
      const completedAt = new Date();
      completedCell.setValue(completedAt).setNumberFormat('dd/MM/yyyy HH:mm:ss');
      completedText = Utilities.formatDate(completedAt, ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy HH:mm:ss');
    }
    if (body.status === 'Đang xử lý' || body.status === 'Chưa cập nhật') completedCell.clearContent();
    sheet.getRange(row, 8).setValue(String(body.issue || ''));
    sheet.getRange(row, 9).setValue(String(body.note || ''));
    SpreadsheetApp.flush();
    if (body.status === 'Đang xử lý' || body.status === 'Chưa cập nhật') completedText = '';
    return json_({ ok: true, data: { id: row, status: body.status, completed: completedText, issue: String(body.issue || ''), note: String(body.note || '') } });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function ensureNoteHeader_(sheet) {
  if (!sheet.getRange(1, 9).getValue()) sheet.getRange(1, 9).setValue('Ghi chú');
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
