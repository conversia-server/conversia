// =====================================================
// Convers IA – Servidor oficial
// WhatsApp multi-instância + Flow Builder + Automação
// SUPORTE MULTI-SITE + RESET HARD (#reset)
// Fly.io READY
// =====================================================

import express from "express";
import cors from "cors";
import qrcode from "qrcode";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import pkg from "whatsapp-web.js";

const { Client, LocalAuth } = pkg;

// =====================================================
// EXPRESS SERVER
// =====================================================

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());

// =====================================================
// UTILS
// =====================================================

function sanitizeClientId(id) {
  if (!id) id = "default";
  return String(id)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isValidHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function safeFetchJson(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(t);

    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch {
      return txt;
    }
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

// =====================================================
// GLOBAL STATE
// =====================================================

const clients = {};
const qrCodes = {};
const siteConfig = {};
const activeFlows = {};
const conversationState = {};

const sessionsDir = path.join(process.cwd(), "sessions");
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

// =====================================================
// REGISTRAR CONVERSA INICIADA
// =====================================================

async function registerConversationStarted(clientId, phone) {
  const cfg = siteConfig[clientId];
  if (!cfg?.wp_url) return;

  const url = `${cfg.wp_url.replace(/\/$/, "")}/wp-json/convers-ia/v1/start-conversation`;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        timestamp: new Date().toISOString(),
      }),
    });

    console.log(`📩 Conversa registrada (${clientId} - ${phone})`);
  } catch (e) {
    console.warn(`⚠️ Erro ao registrar conversa (${clientId}):`, e.message);
  }
}

// =====================================================
// INICIAR CLIENTE WHATSAPP
// =====================================================

async function startClient(rawId) {
  const clientId = sanitizeClientId(rawId);

  if (clients[clientId]) {
    console.log(`ℹ️ Cliente ${clientId} já está rodando.`);
    return;
  }

  console.log(`🟢 Iniciando WhatsApp Client: ${clientId}`);

  const clientPath = path.join(sessionsDir, clientId);
  if (!fs.existsSync(clientPath)) fs.mkdirSync(clientPath, { recursive: true });

  const client = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: clientPath }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
      ],
    },
  });

  // =====================================================
  // LOG EXTRA — INDICA QUE OS LISTENERS FORAM REGISTRADOS
  // =====================================================
  console.log("👂 Listener de mensagens registrado para:", clientId);

  client.on("message_create", (msg) => {
    console.log("📩 Evento message_create disparou:", msg.body);
  });

  // LISTENER ÚNICO DE MENSAGENS
  client.on("message", (msg) => {
    console.log(`💬 Mensagem recebida de ${msg.from}: ${msg.body}`);

    handleIncomingMessage(clientId, msg).catch((e) =>
      console.error("❌ Erro handleIncoming:", e.message)
    );
  });

  client.on("qr", async (qr) => {
    qrCodes[clientId] = await qrcode.toDataURL(qr);
    console.log(`📱 QR atualizado (${clientId})`);
  });

  client.on("ready", () => {
    console.log(`✅ Cliente pronto (${clientId})`);
    delete qrCodes[clientId];

    if (siteConfig[clientId]?.automations_endpoint) {
      loadAutomations(clientId).catch(() => {});
    }
  });

  client.on("authenticated", () => {
    console.log(`🔐 Cliente autenticado (${clientId})`);
  });

  client.on("disconnected", () => {
    console.log(`🔴 Cliente desconectado (${clientId}), reiniciando...`);
    delete clients[clientId];
    delete qrCodes[clientId];
    setTimeout(() => startClient(clientId), 7000);
  });

  try {
    await client.initialize();
    clients[clientId] = client;
  } catch (e) {
    console.error(`❌ Erro ao iniciar cliente ${clientId}:`, e.message);
  }
}

// =====================================================
// ROTAS PRINCIPAIS
// =====================================================

app.get("/wp-json/convers-ia/v1/status", (req, res) => {
  const cid = sanitizeClientId(req.query.client_id || "default");

  if (!clients[cid]) return res.json({ status: "disconnected" });
  if (qrCodes[cid]) return res.json({ status: "waiting_qr" });

  res.json({ status: "connected" });
});

app.get("/wp-json/convers-ia/v1/qr", (req, res) => {
  const cid = sanitizeClientId(req.query.client_id || "default");
  const qr = qrCodes[cid]?.replace(/^data:image\/png;base64,/, "") || null;
  res.json({ qr });
});

app.all("/wp-json/convers-ia/v1/connect", (req, res) => {
  const cid = sanitizeClientId(req.query.client_id || "default");
  const wp_url = req.query.wp_url || null;
  const endpoint = req.query.automations_endpoint || null;

  siteConfig[cid] = {
    wp_url: wp_url || siteConfig[cid]?.wp_url || null,
    automations_endpoint: endpoint || siteConfig[cid]?.automations_endpoint || null,
    lastLoadAt: null,
  };

  console.log(`🌐 WP vinculado ao clientId=${cid}`);
  startClient(cid);

  res.json({ status: "starting", client_id: cid });
});

