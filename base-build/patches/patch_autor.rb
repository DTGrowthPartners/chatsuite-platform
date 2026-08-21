# Quien escribio cada mensaje, a la vista en la conversacion.
#
# Chatwoot YA distingue el bot del humano —Message.vue calcula un
# MESSAGE_VARIANTS.BOT mirando sender.type— y pinta el avatar del remitente,
# pero en ninguna parte escribe el NOMBRE. Con un solo usuario compartido daba
# igual; en cuanto el negocio tiene tres asesores, mirar una conversacion y no
# saber si contesto el bot, Ana o Beto es justo lo que hace falta saber.
#
# El nombre se agrega en la linea de meta del globo (MessageMeta.vue), que es la
# que ya lleva la hora y el acuse de entrega. Va ahi y no en una linea propia
# para no separar los globos ni cambiar el ritmo vertical de la conversacion.
#
# Se parchea con Ruby y no con `sed -i` porque son inserciones multilinea en
# tres puntos distintos del archivo, y un sed multilinea sobre un .vue es
# imposible de leer y peor de arreglar cuando Chatwoot mueva una llave.
#
# ⚠️ Esto hay que rehacerlo al subir de version de Chatwoot: se apoya en el
# `useMessageContext()` de components-next, que es codigo joven y se mueve.
# Si el nombre desaparece de los globos despues de un upgrade, es este archivo.

RUTA = '/app/app/javascript/dashboard/components-next/message/MessageMeta.vue'.freeze

fuente = File.read(RUTA)
abort("patch_autor: no existe #{RUTA}") if fuente.empty?

if fuente.include?('chatsuite-autor')
  puts 'patch_autor: ya estaba aplicado'
  exit 0
end

# 1. Sumar `sender` y `senderType` a lo que ya se saca del contexto del mensaje.
#    El provider los expone (ver provider.js): no hace falta tocar Message.vue
#    ni pasar props nuevas por la cadena de globos.
viejo_ctx = <<~JS.chomp
  const {
    status,
    isPrivate,
    createdAt,
    sourceId,
    messageType,
    contentAttributes,
  } = useMessageContext();
JS

nuevo_ctx = <<~JS.chomp
  const {
    status,
    isPrivate,
    createdAt,
    sourceId,
    messageType,
    contentAttributes,
    sender,
    senderType,
  } = useMessageContext();
JS

abort('patch_autor: no se encontro el bloque de useMessageContext') unless fuente.include?(viejo_ctx)
fuente = fuente.sub(viejo_ctx, nuevo_ctx)

# 2. El nombre a mostrar.
#
#    Solo en los salientes: en un entrante el autor es el cliente, cuyo nombre
#    ya esta arriba en la cabecera de la conversacion, y repetirlo en cada globo
#    solo agrega ruido.
#
#    El bot se rotula «Asistente» y no con el nombre de persona que le puso el
#    cliente (RAMon, Sofia...). Ese nombre es para el cliente final; aca lo que
#    hace falta saber es si contesto una maquina o una persona, y un «RAMon» sin
#    mas se lee como un compañero de trabajo.
computed_autor = <<~JS

  // chatsuite-autor: quien escribio el mensaje.
  const autor = computed(() => {
    if (messageType.value !== MESSAGE_TYPES.OUTGOING &&
        messageType.value !== MESSAGE_TYPES.TEMPLATE) {
      return '';
    }
    const tipo = (sender?.value?.type || senderType?.value || '').toLowerCase();
    if (tipo === 'agent_bot' || tipo === 'captain_assistant') return 'Asistente';
    // Sin remitente y sin nombre, Chatwoot ya asume que fue el bot (misma
    // regla que el variant BOT de Message.vue).
    const nombre = sender?.value?.name || '';
    if (!nombre) return 'Asistente';
    return nombre;
  });
JS

ancla_computed = "const statusToShow = computed(() => {"
abort('patch_autor: no se encontro statusToShow') unless fuente.include?(ancla_computed)
fuente = fuente.sub(ancla_computed, "#{computed_autor.strip}\n\n#{ancla_computed}")

# 3. Pintarlo delante de la hora.
#
#    `truncate` + `max-w` porque un nombre largo empujaria el acuse de entrega
#    fuera del globo, y el acuse es el que dice si el mensaje llego.
viejo_tpl = <<~HTML.chomp
  <div class="text-xs flex items-center gap-1.5">
      <div class="inline">
        <time class="inline">{{ readableTime }}</time>
      </div>
HTML

nuevo_tpl = <<~HTML.chomp
  <div class="text-xs flex items-center gap-1.5">
      <span v-if="autor" class="font-medium truncate max-w-[10rem]">{{ autor }}</span>
      <span v-if="autor" aria-hidden="true">·</span>
      <div class="inline">
        <time class="inline">{{ readableTime }}</time>
      </div>
HTML

abort('patch_autor: no se encontro la linea de meta') unless fuente.include?(viejo_tpl)
fuente = fuente.sub(viejo_tpl, nuevo_tpl)

# MESSAGE_TYPES ya se importa en este archivo (lo usa showStatusIndicator), y
# `computed` tambien. Se comprueba igual: si Chatwoot deja de importarlos, el
# build de Vite falla con un error que no menciona este parche.
abort('patch_autor: falta el import de MESSAGE_TYPES') unless fuente.include?('MESSAGE_TYPES')
abort('patch_autor: falta el import de computed') unless fuente.include?("import { computed } from 'vue'")

File.write(RUTA, fuente)
puts 'patch_autor: aplicado'
