require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const mailTransporter = (process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS)
  ? nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT) || 587,
      secure: Number(process.env.MAIL_PORT) === 465,
      connectionTimeout: 4000,
      greetingTimeout: 4000,
      socketTimeout: 5000,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      }
    })
  : null;

async function enviarCorreoVerificacion({ to, nombre, codigo }) {
  if (process.env.BREVO_API_KEY) {
    const senderEmail = process.env.MAIL_USER || 'whatsappdistribuido2569@gmail.com';
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: 'WhatsApp ITP Web',
          email: senderEmail
        },
        to: [{ email: to, name: nombre }],
        subject: 'Código de verificación - WhatsApp ITP Web',
        htmlContent: `<p>Hola <strong>${nombre}</strong>,</p><p>Tu código de verificación es: <strong>${codigo}</strong></p>`
      })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.message || `Error HTTP ${resp.status} al enviar correo con Brevo`);
    }
    return;
  }

  if (process.env.RESEND_API_KEY) {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'WhatsApp ITP Web <onboarding@resend.dev>',
        to: [to],
        subject: 'Código de verificación - WhatsApp ITP Web',
        html: `<p>Hola <strong>${nombre}</strong>,</p><p>Tu código de verificación es: <strong>${codigo}</strong></p>`
      })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.message || `Error HTTP ${resp.status} al enviar correo con Resend`);
    }
    return;
  }

  if (mailTransporter) {
    await Promise.race([
      mailTransporter.sendMail({
        from: process.env.MAIL_FROM || process.env.MAIL_USER,
        to,
        subject: 'Código de verificación - WhatsApp ITP Web',
        text: `Hola ${nombre}, tu código de verificación es: ${codigo}`
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tiempo de espera de correo agotado')), 4000)
      )
    ]);
    return;
  }

  throw new Error('No hay servicio de correo configurado');
}

const PUERTO = process.env.PORT || process.argv[2] || 5001;
const NOMBRE_NODO = `Nodo-${PUERTO}`;

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 4000,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'whatsapp_db',
  waitForConnections: true,
  connectionLimit: 50,
  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  }
});

