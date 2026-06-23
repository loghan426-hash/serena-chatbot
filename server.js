const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt  = require('bcryptjs');
const session = require('express-session');
const path    = require('path');
const Groq    = require('groq-sdk');

const app = express();
const db  = new sqlite3.Database('./database_serena.sqlite');

// ─────────────────────────────────────────────────────────────
//  FIX 1: Groq API key desde variable de entorno (NUNCA en código)
//  → Configura GROQ_API_KEY en Render > Environment Variables
// ─────────────────────────────────────────────────────────────
if (!process.env.GROQ_API_KEY) {
    console.error('\n❌  ERROR: Falta la variable de entorno GROQ_API_KEY en Render.\n');
    process.exit(1);
}
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─────────────────────────────────────────────────────────────
//  Middlewares en el orden correcto
// ─────────────────────────────────────────────────────────────
app.set('trust proxy', 1); // Obligatorio para sesiones seguras en Render

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// FIX 2: { index: false } evita que Express sirva index.html
// automáticamente en la ruta "/" y deja que nuestro app.get('/')
// redirija al login correctamente.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'serena_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,     // HTTPS de Render
        sameSite: 'none'  // Permite peticiones cross-site estables
    }
}));

// ─────────────────────────────────────────────────────────────
//  Base de datos
// ─────────────────────────────────────────────────────────────
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario          TEXT UNIQUE,
        password         TEXT,
        fecha_registro   DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS historial (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id   INTEGER,
        mensaje      TEXT,
        respuesta    TEXT,
        tipo_entrada TEXT DEFAULT 'texto',
        fecha        DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Usuario admin por defecto (password: 123)
    const hash = bcrypt.hashSync('123', bcrypt.genSaltSync(10));
    db.run("INSERT OR IGNORE INTO usuarios (usuario, password) VALUES ('admin', ?)", [hash]);
});

// ─────────────────────────────────────────────────────────────
//  API: Registro
// ─────────────────────────────────────────────────────────────
app.post('/api/registro', (req, res) => {
    const { usuario, password } = req.body;
    if (!usuario || !password)
        return res.json({ success: false, message: 'Campos incompletos.' });

    const hash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
    db.run(
        "INSERT INTO usuarios (usuario, password) VALUES (?, ?)",
        [usuario, hash],
        function (err) {
            if (err) return res.json({ success: false, message: 'El usuario ya existe.' });
            res.json({ success: true });
        }
    );
});

// ─────────────────────────────────────────────────────────────
//  API: Login
// ─────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
    const { usuario, password } = req.body;
    db.get("SELECT * FROM usuarios WHERE usuario = ?", [usuario], (err, row) => {
        if (row && bcrypt.compareSync(password, row.password)) {
            req.session.usuarioId     = row.id;
            req.session.usuarioNombre = row.usuario;
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'Credenciales incorrectas.' });
        }
    });
});

