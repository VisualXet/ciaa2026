/**
 * EventTech Studio - Mobile App Logic para Técnicos de Sala
 * Basado en la arquitectura y experiencia visual de SEMERGEN.
 * 100% Autónomo, Offline, Mobile-First con persistencia localStorage.
 */

var eventData = window.__EVENT_DATA__ || null;

// Estados persistidos en localStorage
var selectedDayIdx = 0;
var selectedRooms = []; // lista de nombres de salas seleccionadas
var currentSearchTerm = '';
var currentVenue = 'all';
var isCompactView = false;
var globalShowSpeakers = true;
var visibleSpeakersMap = {};
var finishedSessionsMap = {};
var sessionNotesMap = {};
var currentEditingSessionId = null;

// Helpers de almacenamiento local seguro
function safeGet(key, defaultVal) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      var val = localStorage.getItem(key);
      return val ? JSON.parse(val) : defaultVal;
    }
  } catch (e) {}
  return defaultVal;
}

function safeSet(key, val) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      localStorage.setItem(key, JSON.stringify(val));
    }
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', async function() {
  initTheme();
  initClock();

  finishedSessionsMap = safeGet('event_finished_sessions_v1', {});
  sessionNotesMap = safeGet('event_session_notes_v1', {});
  isCompactView = safeGet('event_compact_view_v1', false);

  if (!eventData) {
    try {
      var res = await fetch('data/event_data.json');
      eventData = await res.json();
    } catch (e) {
      console.warn("No se pudo cargar event_data.json local.");
    }
  }

  if (eventData) {
    initApp();
  } else {
    var out = document.getElementById('schedule-output');
    if (out) out.innerHTML = '<div class="text-center py-12 text-slate-500">No se encontraron datos del evento.</div>';
  }
});

function initTheme() {
  var savedTheme = localStorage.getItem('tech_theme_mode');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    updateThemeButton(true);
  } else if (savedTheme === 'light') {
    document.body.classList.remove('dark-mode');
    updateThemeButton(false);
  } else {
    // Modo por defecto según configuración
    var defMode = eventData && eventData.theme && eventData.theme.default_mode;
    if (defMode === 'dark') {
      document.body.classList.add('dark-mode');
      updateThemeButton(true);
    }
  }
}

function toggleDarkMode() {
  var isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('tech_theme_mode', isDark ? 'dark' : 'light');
  updateThemeButton(isDark);
  showToast(isDark ? 'Modo Sala Oscura activado (Antideslumbrante)' : 'Modo Claro activado', 'fa-moon text-amber-400');
}

function updateThemeButton(isDark) {
  var icon = document.getElementById('theme-toggle-icon');
  var text = document.getElementById('theme-toggle-text');
  var mIcon = document.getElementById('mobile-theme-icon');
  var mText = document.getElementById('mobile-theme-text');
  if (icon) icon.className = isDark ? 'fa-solid fa-sun text-amber-400' : 'fa-solid fa-moon text-amber-300';
  if (text) text.textContent = isDark ? 'Modo Luz' : 'Modo Sala';
  if (mIcon) mIcon.className = isDark ? 'fa-solid fa-sun text-base text-amber-400' : 'fa-solid fa-moon text-base text-amber-500';
  if (mText) mText.textContent = isDark ? 'Modo Luz' : 'Modo Sala';
}

function initClock() {
  var clockEl = document.getElementById('clock-display');
  function update() {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, '0');
    var m = String(now.getMinutes()).padStart(2, '0');
    var s = String(now.getSeconds()).padStart(2, '0');
    if (clockEl) clockEl.textContent = h + ':' + m + ':' + s;
  }
  update();
  setInterval(update, 1000);
  setInterval(evaluateLiveSessions, 30000);
}

// INICIALIZACIÓN DE LA APLICACIÓN
function initApp() {
  var metadata = eventData.metadata || {};
  var config = eventData.config || {};
  var support = config.tech_support || {};

  // Configurar títulos y SOS
  var nameEl = document.getElementById('header-event-name');
  if (nameEl) nameEl.textContent = metadata.name || 'Web del Técnico';

  var datesEl = document.getElementById('header-event-dates');
  if (datesEl && metadata.dates) {
    var formatEuroDate = function(d) {
      if (!d) return '';
      var parts = String(d).trim().split('-');
      if (parts.length === 3 && parts[0].length === 4) {
        return parts[2] + '-' + parts[1] + '-' + parts[0];
      }
      return String(d).trim();
    };
    var startD = formatEuroDate(metadata.dates.start);
    var endD = formatEuroDate(metadata.dates.end);
    datesEl.textContent = (startD && endD) ? (startD + ' al ' + endD) : (startD || endD || '');
  }

  var btnSos = document.getElementById('btn-sos-header');
  if (btnSos) {
    btnSos.style.display = 'flex';
  }

  // Cargar salas y sedes
  setupRoomsAndVenues();

  // Cargar días
  renderDaysSelector();

  // Renderizar filtros de sedes y salas unificadas
  renderVenueButtons();
  renderRoomCards();

  // Actualizar badges
  updateGlobalNotesBadge();
  updateBadges();

  // Sincronizar controles de navegación móvil
  updateNavControls();

  // Renderizar contenido
  renderSchedule();
}