async function verificarEsquemaBD() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS estados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        usuario_id INT NOT NULL,
        contenido TEXT NULL,
        color_fondo VARCHAR(20) DEFAULT '#005c4b',
        archivo_url VARCHAR(255) NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS estado_vistas (
        estado_id INT NOT NULL,
        usuario_id INT NOT NULL,
        visto_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (estado_id, usuario_id),
        FOREIGN KEY (estado_id) REFERENCES estados(id) ON DELETE CASCADE,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      )
    `);

    try { await db.query('ALTER TABLE usuarios ADD COLUMN correo VARCHAR(150) NULL'); } catch (_) {}
    try { await db.query('ALTER TABLE usuarios ADD UNIQUE INDEX idx_correo_unico (correo)'); } catch (_) {}
    try { await db.query('ALTER TABLE usuarios ADD COLUMN foto_url VARCHAR(255) NULL'); } catch (_) {}
    try { await db.query("ALTER TABLE usuarios ADD COLUMN descripcion VARCHAR(150) DEFAULT '¡Hola! Estoy usando WhatsApp ITP Web.'"); } catch (_) {}
    try { await db.query('ALTER TABLE usuarios ADD UNIQUE INDEX idx_nombre_unico (nombre)'); } catch (_) {}
    try { await db.query('ALTER TABLE chat_miembros ADD COLUMN ultimo_leido_id INT DEFAULT 0'); } catch (_) {}
    try { await db.query('ALTER TABLE mensajes ADD COLUMN leido BOOLEAN DEFAULT FALSE'); } catch (_) {}
    try { await db.query('ALTER TABLE mensajes ADD COLUMN respuesta_a_id INT NULL'); } catch (_) {}
    try { await db.query("ALTER TABLE estados ADD COLUMN color_fondo VARCHAR(20) DEFAULT '#005c4b'"); } catch (_) {}
    await db.query("INSERT IGNORE INTO chats (id, nombre, es_grupo) VALUES (1, 'Grupo ITP', TRUE)");
    await db.query("UPDATE chats SET nombre = 'Grupo ITP' WHERE id = 1 AND nombre = 'Grupo SO2 (Distribuido)'");
  } catch (err) {
    console.error('Aviso verificando esquema BD:', err.message);
  }
}
verificarEsquemaBD();

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `file_${Date.now()}_${cleanName}`);
  }
});
const upload = multer({ storage });
app.use(express.static(path.join(__dirname, 'public')));

const REDIS_URL = process.env.REDIS_URL;
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_TLS = process.env.REDIS_TLS === 'true';

const redisConfig = REDIS_URL
  ? REDIS_URL
  : {
      host: REDIS_HOST,
      port: REDIS_PORT,
      ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
      ...(REDIS_TLS ? { tls: {} } : {})
    };

const pub = new Redis(redisConfig);
const sub = new Redis(redisConfig);

pub.on('error', (err) => {
  console.error('Error en Redis pub:', err.message);
});

sub.on('error', (err) => {
  console.error('Error en Redis sub:', err.message);
});

sub.subscribe('canal_whatsapp_distribuido', 'canal_eventos_whatsapp');
sub.on('message', (channel, messageStr) => {
  try {
    const data = JSON.parse(messageStr);
    if (channel === 'canal_whatsapp_distribuido') {
      io.to(`chat_${data.chatId}`).emit('mensaje_recibido', data);
      io.emit('actualizar_lista_chats', { chatId: data.chatId });
    } else if (channel === 'canal_eventos_whatsapp') {
      if (data.tipo === 'chat_vaciado') {
        io.to(`chat_${data.chatId}`).emit('chat_vaciado', { chatId: data.chatId });
      } else if (data.tipo === 'nuevo_chat') {
        io.emit('actualizar_lista_chats', data);
      } else if (data.tipo === 'mensajes_leidos') {
        io.to(`chat_${data.chatId}`).emit('mensajes_leidos', data);
        io.emit('actualizar_lista_chats', { chatId: data.chatId });
      }
    }
  } catch (err) {
    console.error('Error procesando mensaje de Redis:', err.message);
  }
});

function normalizarTelefono(raw) {
  let tel = (raw || '').trim();
  if (!tel) return '';
  if (!tel.startsWith('+')) {
    const digitos = tel.replace(/\D/g, '');
    tel = digitos.startsWith('52') ? `+${digitos}` : `+52${digitos}`;
  }
  return tel;
}

app.post('/api/auth/solicitar-codigo', async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  const correo = (req.body.correo || '').trim().toLowerCase();
  const telefono = normalizarTelefono(req.body.telefono);

  if (!nombre || !correo || !telefono) {
    return res.status(400).json({ error: 'Ingresa tu nombre de usuario, correo electrónico y número telefónico.' });
  }

  const codigo = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    const [existentes] = await db.query(
      'SELECT id, nombre, telefono, correo FROM usuarios WHERE LOWER(nombre) = LOWER(?) OR telefono = ? OR LOWER(correo) = ?',
      [nombre, telefono, correo]
    );

    if (existentes.length === 0) {
      await db.query(
        'INSERT INTO usuarios (telefono, correo, nombre, codigo_verificacion) VALUES (?, ?, ?, ?)',
        [telefono, correo, nombre, codigo]
      );
    } else if (existentes.length === 1) {
      const usuarioExistente = existentes[0];
      const mismoNombre = usuarioExistente.nombre.toLowerCase() === nombre.toLowerCase();
      const mismoTelefono = usuarioExistente.telefono === telefono;
      const mismoCorreo = (usuarioExistente.correo || '').toLowerCase() === correo;

      if (mismoNombre && mismoTelefono && mismoCorreo) {
        await db.query('UPDATE usuarios SET codigo_verificacion = ? WHERE id = ?', [codigo, usuarioExistente.id]);
      } else if (mismoNombre) {
        return res.status(400).json({ error: 'Ese nombre de usuario ya está ocupado por otra cuenta.' });
      } else if (mismoTelefono) {
        return res.status(400).json({ error: 'Ese número telefónico ya está registrado con otro nombre o correo.' });
      } else {
        return res.status(400).json({ error: 'Ese correo electrónico ya está registrado con otro nombre o teléfono.' });
      }
    } else {
      return res.status(400).json({ error: 'El nombre, teléfono o correo ya están registrados.' });
    }

    try {
      await enviarCorreoVerificacion({ to: correo, nombre, codigo });
      return res.json({ status: 'ok', mensaje: `Código enviado a ${correo}.` });
    } catch (mailErr) {
      console.error('Error enviando correo:', mailErr.message);
      console.log(`🔑 [RESPALDO] Código para ${correo}: ${codigo}`);
      return res.json({
        status: 'ok',
        codigoSimulado: codigo,
        avisoCorreo: `No se pudo enviar el correo (${mailErr.message}). Usa este código:`
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/verificar-codigo', async (req, res) => {
  const correo = (req.body.correo || '').trim().toLowerCase();
  const telefono = normalizarTelefono(req.body.telefono);
  const codigo = (req.body.codigo || '').trim();

  try {
    const [rows] = await db.query(
      'SELECT * FROM usuarios WHERE LOWER(correo) = ? AND telefono = ? AND codigo_verificacion = ?',
      [correo, telefono, codigo]
    );

    if (rows.length > 0) {
      const usuario = rows[0];
      await db.query('UPDATE usuarios SET verificado = TRUE WHERE id = ?', [usuario.id]);
      const [[maxRow]] = await db.query('SELECT COALESCE(MAX(id), 0) AS maxId FROM mensajes WHERE chat_id = 1');
      await db.query(
        'INSERT IGNORE INTO chat_miembros (chat_id, usuario_id, ultimo_leido_id) VALUES (1, ?, ?)',
        [usuario.id, maxRow.maxId]
      );
      res.json({ status: 'ok', usuario });
    } else {
      res.status(400).json({ error: 'Código de verificación incorrecto.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/perfil/foto', upload.single('foto'), async (req, res) => {
  const { usuarioId } = req.body;
  if (!req.file || !usuarioId) return res.status(400).json({ error: 'Falta archivo o usuario' });

  const fotoUrl = `/uploads/${req.file.filename}`;
  try {
    await db.query('UPDATE usuarios SET foto_url = ? WHERE id = ?', [fotoUrl, usuarioId]);
    res.json({ status: 'ok', fotoUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/perfil/descripcion', async (req, res) => {
  const { usuarioId, descripcion } = req.body;
  if (!usuarioId) return res.status(400).json({ error: 'Falta usuario' });

  try {
    await db.query('UPDATE usuarios SET descripcion = ? WHERE id = ?', [descripcion, usuarioId]);
    res.json({ status: 'ok', descripcion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usuarios', async (req, res) => {
  const excludeId = req.query.excludeId || 0;
  try {
    const [rows] = await db.query(
      'SELECT id, nombre, telefono, correo, foto_url, descripcion FROM usuarios WHERE id != ? ORDER BY nombre ASC',
      [excludeId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function formatearPreviewArchivo(tipoArchivo) {
  if (!tipoArchivo) return '📎 Archivo adjunto';
  if (tipoArchivo.startsWith('image/')) return '📷 Foto';
  if (tipoArchivo.startsWith('video/')) return '🎥 Video';
  if (tipoArchivo.startsWith('audio/')) return '🎵 Audio';
  return '📄 Documento';
}

app.get('/api/usuarios/:usuarioId/chats', async (req, res) => {
  const usuarioId = Number(req.params.usuarioId);
  try {
    const [chats] = await db.query(
      `SELECT c.id, c.nombre, c.es_grupo, cm.ultimo_leido_id,
        (SELECT contenido FROM mensajes WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) AS ultimoMensaje,
        (SELECT archivo_url FROM mensajes WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) AS ultimoArchivo,
        (SELECT tipo_archivo FROM mensajes WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) AS ultimoTipoArchivo,
        (SELECT enviado_en FROM mensajes WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) AS ultimaHora,
        (SELECT u.nombre FROM mensajes m JOIN usuarios u ON m.usuario_id = u.id WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultimoRemitente,
        (SELECT COUNT(*) FROM mensajes m WHERE m.chat_id = c.id AND m.id > COALESCE(cm.ultimo_leido_id, 0) AND m.usuario_id != ?) AS noLeidos
       FROM chats c
       JOIN chat_miembros cm ON c.id = cm.chat_id
       WHERE cm.usuario_id = ?
       ORDER BY (ultimaHora IS NULL) ASC, ultimaHora DESC, c.es_grupo DESC, c.id DESC`,
      [usuarioId, usuarioId]
    );

    const resultado = [];
    for (const chat of chats) {
      let textoPreview = chat.ultimoMensaje;
      if (!textoPreview && chat.ultimoArchivo) {
        textoPreview = formatearPreviewArchivo(chat.ultimoTipoArchivo);
      }

      if (chat.es_grupo) {
        const sub = textoPreview
          ? `${chat.ultimoRemitente ? chat.ultimoRemitente + ': ' : ''}${textoPreview}`
          : 'Chat grupal';

        resultado.push({
          id: chat.id,
          nombre: chat.nombre || 'Grupo ITP',
          es_grupo: true,
          foto_url: null,
          subtitulo: sub,
          hora: chat.ultimaHora,
          noLeidos: Number(chat.noLeidos) || 0
        });
      } else {
        const [otros] = await db.query(
          `SELECT u.id, u.nombre, u.telefono, u.correo, u.foto_url, u.descripcion
           FROM chat_miembros cm
           JOIN usuarios u ON cm.usuario_id = u.id
           WHERE cm.chat_id = ? AND u.id != ? LIMIT 1`,
          [chat.id, usuarioId]
        );
        const otro = otros[0] || { nombre: 'Usuario', telefono: '', foto_url: null };
        resultado.push({
          id: chat.id,
          nombre: otro.nombre,
          telefono: otro.telefono,
          es_grupo: false,
          foto_url: otro.foto_url,
          subtitulo: textoPreview || otro.descripcion || 'Chat privado',
          hora: chat.ultimaHora,
          noLeidos: Number(chat.noLeidos) || 0
        });
      }
    }
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chats/:chatId/leer', async (req, res) => {
  const chatId = Number(req.params.chatId);
  const usuarioId = Number(req.body.usuarioId);
  if (!chatId || !usuarioId) return res.status(400).json({ error: 'Datos incompletos' });

  try {
    const [[maxRow]] = await db.query('SELECT COALESCE(MAX(id), 0) AS maxId FROM mensajes WHERE chat_id = ?', [chatId]);

    await db.query(
      'UPDATE chat_miembros SET ultimo_leido_id = GREATEST(COALESCE(ultimo_leido_id, 0), ?) WHERE chat_id = ? AND usuario_id = ?',
      [maxRow.maxId, chatId, usuarioId]
    );

    const [updateRes] = await db.query(
      'UPDATE mensajes SET leido = TRUE WHERE chat_id = ? AND usuario_id != ? AND leido = FALSE',
      [chatId, usuarioId]
    );

    if (updateRes.affectedRows > 0) {
      pub.publish('canal_eventos_whatsapp', JSON.stringify({
        tipo: 'mensajes_leidos',
        chatId,
        lectorId: usuarioId
      }));
    }

    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chats/privado', async (req, res) => {
  const { usuario1Id, usuario2Id } = req.body;
  if (!usuario1Id || !usuario2Id) return res.status(400).json({ error: 'Faltan usuarios' });

  try {
    const [existentes] = await db.query(
      `SELECT c.id FROM chats c
       JOIN chat_miembros cm1 ON c.id = cm1.chat_id AND cm1.usuario_id = ?
       JOIN chat_miembros cm2 ON c.id = cm2.chat_id AND cm2.usuario_id = ?
       WHERE c.es_grupo = FALSE LIMIT 1`,
      [usuario1Id, usuario2Id]
    );

    if (existentes.length > 0) {
      return res.json({ status: 'ok', chatId: existentes[0].id });
    }

    const [insertChat] = await db.query('INSERT INTO chats (nombre, es_grupo) VALUES (NULL, FALSE)');
    const nuevoChatId = insertChat.insertId;

    await db.query('INSERT INTO chat_miembros (chat_id, usuario_id, ultimo_leido_id) VALUES (?, ?, 0), (?, ?, 0)', [
      nuevoChatId, usuario1Id,
      nuevoChatId, usuario2Id
    ]);

    pub.publish('canal_eventos_whatsapp', JSON.stringify({ tipo: 'nuevo_chat', chatId: nuevoChatId }));
    res.json({ status: 'ok', chatId: nuevoChatId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chats/:chatId/info', async (req, res) => {
  try {
    const [chatRows] = await db.query('SELECT * FROM chats WHERE id = ?', [req.params.chatId]);
    const [miembros] = await db.query(
      `SELECT u.id, u.nombre, u.telefono, u.correo, u.foto_url, u.descripcion
       FROM chat_miembros cm
       JOIN usuarios u ON cm.usuario_id = u.id
       WHERE cm.chat_id = ?`,
      [req.params.chatId]
    );
    res.json({ chat: chatRows[0] || {}, miembros, nodo: NOMBRE_NODO });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chats/:chatId/archivos', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT m.id, m.contenido, m.archivo_url, m.tipo_archivo, m.enviado_en, u.nombre AS usuarioNombre
       FROM mensajes m
       JOIN usuarios u ON m.usuario_id = u.id
       WHERE m.chat_id = ? AND (m.archivo_url IS NOT NULL OR m.contenido LIKE '%http://%' OR m.contenido LIKE '%https://%')
       ORDER BY m.enviado_en DESC`,
      [req.params.chatId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/chats/:chatId/mensajes', async (req, res) => {
  try {
    await db.query('DELETE FROM mensajes WHERE chat_id = ?', [req.params.chatId]);
    await db.query('UPDATE chat_miembros SET ultimo_leido_id = 0 WHERE chat_id = ?', [req.params.chatId]);
    pub.publish('canal_eventos_whatsapp', JSON.stringify({ tipo: 'chat_vaciado', chatId: Number(req.params.chatId) }));
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chats/:chatId/mensajes', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT m.*,
              u.nombre AS usuarioNombre,
              u.telefono,
              u.foto_url AS usuarioFoto,
              rm.contenido AS replyTexto,
              rm.archivo_url AS replyArchivoUrl,
              rm.tipo_archivo AS replyTipoArchivo,
              ru.nombre AS replyUsuarioNombre
       FROM mensajes m
       JOIN usuarios u ON m.usuario_id = u.id
       LEFT JOIN mensajes rm ON m.respuesta_a_id = rm.id
       LEFT JOIN usuarios ru ON rm.usuario_id = ru.id
       WHERE m.chat_id = ?
       ORDER BY m.id ASC`,
      [req.params.chatId]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sin archivo' });
  res.json({ url: `/uploads/${req.file.filename}`, mimetype: req.file.mimetype });
});

app.post('/api/estados', upload.single('file'), async (req, res) => {
  const { usuarioId, texto, colorFondo } = req.body;
  const archivoUrl = req.file ? `/uploads/${req.file.filename}` : null;

  if (!usuarioId || (!texto && !archivoUrl)) {
    return res.status(400).json({ error: 'Agrega un texto o una imagen/video.' });
  }

  try {
    await db.query(
      'INSERT INTO estados (usuario_id, contenido, color_fondo, archivo_url) VALUES (?, ?, ?, ?)',
      [usuarioId, texto || '', colorFondo || '#005c4b', archivoUrl]
    );
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/estados', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.*, u.nombre AS usuarioNombre, u.foto_url AS usuarioFoto 
       FROM estados e 
       JOIN usuarios u ON e.usuario_id = u.id 
       WHERE e.creado_en >= NOW() - INTERVAL 24 HOUR 
       ORDER BY e.creado_en ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/estados/:estadoId/visto', async (req, res) => {
  const estadoId = Number(req.params.estadoId);
  const { usuarioId } = req.body;
  if (!estadoId || !usuarioId) return res.status(400).json({ error: 'Datos incompletos' });

  try {
    const [[estado]] = await db.query('SELECT usuario_id FROM estados WHERE id = ?', [estadoId]);
    if (estado && Number(estado.usuario_id) === Number(usuarioId)) {
      return res.json({ status: 'ok', ignorado: 'es_propio' });
    }

    await db.query(
      'INSERT IGNORE INTO estado_vistas (estado_id, usuario_id) VALUES (?, ?)',
      [estadoId, usuarioId]
    );
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error en /visto:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/estados/:estadoId/vistas', async (req, res) => {
  const estadoId = Number(req.params.estadoId);
  if (!estadoId || isNaN(estadoId)) {
    return res.status(400).json({ error: 'ID de estado inválido' });
  }

  try {
    const [rows] = await db.query(
      `SELECT u.id, u.nombre, u.foto_url, ev.visto_en
       FROM estado_vistas ev
       JOIN usuarios u ON ev.usuario_id = u.id
       WHERE ev.estado_id = ?
       ORDER BY ev.visto_en DESC`,
      [estadoId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener vistas de BD:', err);
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  socket.emit('info_nodo', { nodo: NOMBRE_NODO, puerto: PUERTO });

  socket.on('registrar_sesion', async (usuarioId) => {
    if (!usuarioId) return;
    const uid = Number(usuarioId);
    socket.usuarioIdRegistrado = uid;
    socket.join(`usuario_${uid}`);
  });

  socket.on('join_chat', (chatId) => {
    socket.join(`chat_${chatId}`);
  });

  socket.on('nuevo_mensaje', async (data) => {
    const respuestaAId = data.respuestaAId ? Number(data.respuestaAId) : null;
    const payload = {
      id: null,
      chatId: Number(data.chatId) || 1,
      usuarioId: Number(data.usuarioId),
      usuarioNombre: data.usuarioNombre,
      usuarioFoto: data.usuarioFoto || null,
      telefono: data.telefono,
      texto: data.texto || '',
      archivoUrl: data.archivoUrl || null,
      tipoArchivo: data.tipoArchivo || null,
      respuestaAId,
      replyInfo: data.replyInfo || null,
      leido: false,
      nodoOrigen: NOMBRE_NODO,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    try {
      const [result] = await db.query(
        'INSERT INTO mensajes (chat_id, usuario_id, contenido, archivo_url, tipo_archivo, respuesta_a_id, leido) VALUES (?, ?, ?, ?, ?, ?, FALSE)',
        [payload.chatId, payload.usuarioId, payload.texto, payload.archivoUrl, payload.tipoArchivo, payload.respuestaAId]
      );
      payload.id = result.insertId;

      await db.query(
        'UPDATE chat_miembros SET ultimo_leido_id = GREATEST(COALESCE(ultimo_leido_id, 0), ?) WHERE chat_id = ? AND usuario_id = ?',
        [payload.id, payload.chatId, payload.usuarioId]
      );
    } catch (err) {
      console.error('Error guardando mensaje en MySQL:', err);
    }

    pub.publish('canal_whatsapp_distribuido', JSON.stringify(payload));
  });
});

server.listen(PUERTO, '0.0.0.0', () => {
  console.log(`🚀 [${NOMBRE_NODO}] Servidor activo en http://0.0.0.0:${PUERTO}`);
});