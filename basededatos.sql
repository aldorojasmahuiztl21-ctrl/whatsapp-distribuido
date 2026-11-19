CREATE DATABASE IF NOT EXISTS whatsapp_db;
USE whatsapp_db;

CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    telefono VARCHAR(20) UNIQUE NOT NULL,
    nombre VARCHAR(100) UNIQUE NOT NULL,
    foto_url VARCHAR(255) NULL,
    descripcion VARCHAR(150) DEFAULT '¡Hola! Estoy usando WhatsApp Web Distribuido.',
    codigo_verificacion VARCHAR(6) NULL,
    verificado BOOLEAN DEFAULT FALSE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NULL,
    es_grupo BOOLEAN DEFAULT FALSE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_miembros (
    chat_id INT NOT NULL,
    usuario_id INT NOT NULL,
    ultimo_leido_id INT DEFAULT 0,
    PRIMARY KEY (chat_id, usuario_id),
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mensajes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    chat_id INT NOT NULL,
    usuario_id INT NOT NULL,
    contenido TEXT NULL,
    archivo_url VARCHAR(255) NULL,
    tipo_archivo VARCHAR(100) NULL,
    respuesta_a_id INT NULL,
    leido BOOLEAN DEFAULT FALSE,
    enviado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (respuesta_a_id) REFERENCES mensajes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mensaje_reacciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mensaje_id INT NOT NULL,
    usuario_id INT NOT NULL,
    emoji VARCHAR(16) NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_reaccion_usuario (mensaje_id, usuario_id),
    FOREIGN KEY (mensaje_id) REFERENCES mensajes(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS estados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    contenido TEXT NULL,
    color_fondo VARCHAR(20) DEFAULT '#005c4b',
    archivo_url VARCHAR(255) NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS estado_vistas (
  estado_id INT NOT NULL,
  usuario_id INT NOT NULL,
  visto_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (estado_id, usuario_id),
  FOREIGN KEY (estado_id) REFERENCES estados(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

INSERT IGNORE INTO chats (id, nombre, es_grupo) VALUES (1, 'Grupo SO2 (Distribuido)', TRUE);


