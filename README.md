# Dashboard tiến độ kênh

## Chạy nhanh

Vì trình duyệt không cho `fetch()` file CSV khi mở trực tiếp bằng `file://`, hãy chạy một web server tại thư mục này, ví dụ:

```powershell
python -m http.server 8080
```

Sau đó mở `http://localhost:8080`.

## Đồng bộ trực tiếp Google Sheet

1. Trong Google Sheet: **Extensions → Apps Script**.
2. Dán nội dung file `apps-script.gs` và lưu.
3. Chọn **Deploy → New deployment → Web app**.
4. Execute as: **Me**. Who has access: chọn phạm vi phù hợp (để site public đọc được, chọn **Anyone**).
5. Copy URL kết thúc bằng `/exec`.
6. Mở `app.js`, dán URL vào `CONFIG.appsScriptUrl`.

Khi chưa cấu hình Apps Script, dashboard dùng `sheet.csv` là bản dữ liệu đã tải tại thời điểm dựng site.

## Sau khi thay đổi mã Apps Script

Để chức năng cập nhật phiếu hoạt động, cần dán lại toàn bộ `apps-script.gs`, sau đó vào **Deploy → Manage deployments → Edit**, chọn **New version** và bấm **Deploy**. Giữ nguyên URL `/exec` hiện tại.

Web App phải được triển khai với **Execute as: Me** và quyền truy cập phù hợp để người dùng dashboard có thể gọi API. API sẽ tự tạo tiêu đề `Ghi chú` tại cột I; khi đổi trạng thái sang `Đã hoàn công`, cột G tự ghi ngày giờ, còn khi đổi lại `Đang xử lý`, ngày hoàn công được xóa.
