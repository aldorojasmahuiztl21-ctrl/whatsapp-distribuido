let socket = null;
let usuarioActual = null;
let chatIdActual = 1;
let chatsUsuario = [];
let usuariosRegistradosCache = [];
let colorEstadoSeleccionado = '#005c4b';

let estadosGrupoActual = [];
let estadoIndiceActual = 0;
let estadoTimer = null;
let estadoInterval = null;
const usuariosEstadosVistos = new Set();
let estadoActualEnVisor = null;

const mensajesCache = new Map();
let mensajeRespondiendo = null;
let mensajeMenuActivoId = null;

let mediaRecorder = null;
let audioChunks = [];
let audioStream = null;
let recordingInterval = null;
let recordingSeconds = 0;
let enviarAlDetener = false;

window.addEventListener('storage', (event) => {
  if (usuarioActual && event.key === `sesion_activa_user_${usuarioActual.id}`) {
    const tokenNuevo = event.newValue;
    const tokenActual = sessionStorage.getItem('token_pestana_actual');
    
    if (tokenNuevo && tokenNuevo !== tokenActual) {
      alert('Ya has iniciado sesión en una pestaña nueva. Esta sesión se cerrará.');
      usuarioActual = null;
      if (socket) socket.disconnect();
      location.reload();
    }
  }
});

function inicializarSocket() {
  if (!usuarioActual) return;
  if (socket) socket.disconnect();

  socket = io();

  socket.on('info_nodo', data => {
    const badge = document.getElementById('nodo-badge');
    if (badge) badge.innerText = `${data.nodo}`;
  });

  socket.emit('registrar_sesion', usuarioActual.id);

  socket.on('mensaje_recibido', async data => {
    const esChatAbierto = Number(data.chatId) === Number(chatIdActual);
    const esDeOtro = usuarioActual && Number(data.usuarioId) !== Number(usuarioActual.id);

    if (esChatAbierto) {
      renderizarMensaje(data);
      if (esDeOtro && !document.hidden) {
        await marcarChatComoLeido(chatIdActual);
        return;
      }
    }
    cargarListaChats();
  });

  socket.on('mensajes_leidos', data => {
    if (Number(data.chatId) === Number(chatIdActual)) {
      document.querySelectorAll('#chat-box .check-mark').forEach(el => {
        el.classList.add('read');
      });
    }
  });

  socket.on('actualizar_lista_chats', () => {
    cargarListaChats();
  });

  socket.on('chat_vaciado', data => {
    if (Number(data.chatId) === Number(chatIdActual)) {
      document.getElementById('chat-box').innerHTML = '';
      mensajesCache.clear();
    }
    cargarListaChats();
  });
}

// --- AUTENTICACIÓN Y CIERRE DE SESIÓN ---

async function solicitarCodigo() {
  const nombre = document.getElementById('reg-nombre').value.trim();
  const correo = document.getElementById('reg-correo').value.trim();
  const telefono = document.getElementById('reg-telefono').value.trim();
  const errorBox = document.getElementById('auth-error-1');
  errorBox.style.display = 'none';

  if (!nombre || !correo || !telefono) {
    errorBox.innerText = 'Completa tu nombre, correo electrónico y teléfono.';
    errorBox.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/auth/solicitar-codigo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, correo, telefono })
    });
    const data = await res.json();

    if (res.ok && data.status === 'ok') {
      document.getElementById('step-1').style.display = 'none';
      document.getElementById('step-2').style.display = 'block';
      if (data.avisoCorreo && data.codigoSimulado) {
        document.getElementById('code-hint').innerText = `${data.avisoCorreo} ${data.codigoSimulado}`;
      } else {
        document.getElementById('code-hint').innerText = data.codigoSimulado
          ? `Código generado: ${data.codigoSimulado}`
          : (data.mensaje || 'Revisa tu correo electrónico para obtener el código.');
      }
    } else {
      errorBox.innerText = data.error || 'No se pudo continuar con esos datos.';
      errorBox.style.display = 'block';
    }
  } catch (err) {
    errorBox.innerText = 'Error de conexión con el servidor.';
    errorBox.style.display = 'block';
  }
}

async function verificarCodigo() {
  const correo = document.getElementById('reg-correo').value.trim();
  const telefono = document.getElementById('reg-telefono').value.trim();
  const codigo = document.getElementById('reg-codigo').value.trim();
  const errorBox = document.getElementById('auth-error-2');
  errorBox.style.display = 'none';

  try {
    const res = await fetch('/api/auth/verificar-codigo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, telefono, codigo })
    });
    const data = await res.json();

    if (res.ok && data.status === 'ok') {
      usuarioActual = data.usuario;

      const claveStorage = `sesion_activa_user_${usuarioActual.id}`;
      const tokenPestanaActual = Math.random().toString();

      sessionStorage.setItem('token_pestana_actual', tokenPestanaActual);
      localStorage.setItem(claveStorage, tokenPestanaActual);

      window.addEventListener('beforeunload', () => {
        if (localStorage.getItem(claveStorage) === tokenPestanaActual) {
          localStorage.removeItem(claveStorage);
        }
      });

      document.getElementById('auth-modal').style.display = 'none';

      inicializarSocket();
      actualizarUIUsuario();
      await cargarListaChats();
      await seleccionarChat(1);
      cargarEstados();
    } else {
      errorBox.innerText = data.error || 'Código inválido.';
      errorBox.style.display = 'block';
    }
  } catch (err) {
    errorBox.innerText = 'Error al verificar el código.';
    errorBox.style.display = 'block';
  }
}

function cerrarSesion() {
  if (!usuarioActual) return;

  const claveStorage = `sesion_activa_user_${usuarioActual.id}`;
  localStorage.removeItem(claveStorage);
  sessionStorage.removeItem('token_pestana_actual');

  if (socket) {
    socket.disconnect();
  }

  usuarioActual = null;
  location.reload();
}

// --- PERFIL ---

