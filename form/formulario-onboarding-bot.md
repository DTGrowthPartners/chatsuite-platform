# Formulario de onboarding — Bot de ventas por WhatsApp (DT Growth Partners)

Preguntas para el cliente antes de construir su agente IA de ventas. Con las
respuestas se arman: el prompt de personalidad, las respuestas rápidas, el
catálogo, las reglas de comportamiento y los límites del bot.

Leyenda: **[CRÍTICO]** = sin esto el bot no puede salir a producción.
Lo demás mejora la calidad pero tiene un valor por defecto sensato.

> Regla de oro aprendida: todo lo que el negocio no defina aquí, el bot lo va a
> improvisar o lo va a escalar a un humano. Mejor que sobre información.

---

## 1. El negocio

1. **[CRÍTICO]** Nombre comercial del negocio (tal como quieren que el bot lo diga).
2. **[CRÍTICO]** ¿Qué venden, en una frase? (ej: "ropa de hombre al por mayor y al detal")
3. Ciudad principal y cobertura (¿venden solo local, nacional, internacional?).
4. Redes sociales activas (Instagram, Facebook, TikTok) y página web si existe.
5. **[CRÍTICO]** ¿Tienen punto físico? ¿El cliente puede visitar o recoger?
   - Si NO: ¿qué debe responder el bot cuando pidan la dirección o "pasar a
     recoger"? (En Tu Bodega esto fue un protocolo estricto: nunca dar
     dirección, todo por domicilio. Definirlo desde el día 1 evita problemas.)
6. **[CRÍTICO]** Horario de atención (días y horas). ¿Qué dice el bot fuera de horario?
7. ¿De dónde llegan los clientes? (pauta de Meta, orgánico, referidos…) ¿Cuántos
   mensajes nuevos por día esperan?

## 2. Catálogo y productos

