# Ronda 15 · Estudio real A (cerveza, Brasil)

Corte de UAT del 2026-11-11. Studio importó once archivos con 113,338 registros. La preparación procesó 96,150 raíces y excluyó 12,188. Las 83,962 raíces elegibles produjeron 127,117 fragmentos. BERTopic formó 158 grupos. El mapa aceptado reunió 138 grupos en 111 tópicos y conservó 20 exclusiones.

## Costos y tiempos

| Etapa | Cantidad | Unidad | USD a tarifa | USD por 1,000 raíces del estudio |
|---|---:|---|---:|---:|
| Importación | 113,338 | filas de origen | 0.000000 | 0.000000 |
| Preparación de texto | 96,150 | raíces canónicas | 0.000000 | 0.000000 |
| Vectores | 25,591,524 | tokens | 3.071449 | 0.036581 |
| Mapa numérico | 83,962 | raíces elegibles | 0.000000 | 0.000000 |
| Editorial · consolidación global | 1 | respuesta global | 1.155030 | 0.013757 |
| Editorial · grupos | 56 | respuestas de lote | 7.257105 | 0.086433 |
| Propuesta de léxico | 97 | términos propuestos | 0.000000 | 0.000000 |
| JEV · prueba inicial | 1,000 | raíces | 0.068894 | 0.000821 |
| JEV · continuación | 82,962 | raíces adicionales | 5.727985 | 0.068221 |
| Signal | 4 | segmentos | 0.000000 | 0.000000 |

El uso a tarifa sumó **USD 17.280463**. Equivale a USD 0.205813 por mil raíces. La proyección lineal por millón es USD 205.81 con el mismo costo medio. La parte editorial depende del número y tamaño de grupos. Voyage mostró USD 0 de cargo en cuenta por los vectores. El total de la tabla usa la tarifa correspondiente a sus tokens.

| Intervalo | Tiempo de reloj |
|---|---:|
| Importación | 6 h 35 min 45 s |
| Preparación de texto | 16 min 25 s |
| Vectores | 59 min 58 s |
| Exportación, ajuste y preparación editorial | 2 h 28 min 12 s |
| Editorial por grupo y consolidación | 1 h 11 min 48 s |
| Mapa disponible | 11 h 53 min 54 s |
| Escritura final del mapa | 1 h 05 min 47 s |
| JEV · prueba inicial | 1 h 28 min 22 s |
| JEV · continuación | 11 h 43 min 41 s |

Los intervalos de importación y mapa incluyen reintentos y esperas. «Mapa disponible» mide desde la admisión hasta la confirmación final e incluye la preparación editorial, la editorial y la escritura final. Sumar esas filas duplicaría tiempo de reloj. Los 56 recibos de grupo sumaron USD 7.257105. La respuesta global costó USD 1.155030 e incluyó la propuesta del léxico. La recuperación del mapa reutilizó los mismos 57 recibos.

## Cobertura

Sobre 83,962 raíces, 52,489 (62.52 %) tuvieron al menos un tópico con probabilidad superior a 0.7. El máximo quedó entre 0.3 y 0.7, inclusive, para 19,761 (23.54 %). Fue inferior a 0.3 para 11,712 (13.95 %). Quedaron 0 sin probabilidad válida.

Promoción superó 0.7 en 21,771 de 83,962 respuestas válidas (25.93 %). Esta versión de JEV carece de pregunta específica de spam, por lo que su porcentaje queda sin medir.

De 49,616 voces elegibles, 18,845 tuvieron un término de categoría y 30,771 quedaron fuera del indicador. Dentro de las primeras se contaron 5,463 motivadores, 1,154 barreras, 6,687 sin ambos, 5,541 intermedias y 0 sin resolver.

## Mapa

<details><summary>Ver los 111 tópicos y sus volúmenes en Contenido total</summary>

