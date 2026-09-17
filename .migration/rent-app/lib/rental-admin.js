module.exports = (app, { mainApi, requireAdmin, requireLogin }) => {
  const cloudStore = require('./cloud-store');
  const action = (call, destination, message) => async (req, res, next) => {
    try {
      const result = await call(req);
      req.flash(result.ok ? 'success' : 'error', result.ok ? message : (result.body.error || 'ทำรายการไม่สำเร็จ'));
      res.redirect(destination);
    } catch (error) { next(error); }
  };
  app.get('/admin/rentals', requireAdmin, async (req, res, next) => {
    try {
      const result = await mainApi.rentalOverview();
      if (!result.ok) return res.status(503).send('โหลดข้อมูลร้านเช่าไม่สำเร็จ กรุณาลองใหม่');
      const transactions=cloudStore.data.walletTransactions.filter(t=>['shop_purchase','shop_renewal','refund'].includes(t.type)).map(t=>({...t,username:cloudStore.data.users.find(u=>u.id===t.userId)?.username||t.userId}));
      res.render('admin-rentals', { ...result.body, transactions, title: 'ร้านเช่าและประวัติ' });
    } catch (error) { next(error); }
  });
  app.post('/admin/rentals/:id/delete', requireAdmin, action(req => mainApi.deleteShop(req.params.id, req.body.confirmName), '/admin/rentals', 'ลบร้านแล้ว'));
  app.post('/admin/discord/settings', requireAdmin, action(req => mainApi.discordSettings(req.body), '/admin/rentals', 'บันทึกการตั้งค่าแล้ว'));
  app.post('/admin/discord/post-ticket-panel', requireAdmin, action(() => mainApi.discordPanel(), '/admin/rentals', 'โพสต์ปุ่มเปิดตั๋วแล้ว'));
  app.get('/sales', requireLogin, async (req, res, next) => {
    try {
      const result = await mainApi.sales(req.session.userId);
      if (!result.ok) return res.status(503).send('โหลดประวัติไม่สำเร็จ');
      res.render('sales', { title: 'ประวัติเช่าเดิม', sales: result.body.sales });
    } catch (error) { next(error); }
  });
  app.get('/sales/:id', requireLogin, async (req, res, next) => {
    try {
      const result = await mainApi.sale(req.params.id, req.session.userId);
      if (!result.ok) return res.status(result.status || 503).send('ไม่พบรายการหรือโหลดข้อมูลไม่สำเร็จ');
      res.render('sale', { ...result.body, title: 'รายละเอียดเว็บเช่าเดิม' });
    } catch (error) { next(error); }
  });
  app.get('/sales/:id/status', requireLogin, async (req, res) => {
    const result = await mainApi.sale(req.params.id, req.session.userId);
    res.status(result.status || 503).json(result.ok ? { provisioning: result.body.sale.provisioning || null } : { error: 'ไม่พบรายการ' });
  });
  app.post('/sales/:id/sync', requireLogin, async (req, res) => {
    const result = await mainApi.syncSale(req.params.id, req.session.userId, req.body.railwayToken);
    req.flash(result.ok ? 'success' : 'error', result.ok ? 'สั่งอัปเดตเว็บแล้ว' : result.body.error);
    res.redirect('/sales/' + encodeURIComponent(req.params.id));
  });
};
