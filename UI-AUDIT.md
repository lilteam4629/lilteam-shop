# LilTeam Shop UI/UX audit

ตรวจและปรับบน `http://localhost:3000` เท่านั้น ยังไม่มีการ deploy

## ตรวจพบและแก้แล้ว

- **Layout:** รื้อ visual shell กลางของทั้งโปรเจ็คเป็น paper-and-ink editorial; hero, proof, benefits, catalog, process, FAQ, footer, product detail, wallet, help และ cart ใช้จังหวะเดียวกัน; หลังบ้านทุก route ใช้ work surface, sidebar และตารางแบบเดียวกัน
- **Typography:** เปลี่ยนทั้งหน้าร้านและหลังบ้านเป็น Prompt สำหรับหัวข้อ/ข้อความ และ IBM Plex Mono เฉพาะ metadata; ปรับลำดับหัวข้อและความกว้างบรรทัดให้ภาษาไทยอ่านง่าย
- **Color:** เปลี่ยน visual world เป็น paper/ink/light editorial; ใช้ warm gold เฉพาะราคา สถานะ และความเป็นเจ้าของ Partner/API พร้อม contrast ที่อ่านได้ในแถบ Local DB และสถานะต่างๆ
- **Accessibility:** เพิ่ม `focus-visible` ที่เห็นชัด, ปรับปุ่มและลิงก์ให้แตะได้อย่างน้อย 42–44px, เพิ่ม `role=status/alert` ให้ข้อความสถานะ, คง alt text และ aria-label ของภาพ/ปุ่มสำคัญ
- **Responsive:** ตรวจ viewport 390px และ desktop; ตาราง admin ยังเลื่อนได้ในกรอบ, หน้าสินค้าเปลี่ยนเป็น card บนมือถือ, เมนูและฟอร์มไม่บังคับ horizontal overflow
- **Distill:** ลดเงาและเอฟเฟกต์ที่ไม่จำเป็นในหลังบ้าน ให้ข้อมูลสำคัญ (ยอด, สถานะ, action) เด่นกว่า decoration

## ไฟล์หลัก

- `public/css/impeccable-system-v1.css` — guardrails กลางของ storefront/admin
- `src/views/layouts/main.ejs` — ฟอนต์และระบบ UI กลางสำหรับทุกหน้าร้าน
- `src/views/layouts/admin.ejs` — ฟอนต์และระบบ UI กลางสำหรับทุกหน้าหลังบ้าน
- `src/views/partials/navbar.ejs` / `src/views/partials/footer.ejs` — shell การนำทางและ footer ใหม่
- `src/views/shop/license.ejs` — standalone unlock page ให้ใช้ระบบเดียวกัน
- `src/views/shop/home.ejs` — Verified Drop homepage, responsive catalog, FAQ, process และ Partner/API callout
- `DESIGN.md` / `.impeccable/design.json` — visual world ใหม่และ design sidecar

## Verification

- `impeccable detect --json` → `[]`
- `node scripts/test-performance-guards.js` ผ่าน
- `npm run test:smoke` ผ่าน (45 admin pages, storefront, assets, error page)
- `npm test` ผ่านทุกชุดตรวจ รวม theme, tenant, catalog, topup, import และ smoke checks
- ตรวจด้วย CUA บน localhost: หน้าแรก desktop/mobile, product detail, help, wallet, admin dashboard, products และ catalog API; console error/warning = 0

## Reference boundary

โครงลำดับแบบ editorial (hero → proof → benefits → products → process → FAQ) ได้แรงบันดาลใจจาก [kiddyxstore.com](https://kiddyxstore.com/) แต่ใช้ copy, routes, metrics, stock และระบบชำระเงินจริงของ LilTeam เท่านั้น ไม่คัดลอก assets หรือ claims ของเว็บอ้างอิง