| Tópico | Definición pública | Raíces |
|---|---|---:|
| Asado y cerveza como ritual social | Incluye planes de fin de semana, reuniones familiares y celebraciones donde el asado y la cerveza representan convivencia y ocio, sin marco político específico. | 5,819 |
| Reuniones y promociones de bares | Agrupa invitaciones a visitar bares o pubs por su ambiente, bebidas, aperitivos y planes de convivencia, especialmente en fines de semana o después del trabajo. | 5,786 |
| Bromas y rivalidad entre clubes | Incluye réplicas informales de celebración, burla o decepción sobre resultados, posiciones e identidad de clubes, con tono emocional. | 4,585 |
| Comentarios sobre consumo de cerveza | Agrupa observaciones y bromas sobre beber cerveza en transmisiones, encuentros casuales o reuniones, sin que el precio o una oferta sea el tema central. | 3,551 |
| Venta minorista y entrega de bebidas frías | Incluye comercios que anuncian bebidas refrigeradas para consumo inmediato, reuniones, asados o entrega a domicilio. | 3,451 |
| Reacciones provocadoras tras partidos | Se distingue por burlas o críticas dirigidas a un rival después del resultado, con comentarios sobre goles, desempeño, arbitraje o excusas. | 2,741 |
| Música en vivo y ofertas de bares | Incluye anuncios de actuaciones o karaoke en bares junto con ofertas de bebidas y comida para atraer público. | 2,566 |
| Cultura del bar de barrio | Incluye descripciones y opiniones sobre bares vecinales: ambiente informal, precios accesibles, cerveza fría, aperitivos sencillos y su papel como espacio social. | 2,399 |
| Promoción de restaurantes de asado | Incluye menús de carnes a la parrilla, buffet, cortes, bebidas, servicio a domicilio y propuestas para familias o grupos. | 2,359 |
| Críticas a jugadores y entrenadores | Agrupa reclamos por bajo rendimiento o decisiones de alineación, además de pedidos de suplencia, salida o transferencia. | 2,007 |
| Guías de eventos y ocio local | Reúne agendas y recomendaciones de festivales, música, comida, turismo, deportes y celebraciones locales en distintas regiones. | 1,707 |
| Música en vivo y festivales culturales | Agrupa anuncios, carteleras, reseñas y agendas de conciertos y festivales de diversos géneros, con información de entradas y actividades complementarias. | 1,606 |
| Guías gastronómicas de bares y restaurantes | Incluye recomendaciones editoriales sobre aperturas, menús, platillos, bebidas, chefs, barrios y experiencias culinarias en distintas ciudades. | 1,560 |
| Humor sobre cerveza y bares | Incluye memes, videos cómicos, rutinas y observaciones humorísticas basadas en la vida de bar y el consumo de cerveza. | 1,523 |
| Bebidas como parte de la experiencia del partido | Agrupa escenas, activaciones y promociones donde las bebidas acompañan el ritual de ver partidos y reunirse con otros aficionados. | 1,421 |
| Promociones de cerveza en bares y comercios | Agrupa ofertas de precio, hora feliz, cubetas, cerveza de barril y promociones para consumo en bares o compra minorista. | 1,321 |
| Agradecimiento y apoyo mutuo | Agrupa mensajes personales de gratitud, afecto, solidaridad, buenos deseos y respuesta recíproca al apoyo recibido. | 1,320 |
| Subastas de cuchillos artesanales | Se distingue por publicaciones de subasta con oferta inicial, incrementos, condiciones de pago y envío, y especificaciones de hoja y mango. | 1,287 |
| Opiniones sobre la selección nacional | Incluye debates sobre convocatorias, plantillas, decisiones tácticas y méritos de jugadores en tono coloquial y a menudo humorístico. | 1,283 |
| Participación de audiencia en videos | Se centra en elogios o recomendaciones del contenido, solicitudes de nuevas publicaciones y comentarios sobre videos específicos. | 1,279 |
| Bares con transmisiones de fútbol | Se centra en locales que invitan a ver partidos en pantalla y combinan la transmisión con ofertas de bebidas o comida. | 1,173 |
| Ofertas para ver fútbol en locales de comida | Se distingue por invitaciones de establecimientos a ver partidos allí, con pantallas y precios especiales para comida y bebida durante la transmisión. | 1,110 |
| Crítica a la pasividad política mediante el ocio | Incluye comentarios que presentan el fútbol, los festejos, los asados o el carnaval como distracciones frente a problemas cívicos o políticos. | 980 |
| Peñas y convivencia futbolera con cerveza | Incluye actividades de grupos de aficionados donde la cerveza aparece en reuniones, celebraciones, encuentros antes del partido o convivencias posteriores. | 975 |
| Cultura de cerveza artesanal | Incluye visitas a cervecerías o bares especializados, comentarios sobre estilos, degustaciones y encuentros vinculados con cerveza artesanal. | 971 |
| Exclamaciones de belleza y admiración | Agrupa expresiones breves de afecto o admiración por una persona, animal u objeto, sin desarrollar otro tema sustantivo. | 946 |
| Reacciones emocionales en línea | Incluye expresiones breves de llanto, alegría, tristeza o empatía provocadas por videos o por momentos de otras personas. | 898 |
| Cultura cervecera y vida de bar | Agrupa publicaciones que combinan consumo de cerveza, ambiente de bares, promociones y escenas de convivencia informal. | 868 |
| Menciones de cerveza entre aficionados al fútbol | Incluye comentarios casuales sobre qué cerveza se consume, se prefiere o se encuentra al ver o asistir a partidos; no exige que haya una promoción formal. | 848 |
| Promociones y contenido de hamburguesas | Agrupa ofertas de hamburguesas, propuestas artesanales, servicio a domicilio y combinaciones de comida con ambiente de bar. | 843 |
| Género y ocio masculino | Agrupa debates sobre masculinidad y roles de género conectados con fútbol, cerveza, asados, amistad y prácticas sociales entre hombres. | 820 |
| Noticias y cobertura de clubes de fútbol | Agrupa reportes de partidos, fichajes, plantillas, táctica, decisiones de entrenadores y posiciones en torneos. | 808 |
| Fichajes y gestión de plantillas | Se centra en negociaciones, valoraciones, salarios, contratos, encaje de jugadores y estrategia de clubes en el mercado futbolístico. | 748 |
| Debates de clase sobre gasto en ocio | Se centra en la crítica o defensa de gastar en cerveza y asados en vez de ahorrar, dentro de discusiones sobre pobreza y conducta financiera. | 741 |
| Reacciones a recetas en línea | Se centra en comentarios que elogian la claridad de una receta, cuentan que ya la prepararon o expresan intención de probarla. | 721 |
| Reseñas y comparaciones de automóviles | Incluye especificaciones, precios, pruebas y comparaciones de autos nuevos o usados, así como anuncios de lanzamiento o producción. | 704 |
| Preferencias y comparaciones de cervezas | Reúne opiniones que comparan cervezas, expresan lealtad o rechazo y ordenan preferencias entre productos. | 674 |
| Experiencias de aficionados en día de partido | Reúne actividades previas o durante partidos —encuentros, música, promociones y campañas de acceso— organizadas por clubes, estadios o grupos de fans. | 666 |
| Debate de aficionados sobre un partido entre rivales | Agrupa comentarios de un enfrentamiento entre clubes con análisis del juego, rivalidad, acusaciones arbitrales, elogios, críticas y pronósticos. | 648 |
| Contexto geográfico en comentarios sociales | Incluye comentarios breves sobre lugar de origen o residencia, invitaciones a encontrarse y aclaraciones sobre la ubicación mostrada. | 636 |
| Porteros y penales | Se distingue por reacciones breves a atajadas, cobros de penal y conducta de jugadores, con defensa o crítica del desempeño. | 615 |
| Debates sobre títulos y tradición futbolística | Se centra en comparar palmarés y prestigio histórico, citando conteos de títulos y discutiendo la importancia nacional o internacional. | 597 |
| Lugares y eventos para ver partidos | Incluye listados de bares, restaurantes, zonas de hospitalidad y proyecciones públicas donde se reúnen aficionados, con servicios y programación asociados. | 565 |
| Debates sobre promesas de consumo y economía | Agrupa evaluaciones de una promesa política relacionada con poder comprar alimentos y bebidas, usada para discutir economía y desempeño gubernamental. | 553 |
| Controversias de arbitraje en el fútbol | Incluye jugadas discutidas de gol o penal, críticas al uso de videoarbitraje y debate sobre sanciones a árbitros tras errores percibidos. | 547 |
| Campañas y contenido de refrescos | Agrupa contenido de marca, promociones en bares o comercios, ocasiones de consumo, ediciones especiales, historia del producto y comparaciones con rivales. | 526 |
| Catas y reseñas de cerveza | Se distingue por describir atributos sensoriales o técnicos —estilo, amargor, aroma, sabor, apariencia o maridaje— de productos concretos. | 510 |
| Carnaval, celebridades y entretenimiento | Incluye noticias y contenido editorial de cultura popular, fiestas de carnaval, personalidades, espectáculos, influenciadores y relaciones públicas. | 509 |
| Bromas y chisme en conversación social | Se centra en relatos breves y humorísticos, chismes o comentarios coloquiales, así como solicitudes o reacciones a ese tipo de intercambio. | 505 |
| Réplicas informales sobre fútbol | Agrupa respuestas breves con bromas y comentarios ligeros sobre jugadores, entrenadores, clubes o gestión del fútbol. | 501 |
| Ofertas de carne para reuniones de asado | Agrupa promociones de fin de semana o festivos en supermercados y carnicerías, con cortes, precios y fechas de vigencia para abastecer reuniones. | 448 |
| Combos de pizza y entrega | Se centra en promociones por tiempo limitado que combinan pizza con bebidas u otros productos y facilitan pedidos a domicilio. | 421 |
| Recetas de carnes a la parrilla | Incluye instrucciones, ingredientes y acompañamientos para carnes y platos asados, tanto de comidas festivas como cotidianas. | 419 |
| Patrocinios cerveceros en el fútbol | Reúne conversación sobre contratos de patrocinio, exclusividad y campañas de cerveza en equipos, selecciones y torneos, además de reacciones de aficionados. | 407 |
| Controversias por una frase política sobre delitos | Incluye críticas y réplicas sobre una frase que relaciona un robo con la compra de cerveza; algunas publicaciones discuten su contexto o formulación. | 403 |
| Precios de bebidas en bares | Se centra en comparar precios entre bebidas o locales y debatir si el costo en bares y reuniones sociales es razonable o excesivo. | 389 |
| Carnaval y festejos previos | Incluye programación de desfiles callejeros, bailes y fiestas previas, con horarios, artistas, boletos, bebidas incluidas y logística. | 381 |
| Promociones que vinculan compras con clubes de fútbol | Incluye campañas donde una compra permite dirigir una contribución o beneficio a un club, junto con explicaciones, participación y reacciones de aficionados. | 344 |
| Promoción de música popular | Agrupa lanzamientos, actuaciones, promoción de artistas y música asociada a reuniones, con temas de amor y desamor. | 344 |
| Debate sobre seguridad pública y corrupción | Agrupa expresiones de frustración por delitos y corrupción institucional, con demandas de reformas judiciales y medidas de seguridad más severas. | 343 |
| Reacciones de ocio ante un arresto político | Agrupa publicaciones que expresan expectativa o celebración ante un arresto y lo convierten simbólicamente en ocasión de asado y cerveza. | 342 |
| Sátira política sobre diplomacia informal | Se distingue por ridiculizar propuestas de resolver conflictos internacionales en un ambiente de bar y cuestionar la credibilidad diplomática. | 326 |
| Alimentación social y objetivos de dieta | Incluye estrategias para equilibrar peso o alimentación con asados, fines de semana, alcohol y reuniones, sin proponer necesariamente abstinencia total. | 304 |
| Recomendaciones de viaje y turismo | Agrupa destinos, hoteles, promociones de complejos turísticos y consejos para viajes de descanso en periodos vacacionales. | 300 |
| Ofertas de cerveza en paquetes | Se centra en descuentos de paquetes o compras múltiples, con precios, cupones o enlaces para comprar en contextos de comercio social. | 296 |
| Rivalidad futbolística entre países | Reúne opiniones, estereotipos y posturas favorables o críticas sobre una rivalidad nacional, normalmente activada por partidos o incidentes de aficionados. | 287 |
| Sorteos de comida y bebida en redes | Se distingue por concursos promocionales con premio, reglas de participación —seguir, reaccionar, etiquetar o compartir— y fecha de sorteo. | 273 |
| Frases irónicas sobre tomar algo con amigos | Se distingue por usar una fórmula coloquial de salida casual para ironizar sobre una situación incongruente, aunque a veces aluda a una reunión real. | 266 |
| Opiniones y reseñas de videojuegos | Se centra en calidad, mecánicas, narrativa, disponibilidad, decisiones de desarrollo, multijugador y expectativas de los jugadores. | 244 |
| Promociones de bebida ligadas a rachas de victorias | Se limita a reacciones de aficionados ante ofertas que condicionan una bebida gratis al logro de una secuencia de triunfos de un equipo. | 232 |
| Recetas de postres y dulces | Agrupa preparaciones tradicionales o festivas y versiones ligeras, con ingredientes, pasos, sugerencias para servir e invitaciones a guardar o compartir. | 226 |
| Comunidad de videojuegos y tecnología | Incluye hardware de computadora o consola, noticias, configuraciones, transmisiones, lanzamientos, precios y modificaciones de juegos. | 221 |
| Reacciones a contenido de bares y viajes | Se distingue por comentarios de audiencia que expresan ganas de visitar, nostalgia, solicitudes de recomendaciones o planes de viaje tras ver contenido gastronómico o turístico. | 207 |
| Preferencias y formas de preparar betabel | Incluye comentarios de gusto o preferencia y menciones a prepararlo crudo, cocido, en ensalada, jugo o encurtido. | 206 |
| Cobertura de festivales de asado y gastronomía | Se distingue por anunciar o reseñar festivales al aire libre con técnicas de asado, puestos de comida, música y actividades familiares. | 191 |
| Entrega y alquiler de cerveza de barril | Agrupa venta de barriles, alquiler de dispensadores y entrega para reuniones, fiestas o celebraciones en casa. | 190 |
| Modelos de seguridad en el debate político | Se distingue por pedir que políticas de seguridad aplicadas en otro país se adopten localmente y discutir quién podría ejecutarlas. | 187 |
| Elogios de aficionados a la música | Se centra en comentarios que admiran canciones, voces, presentaciones en vivo, colaboraciones y conexión emocional con la música. | 166 |
| Promociones de refrigeradores | Se centra en anuncios de refrigeradores con precios rebajados, pagos a plazos y cupones de compra. | 166 |
| Ofertas de electrodomésticos de cocina | Incluye descuentos y cupones para freidoras y otros aparatos de cocina, con menciones incidentales a artículos domésticos relacionados. | 162 |
| Admiración por hogares y espacios domésticos | Incluye reacciones a casas o propiedades rurales por su belleza, comodidad o tranquilidad, deseos de vivir allí y sugerencias de decoración. | 157 |
| Admiración y tenencia de perros de raza grande | Incluye deseo de tener, experiencias de cuidado y comparaciones de una raza canina, además de comentarios sobre aspecto y temperamento. | 156 |
| Menús y promociones de restaurantes de carnes | Incluye ofertas de comida, almuerzos, bebidas, eventos y servicios de restaurantes especializados en carnes. | 152 |
| Marketing de bebidas en el deporte | Incluye análisis editoriales o de industria sobre alianzas comerciales de bebidas con deportes, ligas, torneos, videojuegos competitivos y plataformas de transmisión. | 149 |
| Precios de combustibles | Agrupa precios locales por litro, comparación entre combustibles, factores como impuestos y reacciones ante aumentos. | 143 |
| Accesorios artesanales para bebidas y asados | Incluye artículos hechos a mano o impresos en 3D, como abridores, soportes, tablas y bandejas, a menudo ofrecidos como regalos. | 142 |
| Malestar en relaciones y consejos comunitarios | Agrupa relatos de conflicto en pareja, familia o convivencia y respuestas de apoyo, límites o recomendaciones para alejarse. | 127 |
| Ofertas minoristas de refrescos | Se centra en descuentos por tiempo limitado en distintos tamaños o presentaciones de refrescos para comidas, asados o reuniones. | 125 |
| Entradas y acceso a estadios | Agrupa información de venta de boletos, precios, sectores, categorías de asiento y novedades de infraestructura de un estadio o club. | 116 |
| Bromas entre dos aficiones rivales | Incluye réplicas sobre resultados e historial entre dos clubes, así como contraargumentos y burlas cruzadas de sus seguidores. | 115 |
| Ofertas de hieleras y bolsas térmicas | Agrupa descuentos de cajas, bolsas y accesorios térmicos pensados para playa, camping, pesca y reuniones al aire libre. | 115 |
| Combos de bebidas energéticas | Incluye promociones de bebidas energéticas solas o combinadas con otras bebidas, dirigidas a pedidos y reuniones nocturnas. | 113 |
| Anuncios de conciertos de samba y pagode | Se centra en carteleras de actuaciones en vivo con horarios, localidades, boletos y oferta de comida o bebida para el público local. | 110 |
| Promoción de eventos nocturnos | Incluye invitaciones a fiestas o salidas en un local, con referencias generales a días, bebidas, música y ambiente social. | 109 |
| Campañas de bebidas alrededor de la selección y torneos globales | Agrupa campañas que usan identidad nacional, historia futbolística y entusiasmo de grandes torneos para conectar bebidas con consumidores. | 108 |
| Programación nocturna de un local | Agrupa anuncios recurrentes de bandas en vivo, horarios, entrada y ofertas de bebidas de un establecimiento de vida nocturna. | 105 |
| Venta de productos para aficionados al fútbol | Agrupa artículos y accesorios con identidad de clubes —vasos, prendas, llaveros o kits de asado— presentados con precio y llamada de compra. | 102 |
| Debate sobre el aporte de un jugador al club | Incluye opiniones sobre contribución deportiva, conducta, relación con compañeros y directiva, asuntos económicos y efecto en el equipo. | 98 |
| Reacciones a un sorteo promocional de electrodoméstico | Agrupa mensajes de apoyo o deseo de ganar un refrigerador en un concurso comercial y comentarios sobre una posible nueva ronda. | 98 |
| Reacciones a un conflicto internacional | Incluye comentarios de lectores sobre ataques, personas retenidas y posturas políticas contrapuestas en torno a una guerra. | 96 |
| Nostalgia por envases promocionales de bebidas | Se distingue por recuerdos de envases antiguos con sonidos o frases y su comparación con una promoción contemporánea. | 95 |
| Memes sobre refrescos que pierden fuerza | Incluye la comparación humorística entre algo que empieza con energía y luego decae, usando como analogía una botella grande que pierde gas. | 88 |
| Patrocinios de bebidas en el fútbol | Incluye activaciones comerciales alrededor de competiciones de fútbol, como promociones en locales, experiencias de marca, retransmisiones y participación de aficionados. | 83 |
| Demandas ciudadanas de inversión pública | Incluye críticas a la asignación de recursos y reclamos por servicios de salud, educación, seguridad, escuelas, hospitales y condiciones laborales públicas. | 68 |
| Oraciones por animales rescatados o enfermos | Se distingue por expresiones de fe y buenos deseos hacia animales en dificultad o quienes los rescatan y cuidan. | 65 |
| Límites de crédito y recuperación financiera | Agrupa experiencias para aumentar límites de tarjeta o reconstruir historial tras deudas, acuerdos, puntuaciones y herramientas financieras. | 62 |
| Debate sobre publicidad en el espacio urbano | Se centra en pantallas y anuncios digitales en el centro de una ciudad, con argumentos sobre contaminación visual, legalidad, comercio y paisaje urbano. | 61 |
| Opiniones sobre la gestión de un gobierno estatal | Agrupa valoraciones divididas sobre gestión y legado, incluidas políticas de privatización, seguridad y servicios públicos. | 57 |
| Sanciones a grupos de aficionados | Se centra en castigos por bengalas o fuegos artificiales en estadios, comparaciones entre sanciones y debate sobre aplicación y vacíos de control. | 56 |
| Autonomía real de vehículos eléctricos e híbridos | Se centra en cuestionar o verificar cifras de autonomía, consumo y eficiencia frente a mediciones oficiales o afirmaciones de fabricantes. | 45 |
| Debates sobre faltas en jugadas concretas | Agrupa comparaciones entre incidentes de contacto aéreo para discutir equivalencia, intención y reacción posterior de los jugadores. | 38 |

</details>

Una raíz puede pertenecer a varios tópicos. La clasificación usó el léxico curado de 129 términos y dos intereses con umbral 0.85. El paquete privado identifica los tópicos originales y conserva los recibos, los cuatro segmentos de Signal, la comparación con el estudio humano y las muestras ciegas.
