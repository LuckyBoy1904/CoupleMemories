# Deploy miễn phí lên Fly.io

App của bạn dùng:
- Socket.io (WebSocket)
- SQLite (`better-sqlite3`)
- Upload ảnh/video (lưu file)

Vì vậy cần **persistent volume**. Fly.io phù hợp và có free tier.

## Chuẩn bị

1) Cài Fly CLI
- Windows: cài `flyctl` theo hướng dẫn trên trang Fly.io

2) Đăng nhập

```powershell
fly auth login
```

## Deploy

Tại thư mục dự án:

```powershell
fly launch
```

Khi hỏi:
- App name: chọn tên khác nếu bị trùng
- Region: chọn gần bạn (ví dụ `sin` cho Singapore)
- Deploy now: Yes

## Tạo volume để lưu DB + uploads (BẮT BUỘC)

```powershell
fly volumes create data --size 1
```

Sau đó deploy lại:

```powershell
fly deploy
```

## Lưu ý

- SQLite sẽ nằm ở: `/data/app.sqlite`
- Uploads nằm ở: `/data/uploads`
- Mở app: `fly open`

