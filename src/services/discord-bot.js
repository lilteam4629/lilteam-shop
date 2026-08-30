// Discord bot for the rent-a-website system only (src/routes/tenant.js):
// posts a notification when someone opens a new shop or renews one, and
// runs a lightweight ticket system (a "เปิดตั๋ว" button that opens a
// private support channel per customer). Fully optional — with no
// DISCORD_BOT_TOKEN set, every exported function below is a no-op so the
// app boots and runs identically without it.
const store = require('../data/store');

const TOKEN = process.env.DISCORD_BOT_TOKEN || '';

let client = null;
let Discord = null;

function isConfigured() {
  return Boolean(TOKEN);
}

function isReady() {
  return Boolean(client && client.isReady && client.isReady());
}

function cfg() {
  return (store.data.settings && store.data.settings.discord) || {};
}

async function init() {
  if (!TOKEN) {
    console.log('[discord-bot] DISCORD_BOT_TOKEN not set — Discord bot disabled.');
    return;
  }
  try {
    Discord = require('discord.js');
  } catch (err) {
    console.error('[discord-bot] discord.js is not installed — run `npm install discord.js`.');
    return;
  }
  const { Client, GatewayIntentBits } = Discord;
  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', () => {
    console.log(`[discord-bot] Logged in as ${client.user.tag}`);
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isButton()) return;
      if (interaction.customId === 'open_ticket') return await handleOpenTicket(interaction);
      if (interaction.customId === 'close_ticket') return await handleCloseTicket(interaction);
    } catch (err) {
      console.error('[discord-bot] interaction error:', err);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        interaction.reply({ content: 'เกิดข้อผิดพลาด กรุณาลองใหม่', ephemeral: true }).catch(() => {});
      }
    }
  });

  try {
    await client.login(TOKEN);
  } catch (err) {
    console.error('[discord-bot] login failed:', err.message);
    client = null;
  }
}

function buildEmbed(opts) {
  return new Discord.EmbedBuilder()
    .setColor(opts.color || 0xc8a63f)
    .setTitle(opts.title)
    .setDescription(opts.description || null)
    .addFields(opts.fields || [])
    .setTimestamp(new Date());
}

async function sendNotify(embedOpts) {
  const settings = cfg();
  if (!client || !settings.enabled || !settings.notifyChannelId) return;
  try {
    const channel = await client.channels.fetch(settings.notifyChannelId);
    if (!channel) return;
    await channel.send({ embeds: [buildEmbed(embedOpts)] });
  } catch (err) {
    console.error('[discord-bot] sendNotify failed:', err.message);
  }
}

async function notifyNewRental({ shopName, ownerUsername, days, price, expiresAt }) {
  await sendNotify({
    title: '🆕 มีคนเช่าเว็บใหม่',
    color: 0x4ade80,
    fields: [
      { name: 'ร้าน', value: String(shopName), inline: true },
      { name: 'ผู้เช่า', value: String(ownerUsername), inline: true },
      { name: 'ระยะเวลา', value: `${days} วัน`, inline: true },
      { name: 'ราคา', value: `฿${Number(price).toLocaleString()}`, inline: true },
      { name: 'หมดอายุ', value: `<t:${Math.floor(expiresAt / 1000)}:F>`, inline: false },
    ],
  });
}

async function notifyRenewal({ shopName, ownerUsername, days, price, expiresAt }) {
  await sendNotify({
    title: '🔄 มีคนต่ออายุร้าน',
    color: 0x60a5fa,
    fields: [
      { name: 'ร้าน', value: String(shopName), inline: true },
      { name: 'ผู้เช่า', value: String(ownerUsername), inline: true },
      { name: 'ต่ออายุ', value: `${days} วัน`, inline: true },
      { name: 'ราคา', value: `฿${Number(price).toLocaleString()}`, inline: true },
      { name: 'หมดอายุใหม่', value: `<t:${Math.floor(expiresAt / 1000)}:F>`, inline: false },
    ],
  });
}