8. **[CRÍTICO]** Lista de productos con: nombre, precio al detal, tallas
   disponibles, colores disponibles. (Adjuntar Excel o lista; si un precio "está
   por definir", marcarlo — el bot no inventa precios.)
9. **[CRÍTICO]** Fotos de cada producto (buena luz, una por producto mínimo).
   Adjuntar carpeta o ZIP. + El logo del negocio en PNG.
10. ¿Manejan inventario en tiempo real? ¿El bot puede afirmar "sí hay" o debe
    confirmar disponibilidad con el equipo antes de prometer?
11. ¿Qué productos les preguntan que NO manejan? ¿Qué debe responder el bot?
    (ej: "¿conjuntos deportivos?" → "no manejamos, pero tenemos…")
12. ¿Quieren catálogo en PDF descargable/compartible además de fotos sueltas?

## 3. Precios, promociones y negociación

13. **[CRÍTICO]** Promoción vigente EXACTA, palabra por palabra, si existe.
    (ej: "3 camisetas por $105.000"). ¿Cambia seguido? ¿Quién la actualiza?
14. **[CRÍTICO]** ¿Hay precio al por mayor? ¿Desde cuántas unidades, con qué
    tabla de precios? ¿A partir de qué cantidad debe intervenir un humano?
15. ¿El bot puede negociar o dar descuentos? ¿Hasta dónde? ¿O precio fijo
    siempre y "descuento" = pasar a humano?
16. Cuando el cliente dice "está caro", ¿qué responden ustedes hoy? (la
    respuesta real que usan, no la ideal)

## 4. Entregas, envíos y cobertura

17. **[CRÍTICO]** Domicilios locales: tabla de zonas/barrios con su tarifa.
    (Adjuntar Excel. Las zonas sin tarifa el bot las consulta con el equipo —
    entre más completa la tabla, menos interrupciones.)
18. **[CRÍTICO]** Envíos nacionales: ¿con qué transportadora, qué cuesta, cuánto
    tarda, se paga contra entrega o anticipado?
19. Tiempos de entrega local (mismo día? franjas? hora de corte para "hoy"?).
20. ¿Hay monto mínimo de compra para domicilio o envío gratis desde X valor?

## 5. Pagos

21. **[CRÍTICO]** Métodos de pago aceptados, con los datos exactos que se le
    dan al cliente (Nequi/Daviplata/cuenta + número + titular).
22. ¿Pago contra entrega? ¿En qué casos sí y en cuáles se exige anticipo?
23. ¿El bot puede confirmar que un pago llegó? (recomendado: NO — comprobantes
    los verifica un humano; el bot solo lo registra y avisa)

## 6. El cierre de la venta

24. **[CRÍTICO]** ¿Qué datos hay que pedirle al cliente para tomar un pedido?
    (ej: nombre, barrio, dirección, punto de referencia, teléfono, medio de pago)
25. **[CRÍTICO]** ¿Quién cierra la venta? ¿El bot toma el pedido completo y un
    humano solo despacha, o el bot toma los datos y un humano confirma antes?
    (En Tu Bodega: el bot registra el pedido y SIEMPRE lo remata un humano.)
26. ¿Qué pasa después del pedido? (tiempos de despacho, mensaje de confirmación,
    seguimiento de entrega)

## 7. Personalidad del bot

27. **[CRÍTICO]** ¿Cómo se llama el bot? ¿Se presenta como persona del equipo o
    como asistente? (recomendado: nombre de persona, sin decir que es IA)
28. **[CRÍTICO]** Tono: ¿cómo le hablan a los clientes hoy? (formal/relajado,
    tuteo/usted, modismos locales sí o no). Ideal: pegar 3-5 conversaciones
    reales de WhatsApp donde ustedes vendieron bien — de ahí sacamos la voz.
29. ¿Emojis? ¿Cuáles usan siempre y cuáles jamás?
30. Frases o muletillas de la casa que el bot debería usar (y las prohibidas).
31. ¿Qué NUNCA debe decir o prometer el bot? (garantías, fechas exactas,
    marcas "originales", datos personales del dueño…)

## 8. Respuestas rápidas existentes

32. **[CRÍTICO]** Pegar TODOS los mensajes armados que hoy copian y pegan:
    bienvenida, promoción, datos para domicilio, datos para envío, calidad y
    tallas, ubicación, preguntas frecuentes. Tal cual los mandan, sin editar.
    (El bot los usa literal cuando toca: el cliente no nota el cambio.)

## 9. Equipo y escalamiento

33. **[CRÍTICO]** ¿Quiénes atienden? Nombre + número de WhatsApp de cada uno.
    (El bot no los trata como clientes y les avisa las urgencias.)
34. **[CRÍTICO]** ¿Cuándo debe pasar el bot la conversación a un humano?
    Marcar todo lo que aplique: cliente molesto · pide hablar con persona ·
    negociación de precio · confirmación de pago · reclamo/devolución · pedido
    mayorista grande · pregunta que no está en su información · otro: ___
35. ¿A quién le avisa el bot cuando necesita un dato (un precio pendiente, una
    zona sin tarifa)? ¿Por qué medio prefieren el aviso?
36. ¿Los asesores responden también desde el mismo número? ¿El bot debe
    apartarse cuando un humano entra al chat? (recomendado: sí, 1 hora)

## 10. Objeciones y casos difíciles

37. Las 5 preguntas u objeciones MÁS repetidas de sus clientes, y cómo las
    responden hoy (texto real).
38. Política de cambios, devoluciones y garantías, en palabras simples.
39. ¿Qué hace el bot con un reclamo de un pedido ya entregado?
40. ¿Hay temas sensibles del negocio que el bot debe esquivar por completo?

## 11. Seguimiento y reactivación

41. Si un cliente pregunta y desaparece, ¿quieren que el bot le escriba después
    para retomar? ¿Cuánto tiempo después y máximo cuántas veces?
    (Ojo: en el canal oficial de WhatsApp, escribir primero después de 24 h
    requiere plantillas aprobadas por Meta — se diseñan en el onboarding.)
42. ¿Enviarán difusiones/campañas salientes? ¿A qué base y con qué frecuencia?

## 12. Canal y datos técnicos (lo llena DTGP con el cliente)

43. Número de WhatsApp del negocio. ¿Está dispuesto el cliente a que ese número
    pase a la **API oficial de Meta** (deja de funcionar en la app del celular;
    toda la atención pasa al panel)? Si no, ¿usarán un número nuevo dedicado?
44. Acceso al Business Manager de Meta del cliente (o autorización para crear
    app y WABA en su portafolio — lección aprendida: la app SIEMPRE en el
    portafolio del cliente, no en el nuestro).
45. ¿Pauta activa de click-to-WhatsApp? (para montar la atribución de ventas a
    anuncios desde el día 1.)
46. ¿Qué reportes quieren y cada cuánto? (ej: resumen diario de atendidos,
    pedidos y escaladas.)

---

## Checklist de material que debe entregar el cliente

- [ ] Excel/lista de productos con precios, tallas y colores
- [ ] Fotos de productos (ZIP) + logo en PNG
- [ ] Tabla de zonas de domicilio con tarifas
- [ ] Textos de respuestas rápidas que usan hoy (todos)
- [ ] 3-5 conversaciones reales de ventas exitosas (screenshots o export)
- [ ] Promoción vigente palabra por palabra
- [ ] Datos de pago exactos
- [ ] Lista del equipo con números
- [ ] Acceso o autorización en Meta Business Manager