// GESTIÓN DE SOS TÉCNICO Y LLAMADA DIRECTA
function openSosModal() {
  var modal = document.getElementById('sos-modal');
  if (!modal) return;

  var config = (eventData && eventData.config) || {};
  var support = config.tech_support || {};
  var phone = (support.phone_whatsapp || '').trim();
  var contactName = support.contact_name || 'Jefe Técnico AV';

  // Información del contacto de soporte
  var infoEl = document.getElementById('sos-support-contact-info');
  if (infoEl) {
    infoEl.textContent = contactName + (phone ? ' • ' + phone : '');
  }

  // Información del canal de radio si está disponible
  var radioBox = document.getElementById('sos-radio-info');
  var radioText = document.getElementById('sos-radio-text');
  if (radioBox && radioText) {
    if (support.channel_radio) {
      radioBox.classList.remove('hidden');
      radioText.textContent = 'Canal de Radio AV: ' + support.channel_radio;
    } else {
      radioBox.classList.add('hidden');
    }
  }

  // Botón de llamada directa por teléfono (tel:)
  var callBtn = document.getElementById('sos-phone-call-btn');
  var callLbl = document.getElementById('sos-phone-call-label');
  if (callBtn) {
    if (phone) {
      var cleanPhone = phone.replace(/[^0-9+]/g, '');
      callBtn.href = 'tel:' + cleanPhone;
      callBtn.classList.remove('hidden');
      if (callLbl) callLbl.textContent = 'Llamar a ' + contactName + ' (' + phone + ')';
    } else {
      callBtn.classList.add('hidden');
    }
  }

  // Poblar selector de salas con la sala actualmente seleccionada
  var select = document.getElementById('sos-room-select');
  if (select) {
    select.innerHTML = '';
    allRoomsList.forEach(function(r) {
      var opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      if (selectedRooms.length === 1 && selectedRooms[0] === r) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
    if (selectedRooms.length > 0 && (!select.value || selectedRooms.includes(selectedRooms[0]))) {
      select.value = selectedRooms[0];
    }
  }

  // Resetear campo de descripción
  var textInput = document.getElementById('sos-issue-text');
  if (textInput) textInput.value = '';

  modal.classList.remove('hidden');
}

function closeSosModal() {
  var modal = document.getElementById('sos-modal');
  if (modal) modal.classList.add('hidden');
}

function sendSosMessage(type) {
  var config = (eventData && eventData.config) || {};
  var support = config.tech_support || {};
  var phone = (support.phone_whatsapp || '').trim();

  var select = document.getElementById('sos-room-select');
  var room = select ? select.value : (selectedRooms[0] || 'Mi Sala');
  var problemInput = document.getElementById('sos-issue-text');
  var problem = problemInput ? problemInput.value.trim() : '';

  var now = new Date();
  var timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  var msg = '🚨 *SOS SOPORTE TÉCNICO*\n' +
            '📍 *Sala:* ' + room + '\n' +
            '⏱️ *Hora:* ' + timeStr + '\n';

  if (problem) {
    msg += '⚠️ *Incidencia:* ' + problem;
  } else {
    msg += '⚠️ *Incidencia:* Solicitud de asistencia técnica urgente en sala.';
  }

  if (phone) {
    var cleanPhone = phone.replace(/[^0-9+]/g, '').replace('+', '');
    var url = 'https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(msg);
    window.open(url, '_blank');
    closeSosModal();
    showToast('Abriendo WhatsApp con mensaje de SOS...', 'fa-paper-plane text-emerald-400');
  } else {
    try {
      navigator.clipboard.writeText(msg);
      showToast('Mensaje SOS copiado (sin teléfono configurado)', 'fa-copy text-amber-400');
    } catch(e) {}
    closeSosModal();
  }
}

// ORGANIZACIÓN DE SALAS Y SEDES
var allRoomsList = [];
var venuesMap = {};

function setupRoomsAndVenues() {
  var schedule = eventData.schedule || { rooms: [], days: [] };
  var rawRooms = schedule.rooms || [];

  // También recopilar salas de las sesiones por si no estuvieran en schedule.rooms
  var foundRooms = new Set();
  (schedule.days || []).forEach(function(d) {
    (d.sessions || []).forEach(function(s) {
      if (s.room) foundRooms.add(s.room.trim());
    });
  });
  rawRooms.forEach(function(r) { foundRooms.add(r.trim()); });

  allRoomsList = Array.from(foundRooms);
  if (allRoomsList.length === 0) {
    allRoomsList = ['Auditorio Principal', 'Sala A', 'Sala B'];
  }

  // Categorizar salas por sede o tipología automáticamente
  venuesMap = {
    'all': { name: 'Todas', rooms: [...allRoomsList] }
  };

  allRoomsList.forEach(function(room) {
    var lower = room.toLowerCase();
    var venueKey = 'sede_principal';
    var venueName = 'Palacio / Principal';

    if (lower.includes('hotel')) {
      venueKey = 'hotel';
      venueName = 'Hotel';
    } else if (lower.includes('poster') || lower.includes('póster') || lower.includes('exhibit')) {
      venueKey = 'posters';
      venueName = 'e-Póster / Zona Exposición';
    } else if (lower.includes('auditorio') || lower.includes('plenaria')) {
      venueKey = 'auditorio';
      venueName = 'Auditorios';
    } else if (lower.includes('taller') || lower.includes('workshop')) {
      venueKey = 'talleres';
      venueName = 'Talleres';
    }

    if (!venuesMap[venueKey]) {
      venuesMap[venueKey] = { name: venueName, rooms: [] };
    }
    venuesMap[venueKey].rooms.push(room);
  });

  // Cargar salas seleccionadas previas
  var savedRooms = safeGet('event_selected_rooms_v1', null);
  if (savedRooms && Array.isArray(savedRooms) && savedRooms.length > 0) {
    selectedRooms = savedRooms;
  } else {
    // Por defecto todas seleccionadas
    selectedRooms = [...allRoomsList];
  }
}

// Helper para formatear el botón del día incorporando el número de día (ej: 25 Domingo)
function formatDayButtonTitle(d, idx) {
  var weekday = (d.label || '').trim();
  var dayNum = '';

  // Verificar si las fechas de los días son idénticas o no secuenciales en los datos
  var allDays = (eventData && eventData.schedule && eventData.schedule.days) || [];
  var uniqueDates = new Set(allDays.map(function(item) { return item.date; }).filter(Boolean));
  var isSameDateForAll = (uniqueDates.size <= 1 && allDays.length > 1);

  if (isSameDateForAll && eventData && eventData.metadata && eventData.metadata.dates && eventData.metadata.dates.start) {
    try {
      var startParts = eventData.metadata.dates.start.split('-');
      if (startParts.length === 3) {
        var baseDate = new Date(parseInt(startParts[0], 10), parseInt(startParts[1], 10) - 1, parseInt(startParts[2], 10));
        baseDate.setDate(baseDate.getDate() + idx);
        dayNum = baseDate.getDate();
      }
    } catch(e) {}
  }

  if (!dayNum && d.date) {
    var strDate = String(d.date).trim();
    // Formato YYYY-MM-DD
    var parts = strDate.split('-');
    if (parts.length === 3 && parts[2]) {
      var n = parseInt(parts[2], 10);
      if (!isNaN(n)) dayNum = n;
    }
    // Formato DD/MM/YYYY o DD-MM-YYYY
    if (!dayNum) {
      var partsSlash = strDate.split(/[\/\.]/);
      if (partsSlash.length >= 2 && !isNaN(parseInt(partsSlash[0], 10))) {
        dayNum = parseInt(partsSlash[0], 10);
      }
    }
  }

  // Días Especiales de Montaje o Desmontaje
  if (d.is_special) {
    var isMontaje = (d.special_type === 'montaje');
    var tag = isMontaje ? 'Montaje' : 'Desmontaje';
    var prefix = isMontaje ? '🛠️ ' : '📦 ';
    if (dayNum && weekday) {
      return prefix + dayNum + ' ' + weekday + ' (' + tag + ')';
    }
    return prefix + (weekday || 'Día') + ' (' + tag + ')';
  }

  // Si la etiqueta ya contiene número (ej: "25 Domingo" o "Domingo 25"), respetarla
  if (weekday && /^\d{1,2}\s+[a-záéíóúñ]+$/i.test(weekday)) {
    return weekday;
  }

  // Limpiar si el weekday tenía un número anterior repetido (ej: "14 Domingo" -> "Domingo")
  if (weekday && /^\d{1,2}\s+(.*)$/.test(weekday)) {
    weekday = weekday.replace(/^\d{1,2}\s+/, '');
  }

  // Formato: "18 Domingo"
  if (dayNum && weekday) {
    return dayNum + ' ' + weekday;
  }
  if (dayNum) {
    return 'Día ' + dayNum;
  }
  if (weekday) {
    return weekday;
  }
  return 'Día ' + (idx + 1);
}

// RENDERIZADO DEL SELECTOR DE DÍAS (BOTONES GRANDES TIPO SEMERGEN)
function renderDaysSelector() {
  var grid = document.getElementById('days-selector-grid');
  if (!grid) return;

  var days = (eventData.schedule && eventData.schedule.days) || [];
  if (days.length === 0) {
    grid.innerHTML = '<div class="col-span-full text-xs text-slate-400">Sin jornadas definidas</div>';
    return;
  }

  var html = '';
  days.forEach(function(d, idx) {
    var isSelected = (selectedDayIdx === idx);
    var label = formatDayButtonTitle(d, idx);
    var sessionCount = (d.sessions || []).length;
    var isSpecial = !!d.is_special;
    var isMontaje = (d.special_type === 'montaje');

    var btnClass = '';
    var titleClass = '';
    var subClass = '';

    if (isSpecial) {
      if (isSelected) {
        btnClass = isMontaje 
          ? 'bg-amber-600 text-white border-amber-600 shadow-md ring-2 ring-amber-400/50 font-bold' 
          : 'bg-indigo-700 text-white border-indigo-700 shadow-md ring-2 ring-indigo-400/50 font-bold';
        titleClass = 'text-white';
        subClass = 'text-amber-100';
      } else {
        btnClass = isMontaje 
          ? 'bg-amber-50 text-amber-950 border-amber-300 hover:border-amber-400 font-bold' 
          : 'bg-indigo-50 text-indigo-950 border-indigo-300 hover:border-indigo-400 font-bold';
        titleClass = isMontaje ? 'text-amber-900' : 'text-indigo-900';
        subClass = isMontaje ? 'text-amber-700 font-semibold' : 'text-indigo-700 font-semibold';
      }
    } else {
      if (isSelected) {
        btnClass = 'bg-teal-800 text-white border-teal-800 shadow-md ring-2 ring-teal-500/40 font-bold';
        titleClass = 'text-amber-300';
        subClass = 'text-teal-100 font-semibold';
      } else {
        btnClass = 'bg-white text-slate-700 border-slate-200 hover:border-teal-300';
        titleClass = 'text-teal-900';
        subClass = 'text-slate-500 font-semibold';
      }
    }

    html += '<button onclick="selectDayByIndex(' + idx + ')" ' +
      'class="p-2 sm:p-2.5 rounded-xl border text-center transition cursor-pointer flex flex-col items-center justify-center active:scale-95 ' + btnClass + '">' +
      '<span class="text-xs sm:text-sm font-black ' + titleClass + '">' +
        escapeHtml(label) +
      '</span>' +
      '<span class="text-[10px] ' + subClass + ' mt-0.5">' +
        (isSpecial ? (isMontaje ? 'Montaje Técnico AV' : 'Desmontaje y Carga') : (sessionCount + ' ' + (sessionCount === 1 ? 'sesión' : 'sesiones'))) +
      '</span>' +
    '</button>';
  });

  grid.innerHTML = html;
}

function selectDayByIndex(idx) {
  selectedDayIdx = idx;
  renderDaysSelector();
  renderSchedule();
}

// BOTONES DE SEDES (SOLO SI HAY MÚLTIPLES)
function renderVenueButtons() {
  var container = document.getElementById('venues-buttons-container');
  if (!container) return;

  var keys = Object.keys(venuesMap);
  if (keys.length <= 1) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');

  var html = '<div class="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-xl text-xs w-full mb-1">';
  keys.forEach(function(key) {
    var v = venuesMap[key];
    var isActive = (currentVenue === key);
    var count = v.rooms.length;

    html += '<button onclick="filterByVenue(\'' + key + '\')" ' +
      'class="px-2.5 py-1 rounded-lg font-bold transition cursor-pointer text-xs ' +
      (isActive ? 'bg-teal-800 text-white shadow-sm' : 'text-slate-600 hover:bg-white/80') + '">' +
      escapeHtml(v.name) + ' (' + count + ')' +
    '</button>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function filterByVenue(venueKey) {
  currentVenue = venueKey;
  if (venueKey === 'all') {
    selectedRooms = [...allRoomsList];
  } else if (venuesMap[venueKey]) {
    selectedRooms = [...venuesMap[venueKey].rooms];
  }
  safeSet('event_selected_rooms_v1', selectedRooms);
  renderVenueButtons();
  renderRoomCards();
  renderSchedule();
}

// GESTIÓN DE CHECKLIST DE MONTAJE TÉCNICO AV POR SALA
var currentChecklistRoom = null;

var DEFAULT_CHECKLIST_TEMPLATE = [
  '2 Micrófonos de diadema inalámbricos',
  '3 Micrófonos de presidencia / atril',
  'Portátil de sala / proyección (HDMI OK)',
  'Monitor de referencia / retorno en escenario',
  'Proyector / Pantalla LED en retro (Resolución OK)',
  'Puntero láser y mando pasador (Pilas comprobadas)',
  'Cableado HDMI, adaptadores USB-C y corriente',
  'Sonorización PA y mesa de audio ecualizada',
  'Canal de Radio AV / Walkie-talkie sincronizado'
];

function getRoomChecklist(roomName) {
  var allChecklists = safeGet('room_checklists_v2', {});
  if (!allChecklists[roomName]) {
    allChecklists[roomName] = {
      items: DEFAULT_CHECKLIST_TEMPLATE.map(function(name, i) {
        return { id: 'chk_' + i, text: name, checked: false };
      })
    };
    safeSet('room_checklists_v2', allChecklists);
  }
  return allChecklists[roomName];
}

function saveRoomChecklist(roomName, checklistData) {
  var allChecklists = safeGet('room_checklists_v2', {});
  allChecklists[roomName] = checklistData;
  safeSet('room_checklists_v2', allChecklists);
  renderRoomCards();
}

function isRoomChecklistComplete(roomName) {
  var chk = getRoomChecklist(roomName);
  var items = chk.items || [];
  if (items.length === 0) return true;
  return items.every(function(it) { return !!it.checked; });
}

function openRoomChecklistModal(roomName) {
  currentChecklistRoom = roomName;
  var modal = document.getElementById('room-checklist-modal');
  if (!modal) return;

  var titleEl = document.getElementById('checklist-room-name');
  if (titleEl) titleEl.textContent = roomName;

  renderChecklistModalContent();
  modal.classList.remove('hidden');
}

function closeRoomChecklistModal() {
  var modal = document.getElementById('room-checklist-modal');
  if (modal) modal.classList.add('hidden');
  currentChecklistRoom = null;
}

function renderChecklistModalContent() {
  if (!currentChecklistRoom) return;
  var chk = getRoomChecklist(currentChecklistRoom);
  var items = chk.items || [];
  var checkedCount = items.filter(function(it) { return it.checked; }).length;
  var isAllDone = (items.length > 0 && checkedCount === items.length);

  var badge = document.getElementById('checklist-status-badge');
  if (badge) {
    if (isAllDone) {
      badge.className = 'text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-emerald-500 text-slate-950 shadow-sm';
      badge.textContent = '✓ Montaje Completo';
    } else {
      badge.className = 'text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 shadow-sm';
      badge.textContent = '⚠️ Pendiente (' + checkedCount + '/' + items.length + ')';
    }
  }

  var counter = document.getElementById('checklist-counter');
  if (counter) {
    counter.innerHTML = '<i class="fa-solid fa-sliders text-teal-600"></i> Elementos verificados: ' + checkedCount + '/' + items.length;
  }

  var container = document.getElementById('checklist-items-container');
  if (!container) return;

  var html = '';
  items.forEach(function(item) {
    html += '<div class="flex items-center justify-between p-2 rounded-xl border transition ' +
      (item.checked ? 'bg-emerald-50 border-emerald-300 text-slate-900' : 'bg-slate-50 border-slate-200 text-slate-700') + '">' +
      
      '<label class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer select-none">' +
        '<input type="checkbox" ' + (item.checked ? 'checked' : '') + ' onchange="toggleChecklistItem(\'' + item.id + '\', this.checked)" class="rounded w-4 h-4 text-teal-600 focus:ring-teal-500 cursor-pointer">' +
        '<span class="text-xs font-semibold ' + (item.checked ? 'line-through text-slate-400 font-normal' : 'text-slate-800') + '">' +
          escapeHtml(item.text) +
        '</span>' +
      '</label>' +

      '<button onclick="deleteChecklistItem(\'' + item.id + '\')" class="p-1 text-slate-400 hover:text-rose-600 transition cursor-pointer ml-2" title="Eliminar este requisito">' +
        '<i class="fa-regular fa-trash-can text-xs"></i>' +
      '</button>' +

    '</div>';
  });

  if (items.length === 0) {
    html = '<div class="p-4 text-center text-xs text-slate-400">Sin elementos en el checklist. Añade uno abajo.</div>';
  }

  container.innerHTML = html;
}

function toggleChecklistItem(itemId, isChecked) {
  if (!currentChecklistRoom) return;
  var chk = getRoomChecklist(currentChecklistRoom);
  (chk.items || []).forEach(function(it) {
    if (it.id === itemId) it.checked = isChecked;
  });
  saveRoomChecklist(currentChecklistRoom, chk);
  renderChecklistModalContent();
}

function toggleAllChecklistItems(state) {
  if (!currentChecklistRoom) return;
  var chk = getRoomChecklist(currentChecklistRoom);
  (chk.items || []).forEach(function(it) {
    it.checked = state;
  });
  saveRoomChecklist(currentChecklistRoom, chk);
  renderChecklistModalContent();
  showToast(state ? 'Montaje marcado como completo' : 'Checklist desmarcado', 'fa-check text-emerald-400');
}

function addCustomChecklistItem() {
  if (!currentChecklistRoom) return;
  var input = document.getElementById('new-checklist-item-input');
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;

  var chk = getRoomChecklist(currentChecklistRoom);
  chk.items = chk.items || [];
  chk.items.push({
    id: 'chk_' + Date.now(),
    text: text,
    checked: false
  });
  saveRoomChecklist(currentChecklistRoom, chk);
  input.value = '';
  renderChecklistModalContent();
  showToast('Elemento añadido al checklist', 'fa-plus text-teal-400');
}

function deleteChecklistItem(itemId) {
  if (!currentChecklistRoom) return;
  var chk = getRoomChecklist(currentChecklistRoom);
  chk.items = (chk.items || []).filter(function(it) { return it.id !== itemId; });
  saveRoomChecklist(currentChecklistRoom, chk);
  renderChecklistModalContent();
}

// SELECTOR ÚNICO Y LIMPIO DE SALAS EN LÍNEA (NO EN CAJAS, APROVECHANDO EL ESPACIO VERTICAL)
function renderRoomCards() {
  var container = document.getElementById('rooms-grid');
  if (!container) return;

  var html = '';
  allRoomsList.forEach(function(room) {
    var isSelected = selectedRooms.includes(room);
    var isOnlyThis = (selectedRooms.length === 1 && selectedRooms[0] === room);
    var chk = getRoomChecklist(room);
    var items = chk.items || [];
    var checkedCount = items.filter(function(it) { return it.checked; }).length;
    var isChkDone = (items.length > 0 && checkedCount === items.length);

    html += '<div class="room-row-item flex items-center justify-between p-2 sm:p-2.5 rounded-xl border transition cursor-pointer select-none gap-2 ' +
      (isSelected 
        ? 'bg-teal-50 border-teal-400 text-teal-950 shadow-sm ring-1 ring-teal-500/20 is-selected' 
        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50') + '" ' +
      'onclick="toggleRoomSelection(\'' + escapeJsString(room) + '\')">' +
      
      // Lado izquierdo: Icono de sala y Nombre Completo sin cortar
      '<div class="flex items-center gap-2 min-w-0 flex-1">' +
        '<i class="fa-solid ' + (isSelected ? 'fa-door-open text-teal-600' : 'fa-door-closed text-slate-400') + ' text-sm shrink-0"></i>' +
        '<span class="text-xs sm:text-sm font-bold text-slate-900 room-title truncate leading-tight ' + (isSelected ? 'font-black text-teal-950' : '') + '">' +
          escapeHtml(room) +
        '</span>' +
      '</div>' +

      // Lado derecho: Acciones compactas en línea (Checklist + Solo + Checkbox)
      '<div class="flex items-center gap-1.5 shrink-0">' +
        // Botón Checklist compacto
        '<button onclick="openRoomChecklistModal(\'' + escapeJsString(room) + '\'); event.stopPropagation();" class="inline-flex items-center gap-1 font-bold text-[10.5px] px-2 py-1 rounded-lg border transition cursor-pointer ' +
          (isChkDone 
            ? 'bg-emerald-100 text-emerald-900 border-emerald-300 hover:bg-emerald-200' 
            : 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200') + '" title="Checklist Equipamiento AV">' +
          '<i class="fa-solid ' + (isChkDone ? 'fa-circle-check text-emerald-600' : 'fa-clock text-amber-600') + ' text-[10px]"></i>' +
          '<span>' + (isChkDone ? 'Montaje OK' : 'Checklist (' + checkedCount + '/' + items.length + ')') + '</span>' +
        '</button>' +

        // Botón Solo / Mi Sala
        '<button onclick="selectSingleRoom(\'' + escapeJsString(room) + '\'); event.stopPropagation();" title="Ver únicamente esta sala" ' +
          'class="text-[10.5px] font-black uppercase px-2 py-1 rounded-lg transition cursor-pointer ' +
          (isOnlyThis 
            ? 'bg-amber-400 text-slate-950 shadow-sm ring-1 ring-amber-500 font-black' 
            : 'bg-slate-100 hover:bg-teal-600 hover:text-white text-slate-600 border border-slate-200') + '">' +
          (isOnlyThis ? '★ Mi Sala' : 'Solo') +
        '</button>' +

        // Checkbox visual de selección
        '<div class="w-5 h-5 rounded-md flex items-center justify-center transition ' + 
          (isSelected ? 'bg-teal-600 text-white shadow-sm' : 'border border-slate-300 bg-white') + '">' +
          (isSelected ? '<i class="fa-solid fa-check text-[10px]"></i>' : '') +
        '</div>' +
      '</div>' +

    '</div>';
  });

  container.innerHTML = html;
  updateBadges();
}

// Aliases para máxima compatibilidad
function renderQuickTechButtons() { renderRoomCards(); }
function renderRoomCheckboxes() { renderRoomCards(); }

function toggleRoomSelection(room) {
  if (selectedRooms.includes(room)) {
    selectedRooms = selectedRooms.filter(function(r) { return r !== room; });
  } else {
    selectedRooms.push(room);
  }
  safeSet('event_selected_rooms_v1', selectedRooms);
  renderRoomCards();
  renderSchedule();
}

function selectSingleRoom(roomName) {
  selectedRooms = [roomName];
  safeSet('event_selected_rooms_v1', selectedRooms);
  renderRoomCards();
  renderSchedule();
  showToast('Modo exclusivo: ' + roomName, 'fa-door-open text-teal-400');
}

function selectAllRooms(state) {
  selectedRooms = state ? [...allRoomsList] : [];
  safeSet('event_selected_rooms_v1', selectedRooms);
  renderRoomCards();
  renderSchedule();
  showToast(state ? 'Mostrando todas las salas' : 'Filtro limpiado (0 salas)', 'fa-layer-group text-teal-400');
}

function updateBadges() {
  var b = document.getElementById('selected-rooms-badge');
  var mobB = document.getElementById('mobile-filter-badge');
  var mobNavB = document.getElementById('mobile-nav-badge');
  var txt = selectedRooms.length + ' de ' + allRoomsList.length + ' salas';
  if (b) b.textContent = txt;
  if (mobB) mobB.textContent = selectedRooms.length;
  if (mobNavB) mobNavB.textContent = selectedRooms.length;
}

// BÚSQUEDA GLOBAL EN TIEMPO REAL CON LISTA DETALLADA (TODOS LOS DÍAS Y SALAS)
function handleLiveSearch(query) {
  var term = (query || '').toLowerCase().trim();
  currentSearchTerm = term;

  var clearBtn = document.getElementById('btn-clear-search');
  if (clearBtn) {
    if (term) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }

  var resultsBox = document.getElementById('live-search-results-box');
  var resultsList = document.getElementById('live-search-list');
  var counterEl = document.getElementById('live-search-counter');

  if (!term || term.length < 2) {
    if (resultsBox) resultsBox.classList.add('hidden');
    renderSchedule();
    return;
  }

  var days = (eventData && eventData.schedule && eventData.schedule.days) || [];
  var matches = [];

  days.forEach(function(day, dayIdx) {
    var dayLabel = formatDayButtonTitle(day, dayIdx);
    (day.sessions || []).forEach(function(s) {
      var roomName = (s.room || 'Sala').trim();
      var sessionTitle = s.title || '';
      var timeStr = (s.time_start || '') + (s.time_end ? ' - ' + s.time_end : '');

      var matchFound = false;
      var matchContext = '';

      if (sessionTitle.toLowerCase().includes(term)) {
        matchFound = true;
        matchContext = sessionTitle;
      }

      if (roomName.toLowerCase().includes(term)) {
        matchFound = true;
        matchContext = 'Sala: ' + roomName + ' - ' + sessionTitle;
      }

      (s.speakers || []).forEach(function(sp) {
        if (String(sp).toLowerCase().includes(term)) {
          matchFound = true;
          matchContext = 'Ponente: ' + sp + ' (' + sessionTitle + ')';
        }
      });
      (s.moderators || []).forEach(function(m) {
        if (String(m).toLowerCase().includes(term)) {
          matchFound = true;
          matchContext = 'Moderador: ' + m + ' (' + sessionTitle + ')';
        }
      });

      (s.sub_talks || []).forEach(function(t) {
        if ((t.title || '').toLowerCase().includes(term)) {
          matchFound = true;
          matchContext = 'Ponencia: ' + t.title + (t.speaker ? ' [' + t.speaker + ']' : '');
        } else if ((t.speaker || '').toLowerCase().includes(term)) {
          matchFound = true;
          matchContext = 'Ponente: ' + t.speaker + ' (' + (t.title || sessionTitle) + ')';
        }
      });

      if (matchFound) {
        matches.push({
          dayIdx: dayIdx,
          dayLabel: dayLabel,
          room: roomName,
          time: timeStr,
          sessionId: s.id,
          sessionTitle: sessionTitle,
          context: matchContext,
          type: s.type || 'Sesión'
        });
      }
    });
  });

  if (resultsBox && resultsList) {
    resultsBox.classList.remove('hidden');
    if (counterEl) {
      counterEl.innerHTML = '<i class="fa-solid fa-magnifying-glass text-teal-400"></i> ' + matches.length + ' resultado(s) para "' + escapeHtml(term) + '"';
    }

    if (matches.length === 0) {
      resultsList.innerHTML = '<div class="py-4 text-center text-xs text-slate-400">' +
        'No se encontraron ponentes, ponencias ni salas con "' + escapeHtml(term) + '"' +
        '</div>';
    } else {
      var html = '';
      matches.slice(0, 30).forEach(function(m) {
        html += '<div onclick="goToSearchResult(' + m.dayIdx + ', \'' + escapeJsString(m.room) + '\', \'' + m.sessionId + '\')" ' +
          'class="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700/90 active:bg-slate-700 transition cursor-pointer border border-slate-700 space-y-1">' +
          
          '<div class="flex items-center justify-between gap-1.5 flex-wrap">' +
            '<span class="bg-amber-400 text-slate-950 font-black text-[10px] px-2 py-0.5 rounded-md">' + escapeHtml(m.dayLabel) + '</span>' +
            '<span class="font-mono text-[10px] text-amber-300 font-bold bg-slate-900 px-1.5 py-0.5 rounded">' + m.time + '</span>' +
            '<span class="text-teal-300 font-bold text-[10px] bg-teal-950/70 border border-teal-800 px-1.5 py-0.5 rounded">' + escapeHtml(m.room) + '</span>' +
          '</div>' +

          '<div class="text-xs font-bold text-white leading-snug line-clamp-2">' + escapeHtml(m.context || m.sessionTitle) + '</div>' +
          '<div class="text-[9.5px] text-slate-400 flex items-center justify-between pt-0.5">' +
            '<span>Sesión: ' + escapeHtml(m.sessionTitle) + '</span>' +
            '<span class="text-teal-400 font-bold">Ver sesión &rsaquo;</span>' +
          '</div>' +

        '</div>';
      });

      if (matches.length > 30) {
        html += '<div class="text-center text-[10px] text-slate-400 pt-1">Mostrando los primeros 30 resultados. Afina tu búsqueda.</div>';
      }

      resultsList.innerHTML = html;
    }
  }

  renderSchedule();
}

function clearLiveSearch() {
  var input = document.getElementById('session-search-input');
  if (input) input.value = '';
  currentSearchTerm = '';
  var clearBtn = document.getElementById('btn-clear-search');
  if (clearBtn) clearBtn.classList.add('hidden');
  var resultsBox = document.getElementById('live-search-results-box');
  if (resultsBox) resultsBox.classList.add('hidden');
  renderSchedule();
}

function goToSearchResult(dayIdx, roomName, sessionId) {
  selectedDayIdx = dayIdx;
  renderDaysSelector();

  if (!selectedRooms.includes(roomName)) {
    selectedRooms = [roomName];
    safeSet('event_selected_rooms_v1', selectedRooms);
    renderRoomCards();
  }

  toggleMobileDrawer();
  clearLiveSearch();

  renderSchedule();
  setTimeout(function() {
    openSessionDetailModal(sessionId);
  }, 150);

  showToast('Navegando a la sesión de ' + roomName, 'fa-arrow-right text-teal-400');
}

function filterBySearch() {
  var input = document.getElementById('session-search-input');
  if (input) handleLiveSearch(input.value);
}

// GESTIÓN DEL MODAL DE DATOS TÉCNICOS DE PRODUCCIÓN Y TIMING
function openProductionModal() {
  var modal = document.getElementById('production-modal');
  if (!modal) return;

  var config = (eventData && eventData.config) || {};
  var support = config.tech_support || {};
  var rawNotes = config.production_notes || '';

  // 1. Tarjetas Wi-Fi
  var wifiContainer = document.getElementById('production-wifi-cards');
  if (wifiContainer) {
    var wifiStaffSSID = 'IceIceBaby';
    var wifiStaffPass = 'VanillaIce!@';
    var wifiPubSSID = 'uTAS-CBMS';
    var wifiPubPass = 'microtas26';

    var lines = rawNotes.split('\n');
    lines.forEach(function(l) {
      if (l.toLowerCase().includes('staff') && l.includes('Pass:')) {
        var mPass = l.match(/Pass:\s*([^\s]+)/);
        var mSsid = l.match(/SSID:\s*([^\s\/]+)/);
        if (mPass && mPass[1]) wifiStaffPass = mPass[1];
        if (mSsid && mSsid[1]) wifiStaffSSID = mSsid[1];
      }
      if (l.toLowerCase().includes('public') && l.includes('Pass:')) {
        var mPass = l.match(/Pass:\s*([^\s]+)/);
        var mSsid = l.match(/SSID:\s*([^\s\/]+)/);
        if (mPass && mPass[1]) wifiPubPass = mPass[1];
        if (mSsid && mSsid[1]) wifiPubSSID = mSsid[1];
      }
    });

    wifiContainer.innerHTML = 
      '<div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200">' +
        '<div class="flex items-center justify-between text-xs font-bold text-slate-800 mb-1">' +
          '<span class="flex items-center gap-1.5"><i class="fa-solid fa-lock text-amber-500"></i> Wi-Fi Staff / Técnico:</span>' +
          '<button onclick="copyTextToClipboard(\'' + escapeJsString(wifiStaffPass) + '\', \'Contraseña Wi-Fi Staff\')" class="text-[10px] text-teal-700 hover:underline font-bold cursor-pointer">Copiar Clave</button>' +
        '</div>' +
        '<div class="text-[11px] font-mono text-slate-600">SSID: <strong class="text-slate-900">' + escapeHtml(wifiStaffSSID) + '</strong></div>' +
        '<div class="text-[11px] font-mono text-slate-600">Pass: <strong class="text-slate-900 select-all">' + escapeHtml(wifiStaffPass) + '</strong></div>' +
      '</div>' +

      '<div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200">' +
        '<div class="flex items-center justify-between text-xs font-bold text-slate-800 mb-1">' +
          '<span class="flex items-center gap-1.5"><i class="fa-solid fa-wifi text-teal-600"></i> Wi-Fi Público:</span>' +
          '<button onclick="copyTextToClipboard(\'' + escapeJsString(wifiPubPass) + '\', \'Contraseña Wi-Fi Público\')" class="text-[10px] text-teal-700 hover:underline font-bold cursor-pointer">Copiar Clave</button>' +
        '</div>' +
        '<div class="text-[11px] font-mono text-slate-600">SSID: <strong class="text-slate-900">' + escapeHtml(wifiPubSSID) + '</strong></div>' +
        '<div class="text-[11px] font-mono text-slate-600">Pass: <strong class="text-slate-900 select-all">' + escapeHtml(wifiPubPass) + '</strong></div>' +
      '</div>';
  }

  // 2. Control Central
  var ctrlEl = document.getElementById('production-control-center');
  if (ctrlEl) {
    var ctrlLoc = 'Zaguán Sala Falla (Planta Baja)';
    var lines = rawNotes.split('\n');
    lines.forEach(function(l) {
      if (l.toLowerCase().includes('control central')) {
        var parts = l.split(':');
        if (parts.length > 1) ctrlLoc = parts.slice(1).join(':').trim();
      }
    });
    ctrlEl.textContent = ctrlLoc;
  }

  // 3. Canal de Radio
  var radioEl = document.getElementById('production-radio-channel');
  if (radioEl) {
    radioEl.textContent = support.channel_radio || 'Canal 2 (Audio/Video)';
  }

  // 4. Contacto Jefe Técnico
  var nameEl = document.getElementById('production-contact-name');
  var phoneEl = document.getElementById('production-contact-phone');
  var btnWa = document.getElementById('production-btn-whatsapp');
  var btnCall = document.getElementById('production-btn-call');
  if (nameEl) nameEl.textContent = support.contact_name || 'Fran Jefe Técnico AV';
  if (phoneEl) phoneEl.textContent = support.phone_whatsapp || '+34 609442342';
  if (support.phone_whatsapp) {
    var clean = support.phone_whatsapp.replace(/[^0-9+]/g, '');
    if (btnWa) btnWa.href = 'https://wa.me/' + clean.replace('+', '') + '?text=' + encodeURIComponent('Hola Fran, te escribo desde la sala:');
    if (btnCall) btnCall.href = 'tel:' + clean;
  }

  // 5. Timing Lead
  var leadEl = document.getElementById('production-timing-lead');
  if (leadEl) {
    leadEl.textContent = (config.warning_lead_time_minutes || 10) + ' minutos';
  }

  // 6. Notas de Producción
  var notesEl = document.getElementById('production-full-notes');
  if (notesEl) {
    notesEl.textContent = rawNotes || 'Sin notas adicionales de producción.';
  }

  modal.classList.remove('hidden');
}

function closeProductionModal() {
  var modal = document.getElementById('production-modal');
  if (modal) modal.classList.add('hidden');
}

function copyTextToClipboard(text, label) {
  try {
    navigator.clipboard.writeText(text);
    showToast('Copiado: ' + label, 'fa-copy text-teal-400');
  } catch(e) {
    showToast('Texto: ' + text, 'fa-copy text-amber-400');
  }
}

// TOGGLE VISTAS Y OPCIONES
var currentViewMode = 'list'; // 'list' (tarjetas) | 'grid' (parrilla)

function setViewMode(mode) {
  currentViewMode = mode;
  var btnList = document.getElementById('btn-view-list');
  var btnGrid = document.getElementById('btn-view-grid');
  if (btnList && btnGrid) {
    if (mode === 'list') {
      btnList.className = 'px-2.5 py-1 rounded-md font-bold transition bg-white shadow-sm text-slate-800 cursor-pointer';
      btnGrid.className = 'px-2.5 py-1 rounded-md font-bold transition text-slate-600 hover:text-slate-900 cursor-pointer';
    } else {
      btnGrid.className = 'px-2.5 py-1 rounded-md font-bold transition bg-white shadow-sm text-slate-800 cursor-pointer';
      btnList.className = 'px-2.5 py-1 rounded-md font-bold transition text-slate-600 hover:text-slate-900 cursor-pointer';
    }
  }
  updateNavControls();
  renderSchedule();
}

function toggleViewModeMobile() {
  var nextMode = (currentViewMode === 'list') ? 'grid' : 'list';
  setViewMode(nextMode);
  showToast(nextMode === 'grid' ? 'Vista Parrilla activada' : 'Vista Tarjetas activada', 'fa-table-columns text-teal-400');
}

function toggleCompactMode() {
  isCompactView = !isCompactView;
  safeSet('event_compact_view_v1', isCompactView);
  visibleSpeakersMap = {};
  var btnTxt = document.getElementById('txt-compact');
  var btnIcon = document.getElementById('icon-compact');
  if (btnTxt) btnTxt.textContent = isCompactView ? 'Modo Compacto' : 'Vista Detallada';
  if (btnIcon) btnIcon.className = isCompactView ? 'fa-solid fa-compress text-amber-600' : 'fa-solid fa-expand text-slate-600';
  updateNavControls();
  renderSchedule();
}

function toggleCompactModeMobile() {
  toggleCompactMode();
  showToast(isCompactView ? 'Modo Compacto activado' : 'Modo Detallado activado', 'fa-compress text-amber-400');
}

function toggleAllSpeakers() {
  globalShowSpeakers = !globalShowSpeakers;
  visibleSpeakersMap = {};
  var txt = document.getElementById('txt-toggle-speakers');
  if (txt) txt.textContent = globalShowSpeakers ? 'Ocultar Ponentes' : 'Ver Ponentes';
  updateNavControls();
  renderSchedule();
}

function toggleAllSpeakersMobile() {
  toggleAllSpeakers();
  showToast(globalShowSpeakers ? 'Mostrando ponentes' : 'Ponentes ocultados', 'fa-user-tie text-teal-400');
}

function updateNavControls() {
  // 1. Vista en barra inferior (Parrilla / Tarjetas)
  var viewIcon = document.getElementById('mobile-icon-view');
  var viewLabel = document.getElementById('mobile-label-view');
  var viewBtn = document.getElementById('mobile-btn-view');
  if (viewIcon && viewLabel) {
    if (currentViewMode === 'grid') {
      viewIcon.className = 'fa-solid fa-list text-base text-teal-600';
      viewLabel.textContent = 'Tarjetas';
      if (viewBtn) viewBtn.classList.add('text-teal-600');
    } else {
      viewIcon.className = 'fa-solid fa-table-columns text-base';
      viewLabel.textContent = 'Parrilla';
      if (viewBtn) viewBtn.classList.remove('text-teal-600');
    }
  }

  // 2. Ponentes en barra inferior
  var spkIcon = document.getElementById('mobile-icon-speakers');
  var spkLabel = document.getElementById('mobile-label-speakers');
  var spkBtn = document.getElementById('mobile-btn-speakers');
  if (spkIcon && spkLabel) {
    if (globalShowSpeakers) {
      spkIcon.className = 'fa-solid fa-user-tie text-base text-teal-600';
      spkLabel.textContent = 'Ponentes';
      if (spkBtn) spkBtn.classList.add('text-teal-600');
    } else {
      spkIcon.className = 'fa-solid fa-user-slash text-base text-slate-400';
      spkLabel.textContent = 'Ocultos';
      if (spkBtn) spkBtn.classList.remove('text-teal-600');
    }
  }

  // 3. Compacto en barra inferior
  var compIcon = document.getElementById('mobile-icon-compact');
  var compLabel = document.getElementById('mobile-compact-label');
  var compBtn = document.getElementById('mobile-btn-compact');
  if (compIcon && compLabel) {
    if (isCompactView) {
      compIcon.className = 'fa-solid fa-compress text-base text-amber-500';
      compLabel.textContent = 'Compacto';
      if (compBtn) compBtn.classList.add('text-amber-500');
    } else {
      compIcon.className = 'fa-solid fa-expand text-base text-slate-600';
      compLabel.textContent = 'Detallada';
      if (compBtn) compBtn.classList.remove('text-amber-500');
    }
  }
}

function toggleSessionSpeakers(sessionId) {
  var isCurrentlyOpen;
  if (visibleSpeakersMap[sessionId] !== undefined) {
    isCurrentlyOpen = visibleSpeakersMap[sessionId];
  } else {
    isCurrentlyOpen = !isCompactView;
  }
  visibleSpeakersMap[sessionId] = !isCurrentlyOpen;
  renderSchedule();
}

function toggleMobileDrawer() {
  var drawer = document.getElementById('filter-drawer');
  if (drawer) drawer.classList.toggle('hidden');
}

// CLASIFICACIÓN DE BADGE POR TIPO
function getTypeBadgeClass(title, type) {
  var text = ((type || '') + ' ' + (title || '')).toLowerCase();
  if (text.includes('mesa') || text.includes('round table')) return 'badge-mesa';
  if (text.includes('taller') || text.includes('workshop')) return 'badge-taller';
  if (text.includes('keynote') || text.includes('inaugural') || text.includes('clausura') || text.includes('plenaria')) return 'badge-keynote';
  if (text.includes('simposio') || text.includes('symposium')) return 'badge-simposio';
  if (text.includes('conferencia') || text.includes('lecture')) return 'badge-conferencia';
  if (text.includes('oral') || text.includes('comunicación')) return 'badge-oral';
  if (text.includes('poster') || text.includes('póster')) return 'badge-poster';
  return 'badge-default';
}

function getTypeBadgeLabel(title, type) {
  if (type) return type;
  var text = (title || '').toLowerCase();
  if (text.includes('mesa') || text.includes('round table')) return 'Mesa Redonda';
  if (text.includes('taller') || text.includes('workshop')) return 'Taller / Workshop';
  if (text.includes('keynote') || text.includes('plenaria')) return 'Keynote / Plenaria';
  if (text.includes('simposio') || text.includes('symposium')) return 'Simposio';
  if (text.includes('conferencia')) return 'Conferencia';
  if (text.includes('oral')) return 'Com. Oral';
  if (text.includes('poster') || text.includes('póster')) return 'Póster';
  return 'Sesión';
}

// RENDERIZADO PRINCIPAL (TARJETAS DE SESIONES AGRUPADAS POR HORARIO)
function renderSchedule() {
  var output = document.getElementById('schedule-output');
  if (!output) return;

  var days = (eventData.schedule && eventData.schedule.days) || [];
  var currentDay = days[selectedDayIdx];

  if (!currentDay) {
    output.innerHTML = '<div class="text-center py-12 text-slate-400">No hay sesiones para este día.</div>';
    return;
  }

  var rawSessions = currentDay.sessions || [];

  // Filtrado por salas seleccionadas y búsqueda
  var filtered = rawSessions.filter(function(s) {
    var roomName = (s.room || '').trim();
    if (selectedRooms.length > 0 && !selectedRooms.includes(roomName)) {
      return false;
    }

    if (currentSearchTerm) {
      var matchTitle = (s.title || '').toLowerCase().includes(currentSearchTerm);
      var matchRoom = roomName.toLowerCase().includes(currentSearchTerm);
      var matchMods = (s.moderators || []).join(' ').toLowerCase().includes(currentSearchTerm);
      var matchTalks = (s.sub_talks || []).some(function(t) {
        return (t.title || '').toLowerCase().includes(currentSearchTerm) ||
               (t.speaker || '').toLowerCase().includes(currentSearchTerm);
      });
      if (!matchTitle && !matchRoom && !matchMods && !matchTalks) {
        return false;
      }
    }
    return true;
  });

  // Ordenar siempre cronológicamente por hora de inicio antes de renderizar
  filtered.sort(function(a, b) {
    var ta = String(a.time_start || '00:00').trim();
    var tb = String(b.time_start || '00:00').trim();
    var comp = ta.localeCompare(tb);
    if (comp !== 0) return comp;
    return String(a.room || '').localeCompare(String(b.room || ''));
  });

  if (filtered.length === 0) {
    output.innerHTML = '<div class="text-center py-12 px-4">' +
      '<i class="fa-solid fa-calendar-xmark text-4xl text-slate-300 mb-3 block"></i>' +
      '<h3 class="text-base font-bold text-slate-700">No hay sesiones para mostrar con estos filtros</h3>' +
      '<p class="text-xs text-slate-500 mt-1">Prueba a seleccionar más salas o borrar el término de búsqueda.</p>' +
      '<div class="mt-4 flex flex-wrap justify-center gap-2">' +
        '<button onclick="selectAllRooms(true)" class="bg-teal-800 text-white text-xs font-bold px-4 py-2 rounded-xl shadow active:scale-95 cursor-pointer">' +
          'Mostrar Todas las Salas (' + allRoomsList.length + ')' +
        '</button>' +
        (currentSearchTerm ? '<button onclick="document.getElementById(\'session-search-input\').value=\'\'; filterBySearch();" class="bg-slate-200 text-slate-800 text-xs font-bold px-3 py-2 rounded-xl active:scale-95 cursor-pointer">Limpiar Búsqueda</button>' : '') +
      '</div>' +
    '</div>';
    return;
  }

  if (currentViewMode === 'list') {
    renderCardListView(output, filtered, currentDay);
  } else {
    renderGridView(output, filtered, currentDay);
  }

  evaluateLiveSessions();
}

// VISTA HORARIA CON TARJETAS
function renderCardListView(output, sessions, currentDay) {
  // Agrupar por franja horaria
  var groupedByTime = {};
  var timesList = [];

  sessions.forEach(function(s) {
    var timeSlot = (s.time_start || '00:00') + ' - ' + (s.time_end || '00:00');
    if (!groupedByTime[timeSlot]) {
      groupedByTime[timeSlot] = [];
      timesList.push(timeSlot);
    }
    groupedByTime[timeSlot].push(s);
  });

  // Asegurar ordenación cronológica de las franjas horarias
  timesList.sort(function(a, b) {
    return a.localeCompare(b);
  });

  var specialBanner = '';
  if (currentDay && currentDay.is_special) {
    var isMontaje = (currentDay.special_type === 'montaje');
    specialBanner = '<div class="mb-3 p-3 rounded-2xl border flex items-center justify-between gap-3 flex-wrap ' +
      (isMontaje ? 'bg-amber-500/10 border-amber-400/40 text-amber-200' : 'bg-indigo-500/10 border-indigo-400/40 text-indigo-200') + '">' +
      '<div class="flex items-center gap-2.5">' +
        '<div class="w-9 h-9 rounded-xl flex items-center justify-center font-black text-lg ' + (isMontaje ? 'bg-amber-400 text-slate-950' : 'bg-indigo-400 text-slate-950') + '">' +
          (isMontaje ? '<i class="fa-solid fa-wrench"></i>' : '<i class="fa-solid fa-boxes-packing"></i>') +
        '</div>' +
        '<div>' +
          '<h3 class="text-xs sm:text-sm font-black ' + (isMontaje ? 'text-amber-300' : 'text-indigo-300') + '">' + 
            (isMontaje ? 'Jornada Técnica de Montaje y Pruebas AV' : 'Jornada de Desmontaje, Inventario y Cierre') + 
          '</h3>' +
          '<p class="text-[11px] text-slate-400">' + 
            (isMontaje ? 'Día previo al programa. Realiza el conexionado y completa el checklist de cada sala.' : 'Día posterior al programa. Realiza desconexión, recogida y embalaje en flightcases.') + 
          '</p>' +
        '</div>' +
      '</div>' +
      (isMontaje ? '<button onclick="toggleMobileDrawer()" class="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs shadow cursor-pointer transition flex items-center gap-1.5"><i class="fa-solid fa-clipboard-check"></i> Abrir Checklist Salas</button>' : '') +
    '</div>';
  }

  var html = specialBanner +
  '<div class="mb-3 pb-2 border-b border-slate-200 flex justify-between items-center">' +
    '<div>' +
      '<h2 class="text-sm sm:text-base font-black text-slate-900 flex items-center gap-2 uppercase tracking-wide">' +
        '<span>' + escapeHtml(formatDayButtonTitle(currentDay, selectedDayIdx)) + '</span>' +
        (selectedRooms.length === 1 ? '<span class="text-[9px] font-black text-teal-900 bg-teal-100 border border-teal-300 px-2 py-0.5 rounded uppercase">Vista Exclusiva Técnico (' + escapeHtml(selectedRooms[0]) + ')</span>' : '') +
      '</h2>' +
      '<p class="text-[10px] text-slate-500 font-medium">' + sessions.length + ' sesiones en ' + selectedRooms.length + ' sala(s) activa(s)</p>' +
    '</div>' +
  '</div>' +
  '<div class="space-y-4">';

  timesList.forEach(function(timeSlot) {
    var slotSessions = groupedByTime[timeSlot];
    var finishedCount = slotSessions.filter(function(s) { return isSessionFinished(s.id); }).length;
    var allFinished = (slotSessions.length > 0 && finishedCount === slotSessions.length);

    html += '<div class="print-card bg-slate-50/80 border border-slate-200 rounded-xl p-2.5 sm:p-3">' +
      '<div class="flex items-center gap-2 mb-2 pb-2 border-b border-slate-200 flex-wrap">' +
        '<span class="franja-time-badge inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-mono font-black text-xs sm:text-sm shadow-sm tracking-wide">' +
          '<i class="fa-regular fa-clock text-amber-400"></i>' +
          '<span>' + timeSlot + ' hs</span>' +
        '</span>' +
        '<span class="text-[10px] text-slate-500 font-semibold">(' + slotSessions.length + ' ' + (slotSessions.length === 1 ? 'sesión' : 'sesiones simultáneas') + ')</span>' +
        '<div class="ml-auto flex items-center gap-1.5">' +
          '<span class="text-[9px] font-extrabold px-2 py-0.5 rounded-full ' + 
            (allFinished ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : (finishedCount > 0 ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-slate-200 text-slate-600')) + '">' +
            finishedCount + '/' + slotSessions.length + ' terminadas' +
          '</span>' +
          '<button onclick="toggleSlotFinished(\'' + escapeJsString(timeSlot) + '\', ' + (!allFinished) + ')" class="text-[9px] font-bold px-2 py-0.5 rounded-lg border transition cursor-pointer ' +
            (allFinished ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100' : 'bg-teal-700 text-white border-teal-700 hover:bg-teal-800 shadow-sm') + '">' +
            '<i class="fa-solid ' + (allFinished ? 'fa-rotate-left mr-1 text-slate-500' : 'fa-check mr-1 text-amber-300') + '"></i>' +
            (allFinished ? 'Reabrir franja' : 'Finalizar franja') +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">';

    slotSessions.forEach(function(s) {
      var badgeClass = getTypeBadgeClass(s.title, s.type);
      var badgeLabel = getTypeBadgeLabel(s.title, s.type);
      var isFinished = isSessionFinished(s.id);
      var noteObj = getSessionNote(s.id);
      var hasNote = !!(noteObj && noteObj.text && noteObj.text.trim());
      var isSpeakerVisible;
      if (visibleSpeakersMap[s.id] !== undefined) {
        isSpeakerVisible = visibleSpeakersMap[s.id];
      } else {
        isSpeakerVisible = globalShowSpeakers;
      }
      var subtalks = s.sub_talks || [];

      // Extraer y unificar todos los ponentes (tanto a nivel de sesión como de sub-ponencias)
      var speakerNames = [];
      if (s.speakers) {
        if (Array.isArray(s.speakers)) {
          s.speakers.forEach(function(sp) { if (sp && sp.trim()) speakerNames.push(sp.trim()); });
        } else if (typeof s.speakers === 'string' && s.speakers.trim()) {
          speakerNames.push(s.speakers.trim());
        }
      }
      subtalks.forEach(function(talk) {
        if (talk.speaker && talk.speaker.trim()) {
          speakerNames.push(talk.speaker.trim());
        }
      });
      speakerNames = Array.from(new Set(speakerNames));

      var modNames = [];
      if (s.moderators) {
        if (Array.isArray(s.moderators)) {
          s.moderators.forEach(function(m) { if (m && m.trim()) modNames.push(m.trim()); });
        } else if (typeof s.moderators === 'string' && s.moderators.trim()) {
          modNames.push(s.moderators.trim());
        }
      }
      modNames = Array.from(new Set(modNames));

      var hasPeopleOrTalks = (speakerNames.length > 0 || modNames.length > 0 || subtalks.length > 0);
      var sessionTime = (s.time_start && s.time_end) ? (s.time_start + ' - ' + s.time_end) : '';

      html += '<div id="session-card-' + s.id + '" class="session-card p-3 rounded-xl border transition flex flex-col justify-between ' + 
        (isFinished ? 'bg-emerald-950/20 border-emerald-500/50 shadow-sm' : 'bg-slate-900 border-slate-800 shadow-sm') + '">' +
        '<div>' +
          '<div class="flex items-center justify-between gap-1 mb-1.5 flex-wrap">' +
            '<div class="flex items-center gap-1 flex-wrap">' +
              // BADGE HORARIO INDIVIDUAL DE ALTO CONTRASTE
              (sessionTime ? 
                '<span class="card-time-badge inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono font-black text-[9.5px] shadow-xs">' +
                  '<i class="fa-regular fa-clock text-amber-400 text-[8.5px]"></i>' +
                  '<span>' + sessionTime + '</span>' +
                '</span>' : '') +
              '<span class="text-[9px] font-black px-1.5 py-0.5 rounded uppercase ' + badgeClass + '">' +
                escapeHtml(badgeLabel) +
              '</span>' +
              (isFinished ? '<span class="text-[8.5px] font-black px-1.5 py-0.5 rounded uppercase bg-emerald-600 text-white shadow-sm flex items-center gap-0.5"><i class="fa-solid fa-check"></i>Terminada</span>' : '') +
              '<span id="live-tag-' + s.id + '" class="text-[8.5px] font-black px-1.5 py-0.5 rounded uppercase hidden bg-rose-600 text-white animate-pulse">EN VIVO AHORA</span>' +
            '</div>' +
            '<button onclick="selectSingleRoom(\'' + escapeJsString(s.room || 'Sala') + '\')" title="Clic para filtrar solo esta sala" class="room-badge text-[10px] font-black truncate max-w-[140px] px-1.5 py-0.5 rounded cursor-pointer transition border border-teal-800 bg-teal-950/60 text-teal-300 hover:bg-teal-900/60">' +
              '<i class="fa-solid fa-location-dot text-teal-400 mr-0.5"></i>' + escapeHtml(s.room || 'Sala') +
            '</button>' +
          '</div>' +
          '<h3 class="font-extrabold text-slate-100 text-xs leading-snug mb-1 ' + (isCompactView ? 'line-clamp-2' : '') + '">' +
            escapeHtml(s.title) +
          '</h3>' +
          (!isCompactView && s.details ? '<p class="text-[10px] text-slate-400 mt-1 leading-normal">' + escapeHtml(s.details) + '</p>' : '') +
          
          // Nota técnica incrustada si existe (modo oscuro low-lumen)
          (hasNote ? 
            '<div onclick="openSessionNoteModal(\'' + s.id + '\')" class="mt-1.5 p-1.5 rounded-lg bg-amber-950/40 border border-amber-600/40 text-amber-200 text-[10px] cursor-pointer hover:bg-amber-900/40 transition shadow-sm" title="Clic para ver o editar la nota">' +
              '<div class="flex items-center justify-between text-[9px] font-bold text-amber-400 mb-0.5">' +
                '<span><i class="fa-solid fa-note-sticky text-amber-400 mr-1"></i>Nota Técnica:</span>' +
                '<span class="text-[8px] text-amber-300 font-normal">' + (noteObj.updatedAt || '') + '</span>' +
              '</div>' +
              '<p class="line-clamp-2 text-slate-200 font-medium">' + escapeHtml(noteObj.text) + '</p>' +
            '</div>' : '') +
        '</div>' +

        // Bloque de Ponencias en estilo OSCURO idéntico a la parte superior de la imagen
        (isSpeakerVisible && (subtalks.length > 0 || modNames.length > 0 || (speakerNames.length > 0 && subtalks.length === 0)) ?
          '<div class="mt-2 pt-2 border-t border-slate-700/60 space-y-1.5">' +
            (subtalks.length > 0 ?
              '<div class="text-[9px] font-black uppercase text-teal-400 flex items-center justify-between">' +
                '<span>' + subtalks.length + ' ' + (subtalks.length === 1 ? 'Ponencia' : 'Ponencias') + ':</span>' +
                (subtalks.length > 2 ? '<button onclick="openSessionDetailModal(\'' + s.id + '\')" class="text-amber-400 hover:underline font-bold text-[9px] cursor-pointer">Ver todas (' + subtalks.length + ') &rsaquo;</button>' : '') +
              '</div>' +
              subtalks.slice(0, 2).map(function(talk) {
                return '<div onclick="openSessionDetailModal(\'' + s.id + '\')" class="subtalk-box text-[10.5px] p-2 rounded-lg border border-slate-700/60 bg-slate-800/80 text-slate-200 cursor-pointer hover:border-teal-500/50 transition">' +
                  '<div class="font-bold text-slate-100">' + escapeHtml(talk.title || 'Presentación de Ponencia') + '</div>' +
                  (talk.speaker ? '<div class="text-[9.5px] text-slate-400 mt-1 flex items-start gap-1.5"><i class="fa-solid fa-user-tie text-teal-400 mt-0.5 shrink-0"></i><span>' + escapeHtml(talk.speaker) + '</span></div>' : '') +
                '</div>';
              }).join('') +
              (subtalks.length > 2 ? 
                '<button onclick="openSessionDetailModal(\'' + s.id + '\')" class="w-full text-center py-1 px-2 rounded-lg bg-slate-800/70 hover:bg-slate-700 text-teal-300 text-[10px] font-bold border border-slate-700 transition cursor-pointer flex items-center justify-center gap-1.5">' +
                  '<i class="fa-solid fa-window-maximize text-[9px] text-teal-400"></i>' +
                  '<span>Ver ' + subtalks.length + ' ponencias en ventana de detalle</span>' +
                '</button>' : '') : '') +

            ((modNames.length > 0 || (speakerNames.length > 0 && subtalks.length === 0)) ?
              '<div class="subtalk-box text-[10.5px] p-2 rounded-lg border border-slate-700/60 bg-slate-800/80 text-slate-200 space-y-1">' +
                (modNames.length ? '<div><strong class="text-teal-400">Moderador(es):</strong> <span class="text-slate-200">' + escapeHtml(modNames.join(', ')) + '</span></div>' : '') +
                (speakerNames.length && subtalks.length === 0 ? '<div><strong class="text-teal-400">Ponente(s):</strong> <span class="text-slate-200">' + escapeHtml(speakerNames.join('; ')) + '</span></div>' : '') +
              '</div>' : '') +
          '</div>' : '') +

        // Barra inferior de la tarjeta (Ponentes + Nota + Terminar)
        '<div class="mt-2.5 pt-2 border-t border-slate-700/60 flex items-center justify-between text-[10px] text-slate-400 flex-wrap gap-1">' +
          '<div>' +
            (hasPeopleOrTalks ? 
              '<button onclick="toggleSessionSpeakers(\'' + s.id + '\')" class="text-teal-400 hover:text-teal-300 font-extrabold cursor-pointer p-0.5 flex items-center gap-1 text-[10px] underline">' +
                '<i class="fa-solid ' + (isSpeakerVisible ? 'fa-chevron-up' : 'fa-chevron-down') + ' text-[9px]"></i>' +
                '<span>' + (isSpeakerVisible ? 'Ocultar' : ('Ver Ponentes' + (subtalks.length ? ' (' + subtalks.length + ')' : (speakerNames.length ? ' (' + speakerNames.length + ')' : '')))) + '</span>' +
              '</button>' : 
              '<span class="text-[10px] font-semibold text-slate-400 truncate max-w-[170px] sm:max-w-[220px] inline-flex items-center gap-1" title="' + escapeHtml(s.title) + '">' +
                '<i class="fa-solid fa-calendar-check text-teal-400/80 text-[9px]"></i>' +
                '<span class="truncate">' + escapeHtml(s.title || 'Sesión General') + '</span>' +
              '</span>') +
          '</div>' +
          '<div class="flex items-center gap-1">' +
            '<button onclick="openSessionDetailModal(\'' + s.id + '\')" title="Ver ficha completa en ventana" class="tech-action-btn cursor-pointer px-2 py-0.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1 bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">' +
              '<i class="fa-solid fa-up-right-from-square text-[9px] text-teal-400"></i>' +
              '<span>Detalle</span>' +
            '</button>' +
            '<button onclick="openSessionNoteModal(\'' + s.id + '\')" title="Ver / Añadir nota técnica" class="tech-action-btn cursor-pointer px-2 py-0.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1 bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">' + 
              '<i class="fa-solid fa-note-sticky ' + (hasNote ? 'text-amber-400' : 'text-slate-400') + '"></i>' +
              '<span>Nota</span>' +
            '</button>' +
            '<button onclick="toggleSessionFinished(\'' + s.id + '\')" title="Marcar / desmarcar como terminada" class="tech-action-btn cursor-pointer px-2 py-0.5 rounded-lg text-[10px] font-black transition flex items-center gap-1 ' + 
              (isFinished ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm' : 'bg-slate-800 text-slate-300 hover:bg-emerald-900/40 hover:text-emerald-300 border border-slate-700') + '">' +
              '<i class="fa-solid ' + (isFinished ? 'fa-check' : 'fa-check text-slate-400') + '"></i>' +
              '<span>' + (isFinished ? 'Terminada' : 'Terminar') + '</span>' +
            '</button>' +
          '</div>' +
        '</div>' +

      '</div>';
    });

    html += '</div></div>';
  });

  html += '</div>';
  output.innerHTML = html;
}

// VISTA PARRILLA (LISTA / TABLA RESUMEN RESPONSIVE SIN SCROLL HORIZONTAL)
function renderGridView(output, sessions, currentDay) {
  var isSingleRoom = (selectedRooms.length === 1);

  var specialBanner = '';
  if (currentDay && currentDay.is_special) {
    var isMontaje = (currentDay.special_type === 'montaje');
    specialBanner = '<div class="mb-3 p-3 rounded-2xl border flex items-center justify-between gap-3 flex-wrap ' +
      (isMontaje ? 'bg-amber-500/10 border-amber-400/40 text-amber-200' : 'bg-indigo-500/10 border-indigo-400/40 text-indigo-200') + '">' +
      '<div class="flex items-center gap-2.5">' +
        '<div class="w-9 h-9 rounded-xl flex items-center justify-center font-black text-lg ' + (isMontaje ? 'bg-amber-400 text-slate-950' : 'bg-indigo-400 text-slate-950') + '">' +
          (isMontaje ? '<i class="fa-solid fa-wrench"></i>' : '<i class="fa-solid fa-boxes-packing"></i>') +
        '</div>' +
        '<div>' +
          '<h3 class="text-xs sm:text-sm font-black ' + (isMontaje ? 'text-amber-300' : 'text-indigo-300') + '">' + 
            (isMontaje ? 'Jornada Técnica de Montaje y Pruebas AV' : 'Jornada de Desmontaje, Inventario y Cierre') + 
          '</h3>' +
          '<p class="text-[11px] text-slate-400">' + 
            (isMontaje ? 'Día previo al programa. Realiza el conexionado y completa el checklist de cada sala.' : 'Día posterior al programa. Realiza desconexión, recogida y embalaje en flightcases.') + 
          '</p>' +
        '</div>' +
      '</div>' +
      (isMontaje ? '<button onclick="toggleMobileDrawer()" class="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs shadow cursor-pointer transition flex items-center gap-1.5"><i class="fa-solid fa-clipboard-check"></i> Abrir Checklist Salas</button>' : '') +
    '</div>';
  }

  var html = '<div class="w-full">' +
    specialBanner +
    '<div class="mb-3 pb-2 border-b border-slate-700/60 flex justify-between items-center">' +
      '<div>' +
        '<h2 class="text-sm sm:text-base font-black text-slate-100 flex items-center gap-2 uppercase tracking-wide">' +
          '<span>' + escapeHtml(formatDayButtonTitle(currentDay, selectedDayIdx)) + '</span>' +
          (isSingleRoom ? '<span class="text-[9px] font-black text-teal-300 bg-teal-950/80 border border-teal-800 px-2 py-0.5 rounded uppercase">Sala: ' + escapeHtml(selectedRooms[0]) + '</span>' : '') +
        '</h2>' +
        '<p class="text-[10px] text-slate-400 font-medium">' + sessions.length + ' sesiones &bull; Toca cualquier sesión para ver ventana completa</p>' +
      '</div>' +
    '</div>' +

    '<div class="space-y-1.5 w-full select-none">';

  sessions.forEach(function(s) {
    var isFinished = isSessionFinished(s.id);
    var hasNote = !!(sessionNotesMap[s.id] && sessionNotesMap[s.id].text);
    var subtalks = s.sub_talks || [];

    var speakerNames = [];
    if (s.speakers) {
      if (Array.isArray(s.speakers)) {
        s.speakers.forEach(function(sp) { if (sp && sp.trim()) speakerNames.push(sp.trim()); });
      } else if (typeof s.speakers === 'string' && s.speakers.trim()) {
        speakerNames.push(s.speakers.trim());
      }
    }
    subtalks.forEach(function(talk) {
      if (talk.speaker && talk.speaker.trim()) speakerNames.push(talk.speaker.trim());
    });
    speakerNames = Array.from(new Set(speakerNames));

    html += '<div onclick="openSessionDetailModal(\'' + s.id + '\')" class="grid-row-item p-2.5 rounded-xl border transition flex items-center justify-between gap-2 cursor-pointer ' +
      (isFinished 
        ? 'bg-emerald-950/20 border-emerald-500/40 hover:bg-emerald-950/30' 
        : 'bg-slate-900 border-slate-800 hover:bg-slate-800/60 active:bg-slate-800') + '">' +

      // Columna 1: Horario
      '<div class="shrink-0">' +
        '<span class="card-time-badge inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono font-black text-[10px]">' +
          '<i class="fa-regular fa-clock text-amber-400 text-[9px]"></i>' +
          '<span>' + s.time_start + ' - ' + s.time_end + '</span>' +
        '</span>' +
      '</div>' +

      // Columna 2: Título + Sala (cuando hay más de 1 sala) + Ponencias / Ponentes
      '<div class="flex-1 min-w-0 px-1">' +
        '<div class="font-bold text-slate-100 text-xs truncate leading-snug">' + escapeHtml(s.title) + '</div>' +
        '<div class="flex items-center gap-1.5 text-[9.5px] text-slate-400 mt-1 truncate">' +
          (!isSingleRoom ? 
            '<span onclick="event.stopPropagation(); selectSingleRoom(\'' + escapeJsString(s.room || 'Sala') + '\')" title="Toca para filtrar solo esta sala" class="room-badge inline-flex items-center gap-1 text-[8.5px] font-black px-1.5 py-0.5 rounded border border-teal-700 bg-teal-950 text-teal-300 shrink-0 uppercase tracking-wide max-w-[120px] sm:max-w-[160px] cursor-pointer hover:bg-teal-900 transition shadow-xs">' +
              '<i class="fa-solid fa-location-dot text-amber-400 text-[8px]"></i>' +
              '<span class="truncate">' + escapeHtml(s.room || 'Sala') + '</span>' +
            '</span>' : '') +
          (subtalks.length > 0 ? 
            '<span class="text-teal-400 font-bold truncate"><i class="fa-solid fa-layer-group mr-1"></i>' + subtalks.length + ' ponencias &bull; Ver info &rsaquo;</span>' : 
            (speakerNames.length > 0 && globalShowSpeakers ? 
              '<span class="truncate"><i class="fa-solid fa-user-tie text-teal-400 mr-1"></i>' + escapeHtml(speakerNames[0]) + (speakerNames.length > 1 ? ' +' + (speakerNames.length - 1) : '') + '</span>' : 
              '<span class="text-slate-500 font-medium truncate">Actividad general</span>')) +
        '</div>' +
      '</div>' +

      // Columna 4: Estado y Botones Rápidos
      '<div class="shrink-0 flex items-center gap-1" onclick="event.stopPropagation()">' +
        '<button onclick="openSessionNoteModal(\'' + s.id + '\')" class="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 cursor-pointer" title="Notas">' +
          '<i class="fa-solid fa-note-sticky text-xs ' + (hasNote ? 'text-amber-400' : '') + '"></i>' +
        '</button>' +
        '<button onclick="toggleSessionFinished(\'' + s.id + '\')" class="p-1.5 rounded-lg text-xs font-bold transition cursor-pointer ' + 
          (isFinished ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-emerald-400 hover:bg-slate-800') + '" title="Terminar">' +
          '<i class="fa-solid fa-check"></i>' +
        '</button>' +
      '</div>' +

    '</div>';
  });

  html += '</div></div>';
  output.innerHTML = html;
}

// MODAL DETALLE COMPLETO DE SESIÓN (VENTANA POPUP PARA EVITAR DESPLAZAMIENTOS INFINITOS)
function openSessionDetailModal(sessionId) {
  if (!eventData || !eventData.schedule) return;
  var sessionObj = null;
  (eventData.schedule.days || []).forEach(function(d) {
    (d.sessions || []).forEach(function(s) {
      if (s.id === sessionId) sessionObj = s;
    });
  });
  if (!sessionObj) return;

  var modal = document.getElementById('session-detail-modal');
  if (!modal) return;

  var timeEl = document.getElementById('detail-modal-time');
  var typeEl = document.getElementById('detail-modal-type');
  var roomEl = document.getElementById('detail-modal-room');
  var titleEl = document.getElementById('detail-modal-title');
  var detailsEl = document.getElementById('detail-modal-details');
  var modsBox = document.getElementById('detail-modal-moderators-box');
  var modsText = document.getElementById('detail-modal-moderators-text');
  var spkBox = document.getElementById('detail-modal-speakers-box');
  var spkText = document.getElementById('detail-modal-speakers-text');
  var talksContainer = document.getElementById('detail-modal-talks-container');
  var talksHeader = document.getElementById('detail-modal-talks-header');
  var talksList = document.getElementById('detail-modal-talks-list');
  var noteBox = document.getElementById('detail-modal-note-box');
  var noteText = document.getElementById('detail-modal-note-text');
  var noteBtn = document.getElementById('detail-modal-note-btn');
  var finishBtn = document.getElementById('detail-modal-finish-btn');

  // Horario, Tipo, Sala
  if (timeEl) timeEl.textContent = (sessionObj.time_start || '') + ' - ' + (sessionObj.time_end || '') + ' hs';
  if (typeEl) {
    typeEl.className = 'text-[9px] font-black px-1.5 py-0.5 rounded uppercase ' + getTypeBadgeClass(sessionObj.title, sessionObj.type);
    typeEl.textContent = getTypeBadgeLabel(sessionObj.title, sessionObj.type);
  }
  if (roomEl) roomEl.textContent = sessionObj.room || 'Sala General';
  if (titleEl) titleEl.textContent = sessionObj.title || 'Sesión';

  if (detailsEl) {
    if (sessionObj.details) {
      detailsEl.textContent = sessionObj.details;
      detailsEl.classList.remove('hidden');
    } else {
      detailsEl.classList.add('hidden');
    }
  }

  // Moderadores
  var mods = [];
  if (sessionObj.moderators) {
    if (Array.isArray(sessionObj.moderators)) mods = sessionObj.moderators.filter(Boolean);
    else if (typeof sessionObj.moderators === 'string' && sessionObj.moderators.trim()) mods = [sessionObj.moderators.trim()];
  }
  if (modsBox && modsText) {
    if (mods.length > 0) {
      modsText.textContent = mods.join(', ');
      modsBox.classList.remove('hidden');
    } else {
      modsBox.classList.add('hidden');
    }
  }

  // Sub-ponencias
  var subtalks = sessionObj.sub_talks || [];
  if (talksContainer && talksList) {
    if (subtalks.length > 0) {
      talksContainer.classList.remove('hidden');
      if (talksHeader) talksHeader.textContent = subtalks.length + ' Ponencias Registradas:';
      var htmlTalks = '';
      subtalks.forEach(function(talk, i) {
        htmlTalks += '<div class="p-2.5 rounded-xl bg-slate-800/90 border border-slate-700/80 space-y-1">' +
          '<div class="flex items-start justify-between gap-2">' +
            '<h4 class="font-bold text-slate-100 text-xs leading-snug flex-1">' + (i + 1) + '. ' + escapeHtml(talk.title || 'Ponencia') + '</h4>' +
            (talk.time_start ? '<span class="card-time-badge font-mono text-[9px] px-1.5 py-0.5 rounded shrink-0">' + talk.time_start + (talk.time_end ? ' - ' + talk.time_end : '') + '</span>' : '') +
          '</div>' +
          (talk.speaker ? '<div class="text-[10px] text-teal-300 flex items-start gap-1.5"><i class="fa-solid fa-user-tie text-teal-400 mt-0.5 shrink-0"></i><span>' + escapeHtml(talk.speaker) + '</span></div>' : '') +
          (talk.affiliation ? '<div class="text-[9.5px] text-slate-400 italic">' + escapeHtml(talk.affiliation) + '</div>' : '') +
          (talk.abstract ? '<div class="text-[10px] text-slate-300 mt-1 leading-normal bg-slate-900/60 p-2 rounded-lg border border-slate-800">' + escapeHtml(talk.abstract) + '</div>' : '') +
        '</div>';
      });
      talksList.innerHTML = htmlTalks;
    } else {
      talksContainer.classList.add('hidden');
    }
  }

  // Ponentes raíz (si no hay sub-ponencias)
  if (spkBox && spkText) {
    if (subtalks.length === 0 && sessionObj.speakers) {
      spkText.textContent = Array.isArray(sessionObj.speakers) ? sessionObj.speakers.join(', ') : sessionObj.speakers;
      spkBox.classList.remove('hidden');
    } else {
      spkBox.classList.add('hidden');
    }
  }

  // Nota técnica
  var noteObj = getSessionNote(sessionId);
  if (noteBox && noteText) {
    if (noteObj && noteObj.text && noteObj.text.trim()) {
      noteText.textContent = noteObj.text;
      noteBox.classList.remove('hidden');
    } else {
      noteBox.classList.add('hidden');
    }
  }

  if (noteBtn) {
    noteBtn.onclick = function() {
      closeSessionDetailModal();
      openSessionNoteModal(sessionId);
    };
  }

  // Botón Terminar
  if (finishBtn) {
    var isFin = isSessionFinished(sessionId);
    finishBtn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ' + 
      (isFin ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-800 text-slate-300 hover:bg-emerald-900/40 hover:text-emerald-300 border border-slate-700');
    finishBtn.innerHTML = '<i class="fa-solid ' + (isFin ? 'fa-rotate-left' : 'fa-check') + '"></i><span>' + (isFin ? 'Reabrir Sesión' : 'Marcar Terminada') + '</span>';
    finishBtn.onclick = function() {
      toggleSessionFinished(sessionId);
      openSessionDetailModal(sessionId);
    };
  }

  modal.classList.remove('hidden');
}

function closeSessionDetailModal() {
  var modal = document.getElementById('session-detail-modal');
  if (modal) modal.classList.add('hidden');
}

// EVALUACIÓN DE SESIÓN EN VIVO / PRÓXIMA
function evaluateLiveSessions() {
  if (!eventData || !eventData.schedule) return;
  var now = new Date();
  var curMin = now.getHours() * 60 + now.getMinutes();

  var days = eventData.schedule.days || [];
  var currentDay = days[selectedDayIdx];
  if (!currentDay) return;

  (currentDay.sessions || []).forEach(function(s) {
    var card = document.getElementById('session-card-' + s.id);
    var tag = document.getElementById('live-tag-' + s.id);
    if (!card) return;

    var start = timeToMinutes(s.time_start);
    var end = timeToMinutes(s.time_end);

    card.classList.remove('session-is-live', 'session-is-next');
    if (tag) tag.classList.add('hidden');

    if (curMin >= start && curMin < end) {
      card.classList.add('session-is-live');
      if (tag) {
        tag.textContent = 'EN VIVO AHORA';
        tag.classList.remove('hidden');
      }
    } else if (curMin < start && (start - curMin) <= 15) {
      card.classList.add('session-is-next');
      if (tag) {
        tag.textContent = 'PRÓXIMA (-' + (start - curMin) + 'm)';
        tag.className = 'text-[8.5px] font-black px-1.5 py-0.5 rounded uppercase bg-amber-500 text-slate-950 shadow-sm';
        tag.classList.remove('hidden');
      }
    }
  });
}

function timeToMinutes(t) {
  if (!t) return 0;
  var parts = t.split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

// CONTROL DE ESTADO DE SESIÓN (TERMINADA / PENDIENTE)
function isSessionFinished(id) {
  return !!finishedSessionsMap[id];
}

function toggleSessionFinished(id, e) {
  if (e) e.stopPropagation();
  if (finishedSessionsMap[id]) {
    delete finishedSessionsMap[id];
    showToast('Sesión desmarcada como terminada', 'fa-rotate-left text-amber-400');
  } else {
    var now = new Date();
    var tStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    finishedSessionsMap[id] = { finished: true, timestamp: tStr };
    showToast('Sesión marcada como terminada (' + tStr + ' hs)', 'fa-circle-check text-emerald-400');
  }
  safeSet('event_finished_sessions_v1', finishedSessionsMap);
  renderSchedule();
}

function toggleSlotFinished(timeSlot, targetState) {
  var count = 0;
  var now = new Date();
  var tStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  var days = (eventData.schedule && eventData.schedule.days) || [];
  var currentDay = days[selectedDayIdx];
  if (!currentDay) return;

  (currentDay.sessions || []).forEach(function(s) {
    var slot = (s.time_start || '00:00') + ' - ' + (s.time_end || '00:00');
    if (slot === timeSlot && (selectedRooms.length === 0 || selectedRooms.includes((s.room || '').trim()))) {
      if (targetState) {
        finishedSessionsMap[s.id] = { finished: true, timestamp: tStr };
      } else {
        delete finishedSessionsMap[s.id];
      }
      count++;
    }
  });

  safeSet('event_finished_sessions_v1', finishedSessionsMap);
  showToast(targetState ? (count + ' sesiones marcadas como terminadas') : ('Franja ' + timeSlot + ' hs reabierta'), targetState ? 'fa-circle-check text-emerald-400' : 'fa-rotate-left text-amber-400');
  renderSchedule();
}

// MODAL DE NOTAS E INCIDENCIAS POR SESIÓN
function getSessionNote(id) {
  return sessionNotesMap[id] || null;
}

function getSessionById(id) {
  var days = (eventData && eventData.schedule && eventData.schedule.days) || [];
  for (var d = 0; d < days.length; d++) {
    var sessions = days[d].sessions || [];
    for (var s = 0; s < sessions.length; s++) {
      if (sessions[s].id === id) return sessions[s];
    }
  }
  return null;
}

function openSessionNoteModal(id, e) {
  if (e) e.stopPropagation();
  var session = getSessionById(id);
  if (!session) return;
  currentEditingSessionId = id;

  var elRoom = document.getElementById('modal-session-room');
  var elTime = document.getElementById('modal-session-time');
  var elTitle = document.getElementById('modal-session-title');
  var elSpeakers = document.getElementById('modal-session-speakers');
  var elBadges = document.getElementById('modal-session-badges');
  var elTextarea = document.getElementById('modal-note-textarea');
  var elTimeInfo = document.getElementById('modal-note-time-info');
  var btnDelete = document.getElementById('modal-delete-note-btn');

  if (elRoom) elRoom.textContent = session.room || 'Sala';
  if (elTime) elTime.textContent = (session.time_start || '') + ' - ' + (session.time_end || '') + ' hs';
  if (elTitle) elTitle.textContent = session.title || '';
  if (elSpeakers) {
    var spkText = session.speakers ? ('Ponentes: ' + session.speakers) : '';
    if (session.moderators && session.moderators.length) {
      spkText = (spkText ? spkText + ' | ' : '') + 'Moderadores: ' + session.moderators.join(', ');
    }
    elSpeakers.textContent = spkText;
  }

  if (elBadges) {
    var badgeClass = getTypeBadgeClass(session.title, session.type);
    var badgeLabel = getTypeBadgeLabel(session.title, session.type);
    elBadges.innerHTML = '<span class="text-[9px] font-black px-1.5 py-0.5 rounded uppercase ' + badgeClass + '">' + escapeHtml(badgeLabel) + '</span>' +
      '<span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase bg-teal-100 text-teal-900 border border-teal-200">' + escapeHtml(session.room || 'Sala') + '</span>';
  }

  var noteObj = getSessionNote(id);
  if (elTextarea) elTextarea.value = noteObj ? noteObj.text : '';
  if (elTimeInfo) elTimeInfo.textContent = noteObj && noteObj.updatedAt ? ('Última modificación: ' + noteObj.updatedAt) : '';

  if (btnDelete) {
    if (noteObj && noteObj.text) btnDelete.classList.remove('hidden');
    else btnDelete.classList.add('hidden');
  }

  updateModalStatusButton(isSessionFinished(id));

  var modal = document.getElementById('session-note-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeSessionNoteModal() {
  var modal = document.getElementById('session-note-modal');
  if (modal) modal.classList.add('hidden');
  currentEditingSessionId = null;
}

function updateModalStatusButton(isFinished) {
  var btn = document.getElementById('modal-toggle-status-btn');
  var txt = document.getElementById('modal-session-status-text');
  if (!btn || !txt) return;

  if (isFinished) {
    txt.innerHTML = '<span class="text-emerald-700 font-black flex items-center gap-1"><i class="fa-solid fa-circle-check"></i> Terminada</span>';
    btn.className = 'px-3 py-1.5 rounded-xl font-bold text-xs transition shadow-sm flex items-center gap-1.5 cursor-pointer bg-emerald-600 text-white hover:bg-emerald-700';
    btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> <span>✓ Sesión Terminada (Reabrir)</span>';
  } else {
    txt.innerHTML = '<span class="text-amber-700 font-bold flex items-center gap-1"><i class="fa-solid fa-clock"></i> Pendiente / En curso</span>';
    btn.className = 'px-3 py-1.5 rounded-xl font-bold text-xs transition shadow-sm flex items-center gap-1.5 cursor-pointer bg-slate-200 text-slate-800 hover:bg-slate-300';
    btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Marcar como Terminada</span>';
  }
}

function toggleModalSessionStatus() {
  if (!currentEditingSessionId) return;
  var isFinished = isSessionFinished(currentEditingSessionId);
  if (isFinished) {
    delete finishedSessionsMap[currentEditingSessionId];
    updateModalStatusButton(false);
    showToast('Sesión marcada como pendiente', 'fa-rotate-left text-amber-400');
  } else {
    var now = new Date();
    var tStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    finishedSessionsMap[currentEditingSessionId] = { finished: true, timestamp: tStr };
    updateModalStatusButton(true);
    showToast('Sesión marcada como terminada', 'fa-circle-check text-emerald-400');
  }
  safeSet('event_finished_sessions_v1', finishedSessionsMap);
  renderSchedule();
}

function saveSessionNote() {
  if (!currentEditingSessionId) return;
  var elTextarea = document.getElementById('modal-note-textarea');
  var text = elTextarea ? elTextarea.value.trim() : '';
  var now = new Date();
  var dateStr = String(now.getDate()).padStart(2, '0') + '/' + String(now.getMonth()+1).padStart(2, '0') + ' ' +
                String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  if (text) {
    sessionNotesMap[currentEditingSessionId] = {
      text: text,
      updatedAt: dateStr
    };
    showToast('Nota técnica guardada correctamente', 'fa-floppy-disk text-teal-400');
  } else {
    delete sessionNotesMap[currentEditingSessionId];
    showToast('Nota vacía eliminada', 'fa-trash text-slate-400');
  }
  safeSet('event_session_notes_v1', sessionNotesMap);
  updateGlobalNotesBadge();
  closeSessionNoteModal();
  renderSchedule();
}

function deleteSessionNote() {
  if (!currentEditingSessionId) return;
  if (confirm('¿Deseas eliminar la nota técnica de esta sesión?')) {
    delete sessionNotesMap[currentEditingSessionId];
    safeSet('event_session_notes_v1', sessionNotesMap);
    updateGlobalNotesBadge();
    showToast('Nota técnica eliminada', 'fa-trash text-rose-400');
    closeSessionNoteModal();
    renderSchedule();
  }
}

// PANEL GENERAL DE NOTAS TÉCNICAS
function updateGlobalNotesBadge() {
  var count = Object.keys(sessionNotesMap).length;
  var badge = document.getElementById('global-notes-count-badge');
  var mobBadge = document.getElementById('mobile-nav-notes-badge');
  if (badge) {
    badge.textContent = count;
    badge.className = count > 0 
      ? 'bg-amber-400 text-slate-900 text-[10px] px-1.5 py-0.2 rounded-full font-black animate-pulse' 
      : 'bg-teal-800 text-teal-200 text-[10px] px-1.5 py-0.2 rounded-full font-black';
  }
  if (mobBadge) {
    mobBadge.textContent = count;
    if (count > 0) mobBadge.classList.remove('hidden');
    else mobBadge.classList.add('hidden');
  }
}

function openGlobalNotesModal() {
  var modal = document.getElementById('global-notes-modal');
  var listEl = document.getElementById('global-notes-list');
  var summaryEl = document.getElementById('global-notes-summary-text');
  if (!modal || !listEl) return;

  var keys = Object.keys(sessionNotesMap);
  if (summaryEl) summaryEl.textContent = keys.length + (keys.length === 1 ? ' nota técnica registrada' : ' notas técnicas registradas');

  if (keys.length === 0) {
    listEl.innerHTML = '<div class="text-center py-8 text-slate-400">' +
      '<i class="fa-regular fa-note-sticky text-3xl mb-2 text-slate-300 block"></i>' +
      '<p class="text-xs font-bold text-slate-600">No hay notas registradas todavía</p>' +
      '<p class="text-[10px] text-slate-400 mt-1">Haz clic en el botón "Nota" de cualquier sesión para registrar observaciones o incidencias.</p>' +
    '</div>';
  } else {
    var html = '';
    keys.forEach(function(sId) {
      var note = sessionNotesMap[sId];
      var sObj = getSessionById(sId);
      if (!sObj) return;
      var isFin = isSessionFinished(sId);

      html += '<div class="p-3 rounded-xl border border-slate-200 bg-white hover:border-teal-300 transition shadow-sm space-y-1.5">' +
        '<div class="flex items-center justify-between gap-1 flex-wrap">' +
          '<div class="flex items-center gap-1.5">' +
            '<span class="text-[9px] font-black px-1.5 py-0.5 rounded uppercase bg-teal-50 text-teal-900 border border-teal-200">' + escapeHtml(sObj.room || 'Sala') + '</span>' +
            '<span class="text-[9px] text-slate-500 font-bold"><i class="fa-regular fa-clock mr-0.5"></i>' + sObj.time_start + ' - ' + sObj.time_end + ' hs</span>' +
          '</div>' +
          '<div class="flex items-center gap-1">' +
            (isFin ? '<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-300"><i class="fa-solid fa-circle-check mr-0.5"></i>Terminada</span>' : '<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200">Pendiente</span>') +
            '<button onclick="closeGlobalNotesModal(); openSessionNoteModal(\'' + sId + '\')" class="text-teal-700 hover:text-teal-900 font-bold text-[10px] px-1.5 py-0.5 rounded hover:bg-slate-100 cursor-pointer">' +
              '<i class="fa-solid fa-pen-to-square"></i> Editar' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<h5 class="text-xs font-bold text-slate-900 leading-tight">' + escapeHtml(sObj.title) + '</h5>' +
        '<div class="bg-amber-50/70 border border-amber-200 p-2 rounded-lg text-slate-800 text-[11px] whitespace-pre-wrap font-sans">' +
          escapeHtml(note.text) +
        '</div>' +
        '<div class="text-[9px] text-slate-400 text-right">' + (note.updatedAt ? ('Registrada: ' + note.updatedAt) : '') + '</div>' +
      '</div>';
    });
    listEl.innerHTML = html;
  }

  modal.classList.remove('hidden');
}

function closeGlobalNotesModal() {
  var modal = document.getElementById('global-notes-modal');
  if (modal) modal.classList.add('hidden');
}

function exportNotesAsText() {
  var keys = Object.keys(sessionNotesMap);
  if (keys.length === 0) {
    alert('No hay notas para exportar.');
    return;
  }
  var report = '=== INFORME TÉCNICO DE INCIDENCIAS Y NOTAS ===\n\n';
  keys.forEach(function(sId) {
    var note = sessionNotesMap[sId];
    var sObj = getSessionById(sId);
    if (!sObj) return;
    report += 'Sala: ' + (sObj.room || '-') + ' | Horario: ' + sObj.time_start + ' - ' + sObj.time_end + ' hs\n';
    report += 'Sesión: ' + sObj.title + '\n';
    report += 'Estado: ' + (isSessionFinished(sId) ? 'TERMINADA' : 'PENDIENTE') + '\n';
    report += 'Fecha nota: ' + (note.updatedAt || '-') + '\n';
    report += 'Nota:\n' + note.text + '\n';
    report += '------------------------------------------------------------\n\n';
  });

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(report).then(function() {
      showToast('Informe técnico copiado al portapapeles', 'fa-copy text-teal-400');
    });
  } else {
    alert(report);
  }
}

function clearAllNotes() {
  if (confirm('¿Estás seguro de que deseas borrar TODAS las notas técnicas registradas? Esta acción no se puede deshacer.')) {
    sessionNotesMap = {};
    safeSet('event_session_notes_v1', sessionNotesMap);
    updateGlobalNotesBadge();
    openGlobalNotesModal();
    renderSchedule();
    showToast('Todas las notas han sido eliminadas', 'fa-trash text-rose-400');
  }
}

// TOAST NOTIFICATIONS
var _toastTimer = null;
function showToast(msg, iconClass) {
  var toast = document.getElementById('tech-toast');
  var txt = document.getElementById('tech-toast-text');
  var icon = document.getElementById('tech-toast-icon');
  if (!toast || !txt) return;

  txt.textContent = msg;
  if (icon && iconClass) icon.className = 'fa-solid ' + iconClass;

  toast.classList.remove('opacity-0', 'pointer-events-none');
  toast.classList.add('opacity-100');

  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() {
    toast.classList.remove('opacity-100');
    toast.classList.add('opacity-0', 'pointer-events-none');
  }, 2600);
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}

function escapeJsString(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
}
