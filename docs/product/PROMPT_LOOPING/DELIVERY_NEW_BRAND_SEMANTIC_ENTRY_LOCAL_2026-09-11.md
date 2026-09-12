# Nueva marca → contexto e intereses: cierre local

Fecha de cierre: 11 septiembre 2026 México / 12 septiembre UTC

Estado: **cerrado localmente; pendiente SQL0161 y entrega focal UAT**.

## Resultado de producto

El recorrido de una marca nueva ya tiene una entrada autoservicio coherente hasta quedar lista para
recibir menciones reales:

1. Un `client_admin` crea una marca dentro de su organización. El servidor deriva un slug estable y
   concede al creador administración sólo sobre esa marca.
2. La marca abre Brand OS y sus Knowledge Bases sin depender de credenciales Claude, Redis o Worker
   para el sellado gratuito de su fuente.
3. Si la organización no tiene historia de políticas, el servidor puede crear una política acotada
   de Brand Context. El iniciador cliente queda separado del creador financiero interno configurado.
   La creación de política no admite trabajos, no encola y no gasta.
4. Claude y Voyage conservan sus cotizaciones y confirmaciones explícitas. La interfaz interna deja
   de mostrar un control cliente inoperante.
5. Si el usuario cambia Topics después de preparar Brand Context, la UI marca las guías pendientes.
   Un refresco crea un sucesor ligado al plan vigente, siempre exige confirmación y reutiliza la
   caché por hash. No repite Claude ni modifica los recibos anteriores.
6. Datos mantiene el regreso a Brand OS. El cliente no ve el slug técnico y el formulario conserva
   catálogos, accesibilidad y mensajes ES/EN.

National no recibió lógica especial, imports, fit ni llamadas. Sigue siendo una regresión histórica;
el siguiente experimento se hará con una marca y menciones reales elegidas por el operador.

## Autoridad y gasto

- Organización, marca, workspace, actor, grant y plan provienen de PostgreSQL.
- El navegador no controla actor, creador de política, modelo, configuración, plan ni topes.
- La provisión requiere `NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID`, tope diario y vigencia
  configurados en servidor; si faltan, la marca permanece creada y la UI muestra configuración
  pendiente.
- SQL0161 sólo permite refrescar una hoja `completed`, sin lease, reserva, excepción ni llamada
  incierta, con el mismo contexto y un plan diferente construido por el servidor.
- `outcome_unknown` bloquea el refresco. Una caché completa concede cap0 y ningún envío, pero sigue
  requiriendo una confirmación nueva.
- Sonnet 4.6 y Voyage 4 Large continúan como identidades permitidas. Opus no se usa.
- Este cierre local realizó **cero conexiones remotas, llamadas de proveedor o gasto**.

## Verificación

- PostgreSQL compuesto SQL0141–0161: **10 casos PASS** en 4.986 s, incluidas las ramas cache-only
  y `outcome_unknown`; 0 transportes, rollback exacto, base temporal eliminada y 269 censos fuente
  intactos.
- Base de datos: suite completa PASS; focales de policy/refresco/procesamiento **35/35**.
- Studio: **1,001 PASS, 7 omitidos, 0 fallas**; focales integrados **106/106**.
- Worker: **564 PASS, 42 omitidos, 0 fallas**.
- Typecheck DB/Studio/Worker PASS; lint Studio 0 errores y 13 warnings históricos.
- Build Studio PASS con configuración sintética local de build.
- Revisión adversarial: **P0 0 / P1 0 / P2 0**.

La primera ejecución global de Studio sin `DATABASE_URL` produjo dos fallos de carga en pruebas
históricas que importan el pool de forma estática. Con una URL local sintética, sin conexión de red,
la suite completa quedó verde. No se cambió producto para ocultar ese requisito del entorno de test.

## Entrega UAT

Orden obligatorio: preflight read-only → aplicar SQL0161 una sola vez → Worker → Studio → QA real
ES/EN y responsive → recibo posterior sin actividad inesperada. No reaplicar SQL0153–0160, no
reimportar National y no activar proveedores durante la entrega.

Después de UAT, la siguiente entrada legítima es crear o escoger una marca real y cargar sus CSV por
la UI. El tramo posterior todavía debe conceder admisiones acotadas a cliente para embeddings del
corpus, full fit, interpretación e incremental; `can_execute_topics` permanece interno.
