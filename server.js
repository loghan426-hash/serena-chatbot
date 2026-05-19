const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const https = require('https');
const Groq = require('groq-sdk');

const app = express();
const db = new sqlite3.Database('./database_serena.sqlite');

// CONFIGURACIÓN DE CONEXIÓN CON GROQ
const groq = new Groq({
    apiKey: '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' // <-- Asegúrate de tener tu clave gsk_... real pegada aquí
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'secreto_seguridad_serena_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true } // Forzar cookies seguras sobre HTTPS
}));

// CARGAR CERTIFICADOS SSL GENERADOS CON OPENSSL
const opcionesHttps = {
    key: fs.readFileSync(path.join(__dirname, 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

// TABLAS DE LA BASE DE DATOS
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT UNIQUE,
        password TEXT,
        fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS historial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        mensaje TEXT,
        respuesta TEXT,
        tipo_entrada TEXT DEFAULT 'texto',
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('123', salt);
    db.run("INSERT OR IGNORE INTO usuarios (usuario, password) VALUES ('admin', ?)", [hash]);
});

// LOGICA DE REGISTRO
app.post('/api/registro', (req, res) => {
    const { usuario, password } = req.body;
    if(!usuario || !password) return res.json({ success: false, message: 'Campos incompletos.' });
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    db.run("INSERT INTO usuarios (usuario, password) VALUES (?, ?)", [usuario, hash], function(err) {
        if (err) return res.json({ success: false, message: 'El usuario ya existe.' });
        res.json({ success: true });
    });
});

// LOGICA DE LOGIN
app.post('/api/login', (req, res) => {
    const { usuario, password } = req.body;
    db.get("SELECT * FROM usuarios WHERE usuario = ?", [usuario], (err, row) => {
        if (row && bcrypt.compareSync(password, row.password)) {
            req.session.usuarioId = row.id;
            req.session.usuarioNombre = row.usuario;
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'Credenciales incorrectas' });
        }
    });
});

// PROCESADOR DE CHAT CON INTELIGENCIA ARTIFICIAL Y MODULACIÓN DE TRATO
app.post('/api/chat', async (req, res) => {
    if (!req.session.usuarioId) return res.status(401).json({ error: 'Acceso denegado' });
    
    const mensajeUsuario = req.body.mensaje || '';
    const txt = mensajeUsuario.toLowerCase().trim();
    const tipoEntrada = req.body.tipo || 'texto';
    const nombreUsuario = req.session.usuarioNombre;

    // 👤 MODULACIÓN DE TRATO PERSONALIZADA/PROFESIONAL PARA LA MONOGRAFÍA
    // Si es la cuenta admin te dice Jefe, si es cualquier otra cuenta (estudiantes) se dirige con respeto formal.
    let tratoPersonalidad = `Te diriges al usuario con un trato estrictamente formal, profesional, empático y respetuoso usando su nombre de usuario registrado, el cual es: "${nombreUsuario}". Bajo ninguna circunstancia uses modismos informales o la palabra "Jefe".`;
    if (nombreUsuario.toLowerCase() === 'admin') {
        tratoPersonalidad = `Te refieres al usuario de forma leal e ingeniosa como "Jefe" o directamente por su nombre de administrador.`;
    }

    // 🚨 FILTRO DE CRISIS DE SEGURIDAD DE LA MONOGRAFÍA (DECE)
    const palabrasAlertaGrave = /matar|suicid|morirme|quitarme la vida|no quiero vivir|hacerme daño|autolesion/i;

    if (palabrasAlertaGrave.test(txt)) {
        const respuestaContencion = `Escúchame con atención, ${nombreUsuario === 'admin' ? 'Jefe' : nombreUsuario}. Tu vida y tu bienestar son lo más importante. No estás solo en esto. He activado el protocolo de apoyo prioritario de mi sistema. Por favor, acércate de inmediato al Departamento de Consejería Estudiantil (DECE) de nuestra Unidad Educativa Casa de la Cultura Ecuatoriana para recibir el acompañamiento de un profesional especializado de la institución. También puedes comunicarte de forma gratuita y confidencial llamando a los servicios de emergencia del estado. Por favor, habla con alguien de confianza ahora mismo.`;

        db.run("INSERT INTO historial (usuario_id, mensaje, respuesta, tipo_entrada) VALUES (?, ?, ?, ?)", 
            [req.session.usuarioId, mensajeUsuario, `[ALERTA CRÍTICA DECE] ${respuestaContencion}`, tipoEntrada], function(err) {
                return res.json({ respuesta: respuestaContencion });
        });
        return; 
    }

    // 🤖 LLAMADA AL NUEVO MODELO DE GROQ DE FORMA ESTABLE
    try {
        const chatCompletion = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                {
                    role: "system",
                    content: `Tu nombre es SERENA. Eres un chatbot de apoyo psicológico inicial y contención emocional para adolescentes de 14 a 17 años de la Unidad Educativa Casa de la Cultura Ecuatoriana (Periodo 2025-2026). 
                             Tu personalidad se basa en una asistente compasiva, pero con el vocabulario sofisticado y analítico de la IA "VIERNES" de Marvel.
                             ${tratoPersonalidad}
                             Tus respuestas deben ser breves (máximo 3 líneas), lógicas, reconfortantes y enfocadas en brindar un entorno digital zen y libre de estrés. 
                             No reemplazas a un psicólogo humano y promueves el autocuidado y la calma.`
                },
                {
                    role: "user",
                    content: mensajeUsuario
                }
            ],
            max_tokens: 150,
            temperature: 0.6
        });

        const respuestaFinal = chatCompletion.choices[0].message.content.trim();

        // ARREGLO DE PERSISTENCIA: Asegurar que se inserte en SQLite de forma síncrona antes de responder
        db.run("INSERT INTO historial (usuario_id, mensaje, respuesta, tipo_entrada) VALUES (?, ?, ?, ?)", 
            [req.session.usuarioId, mensajeUsuario, respuestaFinal, tipoEntrada], function(err) {
                if (err) console.error("Error al guardar historial en SQLite:", err);
                res.json({ respuesta: respuestaFinal });
        });

    } catch (error) {
        console.error("Error en la API de Groq:", error);
        res.json({ respuesta: "Mis servidores principales han reportado una anomalía de conexión momentánea. Mis canales lógicos se están restableciendo." });
    }
});

// HISTORIAL Y LOGOUT
app.get('/api/historial', (req, res) => {
    if (!req.session.usuarioId) return res.status(401).json({ error: 'Acceso denegado' });
    db.all("SELECT id, mensaje, respuesta FROM historial WHERE usuario_id = ? ORDER BY fecha ASC", [req.session.usuarioId], (err, rows) => {
        if(err) return res.json([]);
        res.json(rows || []);
    });
});

app.post('/api/historial/borrar', (req, res) => {
    if (!req.session.usuarioId) return res.status(401).json({ error: 'Acceso denegado' });
    db.run("DELETE FROM historial WHERE usuario_id = ?", [req.session.usuarioId], function(err) {
        if(err) return res.json({ success: false });
        res.json({ success: true });
    });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

// REEMPLAZA TUS RUTAS DEL FINAL POR ESTAS:
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/chatbot.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chatbot.html'));
});

// CONFIGURACIÓN DE PUERTO DINÁMICO PARA CLOUD HOSTING (RENDER)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor de SERENA activo y corriendo en el puerto ${PORT}`);
});