// =====================================================
// CARREGAR AUTOMAÇÕES
// =====================================================

async function loadAutomations(clientId) {
  const cfg = siteConfig[clientId];

  if (!cfg?.automations_endpoint) {
    console.warn(`⚠️ Nenhum automations_endpoint configurado (${clientId})`);
    return;
  }

  if (!isValidHttpUrl(cfg.automations_endpoint)) {
    console.warn(`⚠️ Endpoint inválido (${clientId}): ${cfg.automations_endpoint}`);
    return;
  }

  try {
    const data = await safeFetchJson(cfg.automations_endpoint, { method: "GET" }, 9000);

    if (!Array.isArray(data)) {
      console.error(`❌ Automations inválidas (${clientId}):`, data);
      return;
    }

    const flows = data.filter(f => f.is_active == 1 && f.flow_data);
    const map = {};

    flows.forEach(f => (map[f.id] = f));
    activeFlows[clientId] = map;

    cfg.lastLoadAt = new Date().toISOString();
    console.log(`🧩 Fluxos carregados (${clientId}): ${flows.length}`);

  } catch (e) {
    console.error(`❌ Falha ao carregar automações (${clientId}):`, e.message);
  }
}

// Loop de recarga automações
setInterval(() => {
  Object.keys(siteConfig).forEach(cid => {
    if (siteConfig[cid]?.automations_endpoint) {
      loadAutomations(cid).catch(() => {});
    }
  });
}, 60000);

// =====================================================
// FUNÇÕES DE EXECUÇÃO
// =====================================================

function getStartBlock(blocks) {
  const incoming = {};
  blocks.forEach(b => incoming[b.id] = 0);

  blocks.forEach(b => {
    if (b.next) incoming[b.next]++;
    if (b.next_yes) incoming[b.next_yes]++;
    if (b.next_no) incoming[b.next_no]++;
    if (b.next_options)
      Object.values(b.next_options).forEach(id => incoming[id]++);
  });

  return blocks.find(b => incoming[b.id] === 0) || blocks[0];
}

async function handleIncomingMessage(clientId, msg) {
  const phone = msg.from;

  if (msg.body.trim().toLowerCase() === "#reset") {
    delete conversationState[clientId]?.[phone];
    await msg.reply("🔄 Conversa reiniciada!");
    return;
  }

  const flows = activeFlows[clientId];
  if (!flows) return;

  const flow = Object.values(flows)[0];
  if (!flow?.flow_data?.blocks) return;

  const blocks = flow.flow_data.blocks;

  conversationState[clientId] = conversationState[clientId] || {};
  const conv = conversationState[clientId];

  if (!conv[phone]) {
    const start = getStartBlock(blocks);

    conv[phone] = { block: start.id, created_at: new Date().toISOString() };

    await msg.reply(start.content || start.question || start.title || "");

    registerConversationStarted(clientId, phone);

    await runAutomatedForward(clientId, phone, start, blocks);
    return;
  }

  const current = blocks.find(b => b.id === conv[phone].block);
  if (!current) {
    delete conv[phone];
    return;
  }

  if (current.type === "mensagem") {
    const next = blocks.find(b => b.id === current.next);
    if (next) {
      conv[phone].block = next.id;
      await msg.reply(next.content || "");

      await runAutomatedForward(clientId, phone, next, blocks);
    }
    return;
  }

  if (current.type === "pergunta" && current.next_options) {
    const userText = msg.body.trim().toLowerCase();

    const matched = Object.keys(current.next_options).find(
      key => key.toLowerCase() === userText
    );

    if (matched) {
      const nextId = current.next_options[matched];
      const next = blocks.find(b => b.id === nextId);

      if (next) {
        conv[phone].block = next.id;
        await msg.reply(next.content || "");

        await runAutomatedForward(clientId, phone, next, blocks);
      }
      return;
    }

    await msg.reply("❓ Não entendi. Pode repetir?");
    return;
  }

  if (current.type === "simnao") {
    const t = msg.body.trim().toLowerCase();

    let nextId = null;

    if (["sim", "sí", "yes", "y"].includes(t)) {
      nextId = current.next_yes;
    }
    else if (["não", "nao", "no", "n"].includes(t)) {
      nextId = current.next_no;
    }

    if (nextId) {
      const next = blocks.find(b => b.id === nextId);
      if (next) {
        conv[phone].block = next.id;
        await msg.reply(next.content || "");
        await runAutomatedForward(clientId, phone, next, blocks);
      }
      return;
    }

    await msg.reply("Responda apenas SIM ou NÃO 👍");
    return;
  }
}

async function runAutomatedForward(clientId, phone, block, blocks) {
  const client = clients[clientId];
  if (!client) return;

  while (block && block.type === "mensagem" && block.next) {
    const next = blocks.find(b => b.id === block.next);
    if (!next) break;

    block = next;
    conversationState[clientId][phone].block = block.id;

    await client.sendMessage(phone, block.content || "");
  }
}

// =====================================================
// START SERVER
// =====================================================

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 Convers IA rodando na porta ${PORT}`);
});

app.get("/", (req, res) => {
  res.send("Convers IA server is running");
});