// ─────────────────────────────────────────────────────────────
//  API: Chat (Groq + protocolo de crisis DECE)
// ─────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
    if (!req.session.usuarioId)
        return res.status(401).json({ error: 'Acceso denegado. Sesión no encontrada.' });

    const mensajeUsuario = (req.body.mensaje || '').trim();
    const tipoEntrada    = req.body.tipo || 'texto';
    const nombreUsuario  = req.session.usuarioNombre;
    const txt            = mensajeUsuario.toLowerCase();

    const esAdmin = nombreUsuario && nombreUsuario.toLowerCase() === 'admin';
    const tratoPersonalidad = esAdmin
        ? `Te refieres al usuario de forma leal e ingeniosa como "Jefe" o directamente por su nombre de administrador.`
        : `Te diriges al usuario con un trato estrictamente formal, profesional, empático y respetuoso usando su nombre de usuario registrado, el cual es: "${nombreUsuario}". Bajo ninguna circunstancia uses modismos informales o la palabra "Jefe".`;

    // ── Protocolo de crisis DECE ──
    const palabrasAlertaGrave = /matar|suicid|morirme|quitarme la vida|no quiero vivir|hacerme daño|autolesion/i;

    if (palabrasAlertaGrave.test(txt)) {
        const respuestaContencion =
            `Escúchame con atención, ${esAdmin ? 'Jefe' : nombreUsuario}. ` +
            `Tu vida y tu bienestar son lo más importante. No estás solo en esto. ` +
            `He activado el protocolo de apoyo prioritario. Por favor, acércate de inmediato ` +
            `al Departamento de Consejería Estudiantil (DECE) de nuestra Unidad Educativa ` +
            `Casa de la Cultura Ecuatoriana, o llama a la Línea de Crisis: 1800-227-400 (24h, gratuita).`;

        db.run(
            "INSERT INTO historial (usuario_id, mensaje, respuesta, tipo_entrada) VALUES (?, ?, ?, ?)",
            [req.session.usuarioId, mensajeUsuario, `[ALERTA CRÍTICA DECE] ${respuestaContencion}`, tipoEntrada],
            () => res.json({ respuesta: respuestaContencion })
        );
        return;
    }

    // ── Llamada a Groq ──
    try {
        const chatCompletion = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [
                {
                    role: 'system',
                    content:
                        `Tu nombre es SERENA. Eres un chatbot de apoyo psicológico inicial ` +
                        `y contención emocional para adolescentes de 14 a 17 años de la ` +
                        `Unidad Educativa Casa de la Cultura Ecuatoriana (Periodo 2025-2026). ` +
                        `Personalidad: VIERNES (Marvel). ${tratoPersonalidad} ` +
                        `Respuestas de máximo 3 líneas.`
                },
                { role: 'user', content: mensajeUsuario }
            ],
            max_tokens: 150,
            temperature: 0.6
        });

        const respuestaFinal = chatCompletion.choices[0].message.content.trim();

        // Responder de inmediato y guardar en segundo plano
        res.json({ respuesta: respuestaFinal });

        db.run(
            "INSERT INTO historial (usuario_id, mensaje, respuesta, tipo_entrada) VALUES (?, ?, ?, ?)",
            [req.session.usuarioId, mensajeUsuario, respuestaFinal, tipoEntrada],
            (err) => { if (err) console.error('Error al guardar historial:', err); }
        );

    } catch (error) {
        console.error('Error en la API de Groq:', error.message);
        res.json({
            respuesta: 'Mis sistemas de IA están experimentando alta latencia. Por favor, intenta nuevamente en unos instantes.'
        });
    }
});

// ─────────────────────────────────────────────────────────────
//  API: Historial y Logout
// ─────────────────────────────────────────────────────────────
app.get('/api/historial', (req, res) => {
    if (!req.session.usuarioId) return res.status(401).json({ error: 'Acceso denegado' });
    db.all(
        "SELECT id, mensaje, respuesta FROM historial WHERE usuario_id = ? ORDER BY fecha ASC",
        [req.session.usuarioId],
        (err, rows) => res.json(rows || [])
    );
});

app.post('/api/historial/borrar', (req, res) => {
    if (!req.session.usuarioId) return res.status(401).json({ error: 'Acceso denegado' });
    db.run("DELETE FROM historial WHERE usuario_id = ?", [req.session.usuarioId],
        (err) => res.json({ success: !err })
    );
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

// ─────────────────────────────────────────────────────────────
//  Rutas de páginas HTML
//  FIX 2 (cont.): La ruta "/" ya no compite con express.static
// ─────────────────────────────────────────────────────────────
app.get('/',             (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login.html',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/index.html',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/chatbot.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chatbot.html')));
app.get('/registro.html',(req, res) => res.sendFile(path.join(__dirname, 'public', 'registro.html')));

// ─────────────────────────────────────────────────────────────
//  Puerto dinámico (Render lo asigna vía process.env.PORT)
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅  SERENA activa en el puerto ${PORT}`);
});