function actualizarUIUsuario() {
  if (!usuarioActual) return;
  const inicial = usuarioActual.nombre[0].toUpperCase();
  const miniAvatar = document.getElementById('user-avatar-mini');
  const bigAvatar = document.getElementById('profile-avatar-big');

  if (usuarioActual.foto_url) {
    miniAvatar.innerHTML = `<img src="${usuarioActual.foto_url}">`;
    bigAvatar.innerHTML = `<img src="${usuarioActual.foto_url}">`;
  } else {
    miniAvatar.innerText = inicial;
    bigAvatar.innerText = inicial;
  }

  document.getElementById('profile-name-text').innerText = usuarioActual.nombre;
  document.getElementById('profile-email-text').innerText = usuarioActual.correo || '-';
  document.getElementById('profile-phone-text').innerText = usuarioActual.telefono;
  document.getElementById('profile-desc-input').value = usuarioActual.descripcion || '¡Hola! Estoy usando WhatsApp Web Distribuido.';
}

async function subirFotoPerfil() {
  const input = document.getElementById('profilePhotoInput');
  if (!input.files || input.files.length === 0 || !usuarioActual) return;

  const formData = new FormData();
  formData.append('foto', input.files[0]);
  formData.append('usuarioId', usuarioActual.id);

  try {
    const res = await fetch('/api/perfil/foto', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.status === 'ok') {
      usuarioActual.foto_url = data.fotoUrl;
      actualizarUIUsuario();
      cargarEstados();
    }
  } catch (err) {
    console.error('Error subiendo foto:', err);
  }
  input.value = '';
}

async function guardarDescripcionPerfil() {
  if (!usuarioActual) return;
  const descripcion = document.getElementById('profile-desc-input').value.trim();

  try {
    const res = await fetch('/api/perfil/descripcion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuarioId: usuarioActual.id, descripcion })
    });
    const data = await res.json();
    if (data.status === 'ok') {
      usuarioActual.descripcion = data.descripcion;
      const btn = document.getElementById('btn-save-desc');
      btn.innerText = 'OK';
      setTimeout(() => (btn.innerText = '✓'), 1500);
    }
  } catch (err) {
    console.error('Error guardando descripción:', err);
  }
}

// --- CHATS E INSIGNIAS ---

async function cargarListaChats() {
  if (!usuarioActual) return;
  try {
    const res = await fetch(`/api/usuarios/${usuarioActual.id}/chats`);
    chatsUsuario = await res.json();
    renderizarListaChats(chatsUsuario);
    actualizarInsigniasLaterales();
  } catch (err) {
    console.error('Error cargando chats:', err);
  }
}

function actualizarInsigniasLaterales() {
  let totalNoLeidos = 0;
  chatsUsuario.forEach(c => {
    totalNoLeidos += Number(c.noLeidos) || 0;
  });

  const badgeChats = document.getElementById('chats-total-badge');
  if (badgeChats) {
    if (totalNoLeidos > 0) {
      badgeChats.innerText = totalNoLeidos > 99 ? '99+' : totalNoLeidos;
      badgeChats.classList.remove('hidden');
    } else {
      badgeChats.classList.add('hidden');
    }
  }
}