// Posts (or re-posts) the "เปิดตั๋ว" button panel into the configured
// channel. Safe to call repeatedly — admin just gets one more panel message
// each time; old ones can be deleted by hand in Discord if desired.
async function postTicketPanel() {
  if (!client) throw new Error('บอทยังไม่เชื่อมต่อ (ตรวจสอบ DISCORD_BOT_TOKEN บน Railway และสถานะบอทด้านล่าง)');
  const settings = cfg();
  if (!settings.ticketPanelChannelId) throw new Error('กรุณาตั้งค่า Ticket Panel Channel ID ก่อน');
  const channel = await client.channels.fetch(settings.ticketPanelChannelId);
  if (!channel) throw new Error('ไม่พบห้องที่ตั้งค่าไว้ (ตรวจสอบ Channel ID และสิทธิ์บอทในห้องนั้น)');
  const embed = new Discord.EmbedBuilder()
    .setColor(0xc8a63f)
    .setTitle('📩 ติดต่อทีมงาน')
    .setDescription('กดปุ่มด้านล่างเพื่อเปิดห้องแชทส่วนตัวกับทีมงาน สอบถามเรื่องเช่าเว็บ/ต่ออายุ/ปัญหาการใช้งานได้เลย');
  const row = new Discord.ActionRowBuilder().addComponents(
    new Discord.ButtonBuilder().setCustomId('open_ticket').setLabel('เปิดตั๋วสอบถาม').setEmoji('📩').setStyle(Discord.ButtonStyle.Primary),
  );
  await channel.send({ embeds: [embed], components: [row] });
}

function ticketChannelNameFor(user) {
  return `ticket-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90) || `ticket-${user.id}`;
}

async function handleOpenTicket(interaction) {
  const settings = cfg();
  if (!settings.ticketCategoryId) {
    return interaction.reply({ content: 'ระบบตั๋วยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  const topic = `ticket-owner:${interaction.user.id}`;
  const existing = guild.channels.cache.find(ch => ch.parentId === settings.ticketCategoryId && ch.topic === topic);
  if (existing) {
    return interaction.editReply({ content: `คุณมีตั๋วที่เปิดอยู่แล้ว: <#${existing.id}>` });
  }
  const { PermissionFlagsBits } = Discord;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
  ];
  if (settings.supportRoleId) {
    overwrites.push({ id: settings.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }
  const channel = await guild.channels.create({
    name: ticketChannelNameFor(interaction.user),
    parent: settings.ticketCategoryId,
    topic,
    permissionOverwrites: overwrites,
  });
  const embed = new Discord.EmbedBuilder()
    .setColor(0xc8a63f)
    .setDescription(`สวัสดีครับ <@${interaction.user.id}> 👋\nพิมพ์รายละเอียดที่ต้องการสอบถามได้เลย ทีมงาน${settings.supportRoleId ? ` <@&${settings.supportRoleId}>` : ''}จะเข้ามาตอบโดยเร็วที่สุด`);
  const closeRow = new Discord.ActionRowBuilder().addComponents(
    new Discord.ButtonBuilder().setCustomId('close_ticket').setLabel('ปิดตั๋ว').setEmoji('🔒').setStyle(Discord.ButtonStyle.Danger),
  );
  await channel.send({
    content: `<@${interaction.user.id}>${settings.supportRoleId ? ` <@&${settings.supportRoleId}>` : ''}`,
    embeds: [embed],
    components: [closeRow],
  });
  await interaction.editReply({ content: `เปิดตั๋วแล้ว: <#${channel.id}>` });
}

async function handleCloseTicket(interaction) {
  const settings = cfg();
  const channel = interaction.channel;
  const isOwner = channel.topic === `ticket-owner:${interaction.user.id}`;
  const isSupport = settings.supportRoleId && interaction.member.roles.cache.has(settings.supportRoleId);
  const isAdmin = interaction.member.permissions.has(Discord.PermissionFlagsBits.ManageChannels);
  if (!isOwner && !isSupport && !isAdmin) {
    return interaction.reply({ content: 'คุณไม่มีสิทธิ์ปิดตั๋วนี้', ephemeral: true });
  }
  await interaction.reply({ content: '🔒 กำลังปิดตั๋ว... ห้องนี้จะถูกลบใน 5 วินาที' });
  if (settings.ticketLogChannelId) {
    try {
      const logChannel = await client.channels.fetch(settings.ticketLogChannelId);
      if (logChannel) await logChannel.send({ content: `🔒 ปิดตั๋ว **#${channel.name}** โดย <@${interaction.user.id}>` });
    } catch (err) { /* logging is best-effort */ }
  }
  setTimeout(() => channel.delete().catch(() => {}), 5000);
}

module.exports = { init, isConfigured, isReady, notifyNewRental, notifyRenewal, postTicketPanel };
