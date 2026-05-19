const chatForm = document.getElementById('chatForm');
const userInput = document.getElementById('userInput');
const chatMessages = document.getElementById('chatMessages');
const historyList = document.getElementById('historyList');
const btnVoice = document.getElementById('btnVoice');
const btnBorrarHistorial = document.getElementById('btnBorrarHistorial');
const core = document.querySelector('.serena-core');
const waveContainer = document.getElementById('waveContainer');

let vozFemeninaViernes = null;
let registrosTotales = [];

// ENLAZAR LA MEJOR VOZ FEMENINA COMPATIBLE EN CHROME/EDGE
function buscarVozFemenina() {
    const voces = window.speechSynthesis.getVoices() || [];
    vozFemeninaViernes = voces.find(voz => {
        const nombreLower = voz.name.toLowerCase();
        return nombreLower.includes('google') && (voz.lang.includes('es-ES') || voz.lang.includes('es-419') || voz.lang.includes('es-US'));
    });
    if (!vozFemeninaViernes) {
        vozFemeninaViernes = voces.find(voz => {
            const nombreLower = voz.name.toLowerCase();
            return voz.lang.includes('es') && (nombreLower.includes('online') || nombreLower.includes('natural') || nombreLower.includes('neural'));
        });
    }
    if (!vozFemeninaViernes) {
        const nombresFemeninos = ['sabina', 'helena', 'elena', 'zira', 'female'];
        vozFemeninaViernes = voces.find(voz => voz.lang.includes('es') && nombresFemeninos.some(n => voz.name.toLowerCase().includes(n)));
    }
    if (!vozFemeninaViernes) {
        vozFemeninaViernes = voces.find(voz => voz.lang.toLowerCase().includes('es'));
    }
}
if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = buscarVozFemenina;
}
buscarVozFemenina();

function hablarAsistente(texto) {
    if (!texto) return;
    window.speechSynthesis.cancel(); 
    const lectura = new SpeechSynthesisUtterance(texto);
    if (vozFemeninaViernes) lectura.voice = vozFemeninaViernes;
    lectura.lang = 'es-ES';
    lectura.rate = 1.05; 
    lectura.pitch = 1.1; 

    lectura.onstart = () => {
        if(core) core.style.animation = 'pulse 0.3s infinite alternate';
        if(waveContainer) waveContainer.classList.add('playing');
    };
    lectura.onend = () => {
        if(core) core.style.animation = 'pulse 2s infinite alternate';
        if(waveContainer) waveContainer.classList.remove('playing');
    };
    window.speechSynthesis.speak(lectura);
}

// RECONOCIMIENTO DE VOZ
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const reconocimiento = new SpeechRecognition();
    reconocimiento.lang = 'es-ES';
    reconocimiento.interimResults = false;

    btnVoice.addEventListener('click', () => {
        try {
            reconocimiento.start();
            btnVoice.style.background = '#f87171';
            btnVoice.textContent = '🛑';
            userInput.placeholder = "Escuchando comandos de voz...";
        } catch (e) {}
    });

    reconocimiento.onresult = (event) => {
        if (event.results && event.results[0]) {
            const vozTexto = event.results[0][0].transcript;
            if (vozTexto) {
                userInput.value = vozTexto;
                enviarMensajeServidor(vozTexto, 'voz');
            }
        }
        restaurarBoton();
    };
    reconocimiento.onerror = () => restaurarBoton();
    reconocimiento.onend = () => restaurarBoton();
}

function restaurarBoton() {
    if(btnVoice) { btnVoice.style.background = 'var(--bg-dark)'; btnVoice.textContent = '🎤'; }
    if(userInput) userInput.placeholder = "Escribe un comando o usa el micrófono...";
}

// ENVIAR MENSAJE AL BACKEND CON SOLUCIÓN DE GUARDADO
async function enviarMensajeServidor(mensaje, tipo = 'texto') {
    if (!mensaje || mensaje.trim() === "") return;
    
    inyectarMensaje(mensaje, 'user');
    userInput.value = '';

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mensaje, tipo })
        });
        const data = await res.json();
        const respuestaBot = data.respuesta || "Error de sincronización.";

        setTimeout(() => {
            inyectarMensaje(respuestaBot, 'bot');
            hablarAsistente(respuestaBot); 
            cargarHistorial(); // Refrescar la base de datos de inmediato en la barra lateral
        }, 200);
    } catch (e) { 
        console.error(e);
        inyectarMensaje("Error de sincronización con el servidor.", 'bot');
    }
}

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const mensaje = userInput.value.trim();
    if (mensaje) enviarMensajeServidor(mensaje, 'texto');
});

// CARGAR HISTORIAL INTERACTIVO DESDE SQLITE
async function cargarHistorial() {
    try {
        const res = await fetch('/api/historial');
        registrosTotales = await res.json();
        if (!Array.isArray(registrosTotales)) return;
        
        historyList.innerHTML = '';
        if (registrosTotales.length === 0) {
            historyList.innerHTML = '<p class="empty-history">No hay registros guardados.</p>';
            return;
        }

        [...registrosTotales].reverse().forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'history-item clickeable-chat';
            const msgCorto = item.mensaje ? item.mensaje.substring(0, 18) : "Mensaje...";
            itemDiv.innerHTML = `💬 <span>${msgCorto}...</span>`;
            
            itemDiv.addEventListener('click', () => {
                chatMessages.innerHTML = ''; 
                inyectarMensaje(item.mensaje, 'user');
                inyectarMensaje(item.respuesta, 'bot');
                hablarAsistente(`Reanudando chat. Mi respuesta fue: ${item.respuesta}`);
            });

            historyList.appendChild(itemDiv);
        });
    } catch (e) { console.error(e); }
}

btnBorrarHistorial.addEventListener('click', async () => {
    if (confirm("¿Estás seguro de que deseas vaciar por completo tu historial de la base de datos?")) {
        const res = await fetch('/api/historial/borrar', { method: 'POST' });
        const data = await res.json();
        if(data.success) {
            chatMessages.innerHTML = '<div class="msg message-bot"><p>Base de datos de historial formateada correctamente.</p></div>';
            cargarHistorial();
        }
    }
});

function inyectarMensaje(texto, remitente) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg message-${remitente}`;
    msgDiv.innerHTML = `<p>${texto}</p>`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

cargarHistorial();