function renderizarListaChats(lista) {
  const contenedor = document.getElementById('lista-chats');
  contenedor.innerHTML = '';

  lista.forEach(chat => {
    const item = document.createElement('div');
    item.className = `list-item ${Number(chat.id) === Number(chatIdActual) ? 'active' : ''}`;
    item.onclick = () => seleccionarChat(chat.id);

    const avatarHtml = chat.foto_url
      ? `<img src="${chat.foto_url}">`
      : (chat.es_grupo ? 'SO2' : chat.nombre[0].toUpperCase());

    const tieneNoLeidos = Number(chat.noLeidos) > 0;
    const horaTexto = chat.hora
      ? new Date(chat.hora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    item.innerHTML = `
      <div class="avatar">${avatarHtml}</div>
      <div class="item-details">
        <div class="item-title">${chat.nombre}</div>
        <div class="item-subtitle ${tieneNoLeidos ? 'unread' : ''}">${chat.subtitulo || ''}</div>
      </div>
      <div class="item-meta">
        ${horaTexto ? `<span class="chat-time ${tieneNoLeidos ? 'unread' : ''}">${horaTexto}</span>` : ''}
        ${tieneNoLeidos ? `<span class="unread-badge">${chat.noLeidos}</span>` : ''}
      </div>
    `;
    contenedor.appendChild(item);
  });
}

function filtrarChatsLista() {
  const q = document.getElementById('buscar-chat-input').value.toLowerCase();
  const filtrados = chatsUsuario.filter(c => c.nombre.toLowerCase().includes(q));
  renderizarListaChats(filtrados);
}

async function marcarChatComoLeido(chatId) {
  if (!usuarioActual || !chatId) return;
  try {
    await fetch(`/api/chats/${chatId}/leer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuarioId: usuarioActual.id })
    });
    await cargarListaChats();
  } catch (err) {
    console.error('Error marcando leído:', err);
  }
}

async function seleccionarChat(id) {
  chatIdActual = Number(id);
  cancelarRespuesta();
  cerrarMenuMensaje();
  if (socket) socket.emit('join_chat', chatIdActual);

  await marcarChatComoLeido(chatIdActual);

  const info = chatsUsuario.find(c => Number(c.id) === chatIdActual);
  if (info) {
    document.getElementById('chat-header-nombre').innerText = info.nombre;
    document.getElementById('chat-header-sub').innerText = info.es_grupo ? 'Multi-nodo Redis' : (info.telefono || 'Chat privado');
    const headerAvatar = document.getElementById('chat-header-avatar');
    if (info.foto_url) {
      headerAvatar.innerHTML = `<img src="${info.foto_url}">`;
    } else {
      headerAvatar.innerText = info.es_grupo ? 'SO2' : info.nombre[0].toUpperCase();
    }
  }

  renderizarListaChats(chatsUsuario);
  await cargarHistorial();
}

async function abrirModalNuevoChat() {
  if (!usuarioActual) return;
  document.getElementById('modal-nuevo-chat').classList.add('active');
  document.getElementById('buscar-usuario-input').value = '';

  try {
    const res = await fetch(`/api/usuarios?excludeId=${usuarioActual.id}`);
    usuariosRegistradosCache = await res.json();
    renderizarUsuariosModal(usuariosRegistradosCache);
  } catch (err) {
    console.error('Error cargando usuarios:', err);
  }
}

function renderizarUsuariosModal(lista) {
  const contenedor = document.getElementById('lista-usuarios-registrados');
  contenedor.innerHTML = '';

  if (lista.length === 0) {
    contenedor.innerHTML = '<div style="padding:16px; text-align:center; color:#8696a0;">No hay otros usuarios registrados.</div>';
    return;
  }

  lista.forEach(u => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.onclick = () => iniciarChatPrivadoCon(u.id);

    const avatarHtml = u.foto_url ? `<img src="${u.foto_url}">` : u.nombre[0].toUpperCase();
    row.innerHTML = `
      <div class="avatar">${avatarHtml}</div>
      <div class="item-details">
        <div class="item-title"><span>${u.nombre}</span></div>
        <div class="item-subtitle">${u.telefono} • ${u.descripcion || ''}</div>
      </div>
    `;
    contenedor.appendChild(row);
  });
}

function filtrarUsuariosModal() {
  const q = document.getElementById('buscar-usuario-input').value.toLowerCase();
  const filtrados = usuariosRegistradosCache.filter(
    u => u.nombre.toLowerCase().includes(q) || u.telefono.toLowerCase().includes(q)
  );
  renderizarUsuariosModal(filtrados);
}

async function iniciarChatPrivadoCon(otroUsuarioId) {
  try {
    const res = await fetch('/api/chats/privado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario1Id: usuarioActual.id, usuario2Id: otroUsuarioId })
    });
    const data = await res.json();
    if (data.status === 'ok') {
      cerrarModal('modal-nuevo-chat');
      await cargarListaChats();
      seleccionarChat(data.chatId);
    }
  } catch (err) {
    console.error('Error chat privado:', err);
  }
}

// --- MENSAJES ---

function escaparHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function obtenerTextoResumenMensaje(msg) {
  if (msg.texto) return msg.texto;
  const mime = msg.tipoArchivo || '';
  if (mime.startsWith('image/')) return '📷 Foto';
  if (mime.startsWith('video/')) return '🎥 Video';
  if (mime.startsWith('audio/')) return '🎤 Nota de voz / Audio';
  if (msg.archivoUrl) return '📄 Documento adjunto';
  return 'Mensaje';
}

function abrirMenuMensaje(event, msgId) {
  event.stopPropagation();
  const popup = document.getElementById('msg-action-popup');

  if (mensajeMenuActivoId === Number(msgId) && popup.style.display === 'flex') {
    cerrarMenuMensaje();
    return;
  }

  cerrarMenuMensaje();
  mensajeMenuActivoId = Number(msgId);

  const btn = event.currentTarget;
  btn.classList.add('active');

  popup.style.display = 'flex';
  const rect = btn.getBoundingClientRect();
  const popupWidth = 170;
  const popupHeight = 132;

  let left = rect.left - popupWidth + 24;
  if (left < 70) left = rect.left;
  if (left + popupWidth > window.innerWidth - 12) {
    left = window.innerWidth - popupWidth - 12;
  }

  let top = rect.bottom + 4;
  if (top + popupHeight > window.innerHeight - 70) {
    top = rect.top - popupHeight - 4;
  }

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function cerrarMenuMensaje() {
  mensajeMenuActivoId = null;
  const popup = document.getElementById('msg-action-popup');
  if (popup) popup.style.display = 'none';
  document.querySelectorAll('.msg-chevron.active').forEach(el => el.classList.remove('active'));
}

function accionResponderPopup() {
  if (!mensajeMenuActivoId) return;
  const msgId = mensajeMenuActivoId;
  cerrarMenuMensaje();
  prepararRespuesta(msgId);
}

function prepararRespuesta(msgId) {
  const msg = mensajesCache.get(Number(msgId));
  if (!msg) return;

  const esMio = usuarioActual && Number(msg.usuarioId) === Number(usuarioActual.id);
  const nombreMostrar = esMio ? 'You' : msg.usuarioNombre;
  const textoResumen = obtenerTextoResumenMensaje(msg);

  mensajeRespondiendo = {
    id: Number(msg.id),
    usuarioNombre: msg.usuarioNombre,
    textoResumen
  };

  document.getElementById('reply-preview-sender').innerText = nombreMostrar;
  document.getElementById('reply-preview-text').innerText = textoResumen;
  document.getElementById('reply-preview-bar').style.display = 'flex';
  document.getElementById('mensaje').focus();
}

function cancelarRespuesta() {
  mensajeRespondiendo = null;
  const bar = document.getElementById('reply-preview-bar');
  if (bar) bar.style.display = 'none';
}

function accionReenviarPopup() {
  if (!mensajeMenuActivoId || !usuarioActual) return;
  const msgId = mensajeMenuActivoId;
  cerrarMenuMensaje();

  const msg = mensajesCache.get(Number(msgId));
  if (!msg) return;

  const contenedor = document.getElementById('lista-chats-reenvio');
  if (!contenedor) return;
  
  contenedor.innerHTML = '';
  document.getElementById('modal-reenviar-chat').classList.add('active');

  if (!chatsUsuario || chatsUsuario.length === 0) {
    fetch(`/api/usuarios/${usuarioActual.id}/chats`)
      .then(res => res.json())
      .then(data => {
        chatsUsuario = data;
        poblarListaReenvio(contenedor, msg);
      })
      .catch(() => {
        contenedor.innerHTML = '<div style="padding:16px; text-align:center; color:#8696a0;">No se pudieron cargar los chats.</div>';
      });
  } else {
    poblarListaReenvio(contenedor, msg);
  }
}

function poblarListaReenvio(contenedor, msg) {
  if (chatsUsuario.length === 0) {
    contenedor.innerHTML = '<div style="padding:16px; text-align:center; color:#8696a0;">No hay chats disponibles.</div>';
    return;
  }

  chatsUsuario.forEach(chat => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.onclick = () => ejecutarReenvioMensaje(chat.id, msg);

    const avatarHtml = chat.foto_url
      ? `<img src="${chat.foto_url}">`
      : (chat.es_grupo ? 'SO2' : chat.nombre[0].toUpperCase());

    row.innerHTML = `
      <div class="avatar">${avatarHtml}</div>
      <div class="item-details">
        <div class="item-title">${escaparHtml(chat.nombre)}</div>
        <div class="item-subtitle">${chat.es_grupo ? 'Grupo' : 'Chat privado'}</div>
      </div>
    `;
    contenedor.appendChild(row);
  });
}

function ejecutarReenvioMensaje(destinoChatId, msg) {
  cerrarModal('modal-reenviar-chat');

  if (socket) {
    socket.emit('nuevo_mensaje', {
      chatId: Number(destinoChatId),
      usuarioId: usuarioActual.id,
      usuarioNombre: usuarioActual.nombre,
      usuarioFoto: usuarioActual.foto_url || null,
      telefono: usuarioActual.telefono,
      texto: msg.texto ? `[Reenviado] ${msg.texto}` : '',
      archivoUrl: msg.archivoUrl || msg.archivo_url || null,
      tipoArchivo: msg.tipoArchivo || msg.tipo_archivo || null,
      respuestaAId: null,
      replyInfo: null
    });
  }

  seleccionarChat(destinoChatId);
}

function accionCopiarPopup() {
  if (!mensajeMenuActivoId) return;
  const msg = mensajesCache.get(Number(mensajeMenuActivoId));
  cerrarMenuMensaje();
  if (msg && msg.texto && navigator.clipboard) {
    navigator.clipboard.writeText(msg.texto).catch(() => {});
  }
}

function scrollToMensaje(msgId) {
  const row = document.getElementById(`msg-row-${msgId}`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('highlight');
  setTimeout(() => row.classList.remove('highlight'), 1400);
}

async function cargarHistorial() {
  try {
    const res = await fetch(`/api/chats/${chatIdActual}/mensajes`);
    const mensajes = await res.json();
    const box = document.getElementById('chat-box');
    box.innerHTML = '';
    mensajesCache.clear();

    mensajes.forEach(msg => {
      let replyInfo = null;
      if (msg.respuesta_a_id) {
        replyInfo = {
          id: Number(msg.respuesta_a_id),
          usuarioNombre: msg.replyUsuarioNombre || 'Usuario',
          textoResumen: msg.replyTexto || obtenerTextoResumenMensaje({
            texto: msg.replyTexto,
            archivoUrl: msg.replyArchivoUrl,
            tipoArchivo: msg.replyTipoArchivo
          }),
          archivoUrl: msg.replyArchivoUrl || null
        };
      }

      renderizarMensaje({
        id: Number(msg.id),
        chatId: msg.chat_id,
        usuarioId: msg.usuario_id,
        usuarioNombre: msg.usuarioNombre,
        telefono: msg.telefono,
        texto: msg.contenido,
        archivoUrl: msg.archivo_url,
        tipoArchivo: msg.tipo_archivo,
        respuestaAId: msg.respuesta_a_id ? Number(msg.respuesta_a_id) : null,
        replyInfo,
        leido: Boolean(msg.leido),
        timestamp: new Date(msg.enviado_en).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    });
  } catch (err) {
    console.error('Error historial:', err);
  }
}

function renderizarMensaje(data) {
  const box = document.getElementById('chat-box');
  const msgId = Number(data.id);
  if (msgId) mensajesCache.set(msgId, data);

  const miId = usuarioActual ? Number(usuarioActual.id) : null;
  const emisorId = data.usuarioId !== undefined ? Number(data.usuarioId) : Number(data.usuario_id);
  const esMio = miId !== null && !isNaN(emisorId) && miId === emisorId;
  const estaLeido = Boolean(data.leido);

  const msgRow = document.createElement('div');
  msgRow.className = `msg-row ${esMio ? 'sent' : 'received'}`;
  if (msgId) msgRow.id = `msg-row-${msgId}`;

  let quotedHtml = '';
  if (data.replyInfo && data.replyInfo.id) {
    const esAutorPropio = usuarioActual && data.replyInfo.usuarioNombre === usuarioActual.nombre;
    const autorCita = esAutorPropio ? 'You' : escaparHtml(data.replyInfo.usuarioNombre);
    
    let miniMedia = '';
    if (data.replyInfo.archivoUrl) {
      miniMedia = `<div style="font-size:11px; color:#00a884; margin-top:2px;">📷 Archivo multimedia</div>`;
    }

    quotedHtml = `
      <div class="quoted-msg-box" onclick="scrollToMensaje(${data.replyInfo.id})">
        <div class="quoted-msg-sender">${autorCita}</div>
        <div class="quoted-msg-text">${escaparHtml(data.replyInfo.textoResumen)}</div>
        ${miniMedia}
      </div>
    `;
  }

  let mediaHtml = '';
  if (data.archivoUrl) {
    const mime = data.tipoArchivo || '';
    if (mime.startsWith('image/')) {
      mediaHtml = `<div class="media-box"><img src="${data.archivoUrl}" /></div>`;
    } else if (mime.startsWith('video/')) {
      mediaHtml = `<div class="media-box"><video controls src="${data.archivoUrl}"></video></div>`;
    } else if (mime.startsWith('audio/')) {
      mediaHtml = `<div class="audio-box"><audio controls src="${data.archivoUrl}"></audio></div>`;
    } else {
      const nombreArchivo = data.archivoUrl.split('_').slice(2).join('_') || 'Documento adjunto';
      mediaHtml = `
        <div class="media-box">
          <a href="${data.archivoUrl}" target="_blank">
            <span>📄</span>
            <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escaparHtml(nombreArchivo)}</span>
            <span style="color:#00a884;">⬇</span>
          </a>
        </div>`;
    }
  }

  msgRow.innerHTML = `
    <div class="msg-wrapper">
      <div class="msg-bubble" ondblclick="${msgId ? `prepararRespuesta(${msgId})` : ''}">
        ${msgId ? `<button class="msg-chevron" onclick="abrirMenuMensaje(event, ${msgId})" title="Opciones">⌄</button>` : ''}
        ${!esMio ? `<div class="msg-sender">${escaparHtml(data.usuarioNombre)} ${data.nodoOrigen ? `<span style="font-size:10px; color:#8696a0;">[${data.nodoOrigen}]</span>` : ''}</div>` : ''}
        ${quotedHtml}
        ${data.texto ? `<div>${escaparHtml(data.texto)}</div>` : ''}
        ${mediaHtml}
        <div class="msg-footer">
          <span class="msg-time">${data.timestamp}</span>
          ${esMio ? `<span class="check-mark ${estaLeido ? 'read' : ''}">✓✓</span>` : ''}
        </div>
      </div>
    </div>
  `;

  box.appendChild(msgRow);
  box.scrollTop = box.scrollHeight;
}

function enviarMensaje() {
  const input = document.getElementById('mensaje');
  if (input.value.trim() !== '' && usuarioActual && socket) {
    socket.emit('nuevo_mensaje', {
      chatId: chatIdActual,
      usuarioId: usuarioActual.id,
      usuarioNombre: usuarioActual.nombre,
      usuarioFoto: usuarioActual.foto_url || null,
      telefono: usuarioActual.telefono,
      texto: input.value.trim(),
      respuestaAId: mensajeRespondiendo ? mensajeRespondiendo.id : null,
      replyInfo: mensajeRespondiendo ? { ...mensajeRespondiendo } : null
    });
    input.value = '';
    cancelarRespuesta();
  }
}

async function subirArchivo() {
  const fileInput = document.getElementById('fileInput');
  if (fileInput.files.length === 0 || !usuarioActual) return;

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.url && socket) {
      socket.emit('nuevo_mensaje', {
        chatId: chatIdActual,
        usuarioId: usuarioActual.id,
        usuarioNombre: usuarioActual.nombre,
        usuarioFoto: usuarioActual.foto_url || null,
        telefono: usuarioActual.telefono,
        texto: '',
        archivoUrl: data.url,
        tipoArchivo: data.mimetype,
        respuestaAId: mensajeRespondiendo ? mensajeRespondiendo.id : null,
        replyInfo: mensajeRespondiendo ? { ...mensajeRespondiendo } : null
      });
      cancelarRespuesta();
    }
  } catch (err) {
    console.error('Error archivo:', err);
  }
  fileInput.value = '';
}

// --- NOTAS DE VOZ ---

async function iniciarGrabacionAudio() {
  if (!usuarioActual) return;
  if (mediaRecorder && mediaRecorder.state === 'recording') return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Tu navegador bloqueó el micrófono.');
    return;
  }

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
    const extension = mimeType.includes('webm') ? 'webm' : 'ogg';

    mediaRecorder = new MediaRecorder(audioStream, { mimeType });
    audioChunks = [];
    enviarAlDetener = false;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      if (audioStream) audioStream.getTracks().forEach(t => t.stop());
      clearInterval(recordingInterval);

      if (!enviarAlDetener || audioChunks.length === 0) return;

      const audioBlob = new Blob(audioChunks, { type: mimeType });
      const formData = new FormData();
      formData.append('file', audioBlob, `nota_de_voz.${extension}`);

      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();

        if (data.url && socket) {
          socket.emit('nuevo_mensaje', {
            chatId: chatIdActual,
            usuarioId: usuarioActual.id,
            usuarioNombre: usuarioActual.nombre,
            usuarioFoto: usuarioActual.foto_url || null,
            telefono: usuarioActual.telefono,
            texto: '',
            archivoUrl: data.url,
            tipoArchivo: data.mimetype,
            respuestaAId: mensajeRespondiendo ? mensajeRespondiendo.id : null,
            replyInfo: mensajeRespondiendo ? { ...mensajeRespondiendo } : null
          });
          cancelarRespuesta();
        }
      } catch (err) {
        console.error('Error audio:', err);
      }
    };

    mediaRecorder.start();
    document.getElementById('normal-input-controls').style.display = 'none';
    document.getElementById('recording-controls').style.display = 'flex';
    recordingSeconds = 0;
    document.getElementById('recording-timer').innerText = '00:00';

    recordingInterval = setInterval(() => {
      recordingSeconds++;
      const min = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
      const sec = String(recordingSeconds % 60).padStart(2, '0');
      document.getElementById('recording-timer').innerText = `${min}:${sec}`;
    }, 1000);
  } catch (err) {
    alert('No se pudo acceder al micrófono.');
  }
}

function cancelarGrabacionAudio() {
  enviarAlDetener = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  restaurarBarraNormal();
}

function detenerYEnviarAudio() {
  enviarAlDetener = true;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  restaurarBarraNormal();
}

function restaurarBarraNormal() {
  clearInterval(recordingInterval);
  document.getElementById('recording-controls').style.display = 'none';
  document.getElementById('normal-input-controls').style.display = 'flex';
}

// --- ESTADOS ---

function abrirModalNuevoEstado() {
  document.getElementById('estado-texto-input').value = '';
  document.getElementById('statusFileInput').value = '';
  document.getElementById('status-file-name').innerText = '';
  document.getElementById('modal-nuevo-estado').classList.add('active');
}

function seleccionarColorEstado(color, el) {
  colorEstadoSeleccionado = color;
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
  el.classList.add('selected');
}

function mostrarNombreArchivoEstado() {
  const input = document.getElementById('statusFileInput');
  const label = document.getElementById('status-file-name');
  label.innerText = input.files.length > 0 ? `Archivo: ${input.files[0].name}` : '';
}

async function publicarEstado() {
  if (!usuarioActual) return;
  const texto = document.getElementById('estado-texto-input').value.trim();
  const fileInput = document.getElementById('statusFileInput');

  if (!texto && fileInput.files.length === 0) return;

  const formData = new FormData();
  formData.append('usuarioId', usuarioActual.id);
  formData.append('texto', texto);
  formData.append('colorFondo', colorEstadoSeleccionado);
  if (fileInput.files.length > 0) formData.append('file', fileInput.files[0]);

  try {
    const res = await fetch('/api/estados', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.status === 'ok') {
      cerrarModal('modal-nuevo-estado');
      cargarEstados();
    }
  } catch (err) {
    console.error('Error estado:', err);
  }
}

function formatearHoraEstado(fechaStr) {
  const fecha = new Date(fechaStr);
  const ahora = new Date();
  const esHoy = fecha.toDateString() === ahora.toDateString();
  const hora = fecha.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return esHoy ? `Hoy a las ${hora}` : `Ayer a las ${hora}`;
}

async function cargarEstados() {
  try {
    const res = await fetch('/api/estados');
    const estados = await res.json();
    const list = document.getElementById('status-list');
    if (!list) return;

    list.innerHTML = '';
    const gruposMap = new Map();

    estados.forEach(est => {
      const uid = Number(est.usuario_id);
      if (!gruposMap.has(uid)) {
        gruposMap.set(uid, {
          usuarioId: uid,
          usuarioNombre: est.usuarioNombre,
          usuarioFoto: est.usuarioFoto,
          items: []
        });
      }
      gruposMap.get(uid).items.push(est);
    });

    const miId = usuarioActual ? Number(usuarioActual.id) : null;
    const miGrupo = miId ? gruposMap.get(miId) : null;
    if (miId) gruposMap.delete(miId);

    const miNombre = usuarioActual ? usuarioActual.nombre : 'Yo';
    const miFoto = usuarioActual ? usuarioActual.foto_url : null;
    const miAvatarHtml = miFoto ? `<img src="${miFoto}">` : miNombre[0].toUpperCase();
    const miSubtitulo = miGrupo && miGrupo.items.length > 0
      ? `${formatearHoraEstado(miGrupo.items[miGrupo.items.length - 1].creado_en)} (${miGrupo.items.length})`
      : 'Haz clic para añadir actualización';

    const myStatusRow = document.createElement('div');
    myStatusRow.className = 'my-status-row';
    myStatusRow.innerHTML = `
      <div class="my-status-left" id="my-status-click-area">
        <div class="my-status-avatar-wrap">
          <div class="avatar">${miAvatarHtml}</div>
          <span class="my-status-plus-badge">+</span>
        </div>
        <div class="item-details">
          <div class="item-title">Mi estado</div>
          <div class="item-subtitle">${miSubtitulo}</div>
        </div>
      </div>
      ${miGrupo && miGrupo.items.length > 0 ? `<button class="my-status-add-more" id="btn-add-more-status" title="Subir otro">+</button>` : ''}
    `;

    myStatusRow.querySelector('#my-status-click-area').onclick = () => {
      if (miGrupo && miGrupo.items.length > 0) {
        abrirGrupoEstados(miGrupo);
      } else {
        abrirModalNuevoEstado();
      }
    };

    const btnAddMore = myStatusRow.querySelector('#btn-add-more-status');
    if (btnAddMore) {
      btnAddMore.onclick = (e) => {
        e.stopPropagation();
        abrirModalNuevoEstado();
      };
    }

    list.appendChild(myStatusRow);

    const otrosGrupos = Array.from(gruposMap.values()).sort((a, b) => {
      const fechaA = new Date(a.items[a.items.length - 1].creado_en);
      const fechaB = new Date(b.items[b.items.length - 1].creado_en);
      return fechaB - fechaA;
    });

    if (otrosGrupos.length > 0) {
      const label = document.createElement('div');
      label.className = 'status-section-label';
      label.innerText = 'Recientes';
      list.appendChild(label);

      otrosGrupos.forEach(grupo => {
        const ultimo = grupo.items[grupo.items.length - 1];
        const avatarHtml = grupo.usuarioFoto
          ? `<img src="${grupo.usuarioFoto}">`
          : grupo.usuarioNombre[0].toUpperCase();

        const yaVisto = usuariosEstadosVistos.has(grupo.usuarioId);
        const row = document.createElement('div');
        row.className = 'status-user-row';
        row.onclick = () => {
          usuariosEstadosVistos.add(grupo.usuarioId);
          abrirGrupoEstados(grupo);
          cargarEstados();
        };

        row.innerHTML = `
          <div class="status-ring-avatar ${yaVisto ? 'viewed' : ''}">
            <div class="avatar">${avatarHtml}</div>
          </div>
          <div class="item-details">
            <div class="item-title">${escaparHtml(grupo.usuarioNombre)}</div>
            <div class="item-subtitle">${formatearHoraEstado(ultimo.creado_en)}</div>
          </div>
        `;
        list.appendChild(row);
      });
    }

    actualizarPuntitoEstados(estados);
  } catch (err) {
    console.error('Error estados:', err);
  }
}

function actualizarPuntitoEstados(estados) {
  const dotStatus = document.getElementById('status-unread-dot');
  if (!dotStatus || !usuarioActual) return;

  const hayNuevos = estados.some(est => Number(est.usuario_id) !== Number(usuarioActual.id) && !usuariosEstadosVistos.has(Number(est.usuario_id)));
  if (hayNuevos) dotStatus.classList.remove('hidden');
  else dotStatus.classList.add('hidden');
}

function abrirGrupoEstados(grupo) {
  estadosGrupoActual = grupo.items;
  estadoIndiceActual = 0;

  const wrapper = document.getElementById('status-progress-wrapper');
  wrapper.innerHTML = estadosGrupoActual.map((_, idx) => `
    <div class="status-progress-segment">
      <div class="status-progress-fill" id="status-fill-${idx}"></div>
    </div>
  `).join('');

  reproducirEstadoActual();
}

function estadoAnterior() {
  if (estadoIndiceActual > 0) {
    estadoIndiceActual--;
    reproducirEstadoActual();
  } else {
    reproducirEstadoActual();
  }
}

function estadoSiguiente() {
  if (estadoIndiceActual + 1 < estadosGrupoActual.length) {
    estadoIndiceActual++;
    reproducirEstadoActual();
  } else {
    cerrarVisorEstado();
  }
}

function limpiarTemporizadoresEstado() {
  if (estadoTimer) { clearTimeout(estadoTimer); estadoTimer = null; }
  if (estadoInterval) { clearInterval(estadoInterval); estadoInterval = null; }
}

function iniciarTemporizadorFijoEstado(duracionMs, fillEl) {
  let transcurrido = 0;
  const intervalo = 100;

  estadoInterval = setInterval(() => {
    transcurrido += intervalo;
    const porcentaje = Math.min((transcurrido / duracionMs) * 100, 100);
    if (fillEl) fillEl.style.width = `${porcentaje}%`;
  }, intervalo);

  estadoTimer = setTimeout(() => {
    estadoSiguiente();
  }, duracionMs);
}

async function registrarVistaEstado(estadoId) {
  if (!usuarioActual) return;
  try {
    await fetch(`/api/estados/${estadoId}/visto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuarioId: usuarioActual.id })
    });
  } catch (err) {
    console.error('Error registrando vista:', err);
  }
}

