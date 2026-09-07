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

หากเข้าแอดมินไม่ได้ ให้ตั้ง `ADMIN_USERNAME` และ `ADMIN_PASSWORD` ใน Environment Variables ของโฮสต์แล้ว Deploy ใหม่ ระบบจะกู้สิทธิ์และเปลี่ยนรหัสของบัญชีแอดมินให้โดยไม่ลบข้อมูลร้าน

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

## ให้คนอื่นเช่าระบบนี้ไปเปิดร้านเอง

ระบบเช่าอยู่ใน Shop Cloud แยกจากหน้าร้านหลัก ลูกค้าสมัคร เข้าสู่ระบบ เติมเงิน เปิดร้าน และต่ออายุจาก Shop Cloud ทั้งหมด โดยใช้บัญชีและยอดเงินเดียวกับเว็บหลัก ร้านและข้อมูลเดิมยังคงอยู่ในฐานข้อมูลกลาง

- `/start` เปิดร้านใหม่และหักยอดเงิน
- `/my-shops` แสดงร้านของลูกค้าและต่ออายุ
- `/wallet` เติมเงินและดูประวัติ
- `/admin/plans` จัดการแพ็กเกจ
- `/admin/rentals` ดูร้านเช่า ประวัติรายการ ลบร้าน และตั้งค่า Discord

เว็บหลักไม่แสดงเมนูหรือหลังบ้านเช่าแล้ว ลิงก์เช่าเดิมจะส่งต่อไป Shop Cloud เพื่อรองรับบุ๊กมาร์กเก่า การเชื่อมต่อข้อมูลระหว่างสองบริการใช้ Internal API เท่านั้น จึงต้องตั้ง `INTERNAL_API_SECRET` ให้ตรงกัน และตั้ง `CLOUD_SITE_URL` ในเว็บหลักหาก Shop Cloud ไม่ได้อยู่ที่ `rent.MAIN_DOMAIN`

## หมายเหตุสำหรับผู้พัฒนาต่อ

- Session ใช้ MongoDB เมื่อกำหนด `MONGODB_URI` และใช้ไฟล์ถาวรในโหมด local; Shop Cloud เก็บ session ใน volume ของตัวเอง
- ยังไม่มี payment gateway จริง ปุ่ม "ชำระเงิน" เป็นการจำลองหักเงินจากกระเป๋าเงินในระบบเท่านั้น
- รูปภาพสินค้า/ตัวกรองทั้งหมดอ้างอิงเป็น URL ภายนอก (ไม่มีระบบอัปโหลดไฟล์)
- ทุกหน้าใช้ Tailwind ผ่าน CDN (`cdn.tailwindcss.com`) เพื่อความง่ายในการแก้ไข — ถ้าจะขึ้น production จริงจังควรเปลี่ยนไปใช้ Tailwind CLI/PostCSS build แทน
