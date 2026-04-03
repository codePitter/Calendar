/**
 * migrate-events.js — Script de migración para eventos recurrentes
 * 
 * Este script convierte eventos del formato antiguo (individuales con campos de recurrencia)
 * al formato nuevo (eventos recurrentes en array separado)
 * 
 * USO:
 * 1. Abre la consola del navegador en tu calendario
 * 2. Copia y pega este script completo
 * 3. Presiona Enter
 * 4. Recarga la página
 */

(function migrateEvents() {
  console.log('🔄 Iniciando migración de eventos recurrentes...');

  // Cargar datos actuales
  const eventsData = localStorage.getItem('agenda2026_events');
  const recurringData = localStorage.getItem('agenda2026_recurring');
  
  if (!eventsData) {
    console.warn('⚠️ No se encontraron eventos para migrar');
    return;
  }

  const events = JSON.parse(eventsData);
  const existingRecurring = recurringData ? JSON.parse(recurringData) : [];
  
  const newEvents = {};  // Eventos sin recurrencia
  const newRecurring = [...existingRecurring];  // Eventos recurrentes
  const processedIds = new Set(existingRecurring.map(e => e.id));
  
  let migratedCount = 0;
  let regularCount = 0;

  // Procesar cada fecha
  for (const [dateKey, dateEvents] of Object.entries(events)) {
    newEvents[dateKey] = [];
    
    for (const event of dateEvents) {
      // Si ya fue procesado como recurrente, saltar
      if (processedIds.has(event.id)) {
        console.log(`  ℹ️ Evento ${event.id} ya existe en recurrentes, omitiendo`);
        continue;
      }

      // Si tiene recurrencia y no está en el array de recurrentes
      if (event.recurrence && event.recurrence !== 'none') {
        // Convertir a evento recurrente
        const recurringEvent = {
          id: event.id,
          title: event.title,
          startTime: event.startTime,
          endTime: event.endTime,
          desc: event.desc || '',
          color: event.color,
          important: event.important || false,
          recurrence: event.recurrence,
          originalDate: event.originalDate || dateKey,
          endRecurrence: event.endRecurrence || null
        };
        
        newRecurring.push(recurringEvent);
        processedIds.add(event.id);
        migratedCount++;
        
        console.log(`  ✅ Migrado: ${event.title} (${event.recurrence})`);
      } else {
        // Mantener como evento regular
        newEvents[dateKey].push(event);
        regularCount++;
      }
    }
    
    // Si no quedan eventos en esta fecha, eliminar la entrada
    if (newEvents[dateKey].length === 0) {
      delete newEvents[dateKey];
    }
  }

  // Guardar datos migrados
  localStorage.setItem('agenda2026_events', JSON.stringify(newEvents));
  localStorage.setItem('agenda2026_recurring', JSON.stringify(newRecurring));

  console.log('\n✨ Migración completada:');
  console.log(`   • ${migratedCount} eventos convertidos a recurrentes`);
  console.log(`   • ${regularCount} eventos regulares mantenidos`);
  console.log(`   • Total de eventos recurrentes: ${newRecurring.length}`);
  console.log('\n🔄 Recarga la página para ver los cambios');
})();
