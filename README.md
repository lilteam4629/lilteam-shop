# LilTeam Shop

เว็บร้านขายไอดีเกม Steam (ออฟไลน์ + เช่ารายวัน) พร้อมระบบหลังบ้านเต็มรูปแบบ
สร้างด้วย Node.js + Express + EJS + Tailwind CSS (CDN) — ไม่ต้องใช้ build step

## เริ่มต้นใช้งาน

```bash
npm install
cp .env.example .env   # (ไม่บังคับ ดูหัวข้อ "ระบบเก็บข้อมูล" ด้านล่าง)
npm start
```

เปิด `http://localhost:3000`

**บัญชีทดลอง:**
- ลูกค้า: `demo` / `demo1234`
- แอดมิน: `admin` / `admin1234` (เข้าหลังบ้านที่ `/admin`)

## โครงสร้างโปรเจกต์

```
src/
  app.js              # จุดเริ่มต้นแอป, ตั้งค่า middleware, mount routes
  data/
    store.js          # ชั้นข้อมูล (MongoDB Atlas หรือ fallback เป็นไฟล์ JSON)
    db.json           # ข้อมูลตัวอย่าง (สร้างอัตโนมัติถ้ายังไม่มี, ไม่ commit ขึ้น git)
  middleware/
    auth.js           # attachUser, requireLogin, requireAdmin
  routes/
    shop.js            # หน้าร้าน: หน้าแรก, รายการสินค้า, หน้าสินค้า, ค้นหา
    auth.js            # login / register / logout
    cart.js             # ตะกร้าสินค้า, checkout
    account.js          # บัญชีลูกค้า, ประวัติคำสั่งซื้อ, ขอโค้ด Steam Guard
    admin.js             # ระบบหลังบ้านทั้งหมด (สินค้า, ตัวกรอง, ออเดอร์, สมาชิก, คูปอง, ประกาศ, ตั้งค่า)
  views/
    layouts/            # เลย์เอาต์หลัก (หน้าร้าน / หลังบ้าน)
    partials/            # ส่วนประกอบซ้ำ (navbar, footer, product-card, filter-panel)
    shop/                # หน้าต่างๆ ของหน้าร้าน
    admin/               # หน้าต่างๆ ของหลังบ้าน
public/                # ไฟล์ static (css, img)
```

## ระบบเก็บข้อมูล

โปรเจกต์นี้รองรับ 2 โหมด สลับอัตโนมัติตามว่ามีตัวแปรแวดล้อม `MONGODB_URI` หรือไม่:

- **มี `MONGODB_URI`** → เก็บข้อมูลถาวรบน MongoDB Atlas (แนะนำสำหรับ production/deploy จริง)
- **ไม่มี** → fallback ไปใช้ไฟล์ `src/data/db.json` (สะดวกสำหรับ dev ในเครื่อง แต่ข้อมูลจะรีเซ็ตถ้าลบไฟล์หรือ deploy ใหม่บน hosting ที่ดิสก์ไม่ถาวร)

ดูวิธีตั้งค่า MongoDB Atlas แบบละเอียดได้ใน [.env.example](.env.example)

โครงสร้างข้อมูลทั้งหมด (settings, products, filterTags, stockItems, orders, coupons, announcements, users, reviews, walletTransactions) นิยามไว้ที่ `defaultData()` ใน `src/data/store.js` — นี่คือจุดเดียวที่ควรดูเพื่อเข้าใจ schema ทั้งหมดของระบบ

## ฟีเจอร์หลัก

**หน้าร้าน**
- แยกสินค้า 2 ประเภท: ไอดีออฟไลน์ (ราคา + ราคาปกติขีดฆ่า) / ไอดีเช่ารายวัน
- ตัวกรองสินค้าแบบเลื่อนแนวนอน จัดการรูป/ชื่อได้จากหลังบ้าน ผูกกับสินค้าได้อิสระ
- ตะกร้า + คูปองส่วนลด + ชำระด้วยกระเป๋าเงิน (จำลอง ไม่ใช่ payment gateway จริง)
- ระบบขอโค้ด Steam Guard (จำกัด 3 ครั้ง/ออเดอร์)
- เอฟเฟกต์: mouse-tracking spotlight บนการ์ดสินค้า, animated stat counters

**หลังบ้าน** (`/admin`, ต้องเป็น role `admin`)
- จัดการสินค้า, สต๊อกไอดี (username/password), ตัวกรองสินค้า
- จัดการคำสั่งซื้อ, สมาชิก (ปรับยอดกระเป๋าเงิน, ระงับบัญชี), คูปอง, ประกาศ, ตั้งค่าร้าน

## หมายเหตุสำหรับผู้พัฒนาต่อ

- Session อยู่ใน memory (`express-session` แบบ default store) — ถ้า scale เป็นหลาย instance ต้องเปลี่ยนไปใช้ session store แชร์กันได้ (เช่น connect-mongo)
- ยังไม่มี payment gateway จริง ปุ่ม "ชำระเงิน" เป็นการจำลองหักเงินจากกระเป๋าเงินในระบบเท่านั้น
- รูปภาพสินค้า/ตัวกรองทั้งหมดอ้างอิงเป็น URL ภายนอก (ไม่มีระบบอัปโหลดไฟล์)
- ทุกหน้าใช้ Tailwind ผ่าน CDN (`cdn.tailwindcss.com`) เพื่อความง่ายในการแก้ไข — ถ้าจะขึ้น production จริงจังควรเปลี่ยนไปใช้ Tailwind CLI/PostCSS build แทน