async function actualizarContadorVistas(estadoId) {
  const viewsBar = document.getElementById('status-views-bar');
  const viewsCount = document.getElementById('status-views-count');
  const est = estadosGrupoActual[estadoIndiceActual];

  if (!est || !usuarioActual) return;
  const esMio = Number(est.usuario_id) === Number(usuarioActual.id);

  if (esMio) {
    viewsBar.style.display = 'flex';
    viewsBar.setAttribute('data-estado-id', est.id);
    try {
      const res = await fetch(`/api/estados/${est.id}/vistas`);
      const vistas = await res.json();
      viewsCount.innerText = `${vistas.length} Vista${vistas.length === 1 ? '' : 's'}`;
    } catch (err) {
      viewsCount.innerText = '0 Vistas';
    }
  } else {
    viewsBar.style.display = 'none';
  }
}

async function abrirModalVistasEstado() {
  const viewsBar = document.getElementById('status-views-bar');
  const estadoId = (estadosGrupoActual[estadoIndiceActual] && estadosGrupoActual[estadoIndiceActual].id) || 
                   viewsBar.getAttribute('data-estado-id') || 
                   (estadoActualEnVisor && estadoActualEnVisor.id);

  if (!estadoId || estadoId === 'undefined') return;

  const contenedor = document.getElementById('lista-vistas-contenido');
  contenedor.innerHTML = '<p style="color:#8696a0;">Cargando vistas...</p>';
  document.getElementById('modal-lista-vistas').classList.add('active');

  try {
    const res = await fetch(`/api/estados/${estadoId}/vistas`);
    const vistas = await res.json();

    if (vistas.length === 0) {
      contenedor.innerHTML = '<p style="color:#8696a0; text-align:center; padding:20px;">Nadie ha visto este estado todavía.</p>';
      return;
    }

    contenedor.innerHTML = vistas.map(v => {
      const av = v.foto_url ? `<img src="${v.foto_url}">` : v.nombre[0].toUpperCase();
      const horaVisto = new Date(v.visto_en).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <div style="display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid #2a3942;">
          <div class="avatar" style="width:38px; height:38px; font-size:14px;">${av}</div>
          <div style="flex:1;">
            <div style="font-weight:bold; color:#e9edef;">${escaparHtml(v.nombre)}</div>
            <div style="font-size:12px; color:#8696a0;">Visto a las ${horaVisto}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    contenedor.innerHTML = '<p style="color:#f15c6d;">No se pudo cargar la lista de vistas.</p>';
  }
}

function reproducirEstadoActual() {
  limpiarTemporizadoresEstado();

  const est = estadosGrupoActual[estadoIndiceActual];
  if (!est) {
    cerrarVisorEstado();
    return;
  }

  estadoActualEnVisor = est;
  registrarVistaEstado(est.id);
  actualizarContadorVistas(est.id);

  const esMio = usuarioActual && Number(est.usuario_id) === Number(usuarioActual.id);
  document.getElementById('status-reply-bar').style.display = esMio ? 'none' : 'flex';
  document.getElementById('status-reply-input').value = '';

  estadosGrupoActual.forEach((_, idx) => {
    const fill = document.getElementById(`status-fill-${idx}`);
    if (!fill) return;
    fill.style.transition = 'none';
    fill.style.width = idx < estadoIndiceActual ? '100%' : '0%';
  });

  const currentFill = document.getElementById(`status-fill-${estadoIndiceActual}`);
  const viewer = document.getElementById('status-viewer');
  const body = document.getElementById('status-card-body');
  const avatarEl = document.getElementById('status-user-avatar');

  if (est.usuarioFoto) {
    avatarEl.innerHTML = `<img src="${est.usuarioFoto}">`;
  } else {
    avatarEl.innerText = est.usuarioNombre[0].toUpperCase();
  }

  document.getElementById('status-user-name').innerText = est.usuarioNombre;
  document.getElementById('status-user-time').innerText = formatearHoraEstado(est.creado_en);

  viewer.style.display = 'flex';
  const esVideo = est.archivo_url && /\.(mp4|webm|ogg|mov|mkv)(\?.*)?$/i.test(est.archivo_url);

  if (esVideo) {
    body.innerHTML = `
      <video id="status-video-player" src="${est.archivo_url}" autoplay playsinline></video>
      ${est.contenido ? `<div class="status-caption">${escaparHtml(est.contenido)}</div>` : ''}
    `;

    const videoEl = document.getElementById('status-video-player');
    videoEl.addEventListener('timeupdate', () => {
      if (videoEl.duration && !isNaN(videoEl.duration) && isFinite(videoEl.duration) && currentFill) {
        const porcentaje = (videoEl.currentTime / videoEl.duration) * 100;
        currentFill.style.width = `${porcentaje}%`;
      }
    });

    videoEl.addEventListener('ended', () => { estadoSiguiente(); });
    videoEl.addEventListener('error', () => { iniciarTemporizadorFijoEstado(15000, currentFill); });
  } else if (est.archivo_url) {
    body.innerHTML = `
      <img src="${est.archivo_url}" />
      ${est.contenido ? `<div class="status-caption">${escaparHtml(est.contenido)}</div>` : ''}
    `;
    iniciarTemporizadorFijoEstado(15000, currentFill);
  } else {
    body.innerHTML = `
      <div class="status-text-only" style="background:${est.color_fondo || '#005c4b'};">
        ${escaparHtml(est.contenido || '')}
      </div>
    `;
    iniciarTemporizadorFijoEstado(15000, currentFill);
  }
}

async function enviarEmojiEstado(emoji) {
  if (!estadoActualEnVisor || !usuarioActual) return;
  await responderEstadoTexto(`Respuesta a tu estado: ${emoji}`);
}

async function enviarRespuestaEstado() {
  const input = document.getElementById('status-reply-input');
  const texto = input.value.trim();
  if (!texto || !estadoActualEnVisor || !usuarioActual) return;

  await responderEstadoTexto(`Respuesta a tu estado: ${texto}`);
  input.value = '';
}

async function responderEstadoTexto(textoRespuesta) {
  const est = estadoActualEnVisor;
  if (!est || !usuarioActual) return;

  try {
    const res = await fetch('/api/chats/privado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario1Id: usuarioActual.id, usuario2Id: est.usuario_id })
    });
    const data = await res.json();

    if (data.status === 'ok' && socket) {
      const destinoChatId = data.chatId;
      let resumenEstado = est.contenido || '📷 Estado multimedia';

      socket.emit('nuevo_mensaje', {
        chatId: Number(destinoChatId),
        usuarioId: usuarioActual.id,
        usuarioNombre: usuarioActual.nombre,
        usuarioFoto: usuarioActual.foto_url || null,
        telefono: usuarioActual.telefono,
        texto: textoRespuesta,
        respuestaAId: null,
        replyInfo: {
          id: Number(est.id),
          usuarioNombre: est.usuarioNombre,
          textoResumen: resumenEstado,
          archivoUrl: est.archivo_url || null
        }
      });

      cerrarVisorEstado();
      await cargarListaChats();
      seleccionarChat(destinoChatId);
      switchTab('chats');
    }
  } catch (err) {
    console.error('Error respondiendo estado:', err);
  }
}

function cerrarVisorEstado() {
  limpiarTemporizadoresEstado();
  estadosGrupoActual = [];
  estadoIndiceActual = 0;
  estadoActualEnVisor = null;

  const body = document.getElementById('status-card-body');
  if (body) {
    const medios = body.querySelectorAll('video, audio');
    medios.forEach(m => {
      m.pause();
      m.currentTime = 0;
      m.removeAttribute('src');
      m.load();
    });
    body.innerHTML = '';
  }

  const viewer = document.getElementById('status-viewer');
  if (viewer) viewer.style.display = 'none';
  cargarEstados();
}

function toggleMenuTresPuntos(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('menu-dropdown');
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

async function accionInfoGrupo() {
  document.getElementById('menu-dropdown').style.display = 'none';
  const contenedor = document.getElementById('info-chat-contenido');
  contenedor.innerHTML = '<p style="color:#8696a0;">Cargando información...</p>';
  document.getElementById('modal-info-chat').classList.add('active');

  try {
    const res = await fetch(`/api/chats/${chatIdActual}/info`);
    const data = await res.json();
    const titulo = data.chat.es_grupo ? (data.chat.nombre || 'Grupo SO2 (Distribuido)') : 'Chat Privado';

    const miembrosHtml = data.miembros.map(m => {
      const av = m.foto_url ? `<img src="${m.foto_url}">` : m.nombre[0].toUpperCase();
      return `
        <div style="display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid #2a3942;">
          <div class="avatar" style="width:36px; height:36px; font-size:14px;">${av}</div>
          <div>
            <div style="font-weight:bold; color:#e9edef;">${m.nombre}</div>
            <div style="font-size:12px; color:#8696a0;">${m.telefono} • ${m.descripcion || ''}</div>
          </div>
        </div>
      `;
    }).join('');

    contenedor.innerHTML = `
      <div style="background:#111b21; padding:12px; border-radius:8px; margin-bottom:14px;">
        <div style="color:#00a884; font-weight:bold; font-size:16px;">${titulo}</div>
        <div style="color:#8696a0; font-size:12px; margin-top:4px;">Nodo conectado: ${data.nodo} • Participantes: ${data.miembros.length}</div>
      </div>
      <div style="font-size:12px; color:#00a884; margin-bottom:6px; font-weight:bold;">PARTICIPANTES</div>
      ${miembrosHtml}
    `;
  } catch (err) {
    contenedor.innerHTML = '<p style="color:#f15c6d;">No se pudo cargar la información.</p>';
  }
}

async function accionVerArchivos() {
  document.getElementById('menu-dropdown').style.display = 'none';
  const contenedor = document.getElementById('archivos-chat-contenido');
  contenedor.innerHTML = '<p style="color:#8696a0;">Buscando archivos...</p>';
  document.getElementById('modal-archivos-chat').classList.add('active');

  try {
    const res = await fetch(`/api/chats/${chatIdActual}/archivos`);
    const items = await res.json();

    if (items.length === 0) {
      contenedor.innerHTML = '<p style="color:#8696a0; text-align:center; padding:20px;">No hay archivos compartidos.</p>';
      return;
    }

    contenedor.innerHTML = items.map(it => {
      const fecha = new Date(it.enviado_en).toLocaleString();
      if (it.archivo_url) {
        const nombre = it.archivo_url.split('_').slice(2).join('_') || 'Archivo';
        return `
          <div style="padding:10px; background:#111b21; border-radius:8px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <div style="overflow:hidden; padding-right:8px;">
              <div style="color:#e9edef; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">📎 ${nombre}</div>
              <div style="font-size:11px; color:#8696a0;">Por ${it.usuarioNombre} • ${fecha}</div>
            </div>
            <a href="${it.archivo_url}" target="_blank" style="color:#00a884; text-decoration:none; font-weight:bold;">Abrir</a>
          </div>
        `;
      } else {
        return `
          <div style="padding:10px; background:#111b21; border-radius:8px; margin-bottom:8px;">
            <div style="color:#53bdeb; word-break:break-all;">🔗 ${it.contenido}</div>
            <div style="font-size:11px; color:#8696a0; margin-top:4px;">Por ${it.usuarioNombre} • ${fecha}</div>
          </div>
        `;
      }
    }).join('');
  } catch (err) {
    contenedor.innerHTML = '<p style="color:#f15c6d;">No se pudieron cargar los archivos.</p>';
  }
}

async function accionVaciarChat() {
  document.getElementById('menu-dropdown').style.display = 'none';
  try {
    const res = await fetch(`/api/chats/${chatIdActual}/mensajes`, { method: 'DELETE' });
    if (res.ok) {
      document.getElementById('chat-box').innerHTML = '';
      mensajesCache.clear();
      cargarListaChats();
    }
  } catch (err) {
    console.error('Error vaciando chat:', err);
  }
}

function switchTab(tab) {
  document.querySelectorAll('.nav-icon').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));

  const tabEl = document.getElementById(`tab-${tab}`);
  const panelEl = document.getElementById(`panel-${tab}`);
  if (tabEl) tabEl.classList.add('active');
  if (panelEl) panelEl.classList.add('active');

  if (tab === 'status') cargarEstados();
  if (tab === 'chats') cargarListaChats();
}

function cerrarModal(id) {
  document.getElementById(id).classList.remove('active');
}

function toggleEmojiPicker(e) {
  if (e) e.stopPropagation();
  const picker = document.getElementById('emoji-picker');
  picker.style.display = picker.style.display === 'grid' ? 'none' : 'grid';
}

function insertarEmoji(emoji) {
  const input = document.getElementById('mensaje');
  input.value += emoji;
  document.getElementById('emoji-picker').style.display = 'none';
  input.focus();
}

document.addEventListener('click', () => {
  const menu = document.getElementById('menu-dropdown');
  if (menu) menu.style.display = 'none';

  const picker = document.getElementById('emoji-picker');
  if (picker) picker.style.display = 'none';

  cerrarMenuMensaje();
});