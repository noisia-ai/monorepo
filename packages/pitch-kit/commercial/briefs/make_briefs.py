"""
make_briefs.py — los cuatro briefs de Noisia (estudio y reporte, de marca y político) como HTML
que Google Drive convierte en Google Docs editables.

    python3 make_briefs.py out/

Cada HTML se sube con el conector de Drive (create_file, contentMimeType text/html), que lo
convierte a Doc. Lo que la conversión respeta y lo que no, probado en oct 2026:

  · Las cajas de respuesta son celdas de tabla sombreadas: se convierten bien.
  · Casillas, desplegables y controles de Word NO se convierten: llegan como texto.
  · La fuente no viaja: Docs abre en Arial.

Por eso, después de subir cada Doc, en el navegador:

  1. Las opciones llevan un color único (.o, #1c1c1c). Doble clic en una opción, clic derecho >
     Ver más acciones > Seleccionar todo el texto que coincida (agrupa por formato, no por
     texto), y Cmd+Shift+9 las vuelve checklist nativo de una sola vez.
  2. Con esa selección activa, la flecha del botón de checklist > el estilo de la derecha, que no
     tacha la opción al marcarla.
  3. Cmd+A y fuente Google Sans.
  4. Archivo > Configuración de página > Sin páginas, para que ninguna fila se parta.
"""
import html, json, os, sys

LOGO = ("https://raw.githubusercontent.com/noisia-ai/monorepo/pitch-kit/commercial-family/"
        "packages/pitch-kit/commercial/assets/logo/noisia.png")
INK, FG, FG2, TEAL = "#0a0a0a", "#2b2b2b", "#6d6d6d", "#008a8a"
BOX_BG, BOX_BORDER, LAB_BG, LAB_BORDER = "#f2fbfb", "#cfeaea", "#fafafa", "#eeeeee"


def esc(s):
    return html.escape(s, quote=False)


def label_cell(q, help_=None):
    h = f'<b>{esc(q)}</b>'
    if help_:
        h += f'<br><span class="h">{esc(help_)}</span>'
    return f'<td class="l">{h}</td>'


def answer_cell(kind, opts=None, lines=2, internal=False):
    cls = "i" if internal else "a"
    if kind == "opts":
        inner = "".join(f'<p class="o">{esc(o)}</p>' for o in opts)
    else:
        inner = "<p>&nbsp;</p>" * lines
    return f'<td class="{cls}">{inner}</td>'


def table(rows, internal=False):
    out = ['<table>']
    for r in rows:
        q, help_, kind = r[0], r[1], r[2]
        extra = r[3] if len(r) > 3 else None
        if kind == "opts":
            cell = answer_cell("opts", extra, internal=internal)
        else:
            cell = answer_cell("text", lines=extra or 2, internal=internal)
        out.append(f"<tr>{label_cell(q, help_)}{cell}</tr>")
    out.append("</table>")
    return "".join(out)


def note(text):
    return (f'<table style="border-collapse:collapse;width:100%"><tr><td style="padding:10px 14px;'
            f'border:1px solid #e6f7f7;background:#e6f7f7;color:{FG}">{text}</td></tr></table>')


def build(b):
    css = (f"body{{color:{FG};font-size:10.5pt}} table{{border-collapse:collapse;width:100%}} "
           f"td{{padding:9px 12px;vertical-align:top}} td p{{margin:0}} "
           f".l{{width:40%;border:1px solid {LAB_BORDER};background:{LAB_BG}}} "
           f".a{{border:1px solid {BOX_BORDER};background:{BOX_BG}}} "
           f".i{{border:1px solid {LAB_BORDER};background:{LAB_BG}}} .h{{color:{FG2};font-size:9pt}} "
           f"h2{{font-size:14pt;color:{TEAL}}} h2.n{{color:{FG2}}} .s{{color:{FG2}}} .o{{color:#1c1c1c}}")
    p = [f'<html><head><meta charset="utf-8"><style>{css}</style></head><body>']
    p.append(f'<p><img src="{LOGO}" width="86" height="30"></p>')
    p.append(f'<h1 style="font-size:24pt;font-weight:normal;color:{INK}">{esc(b["title"])}</h1>')
    p.append(f'<p style="color:{FG2};font-size:11.5pt">{esc(b["subtitle"])}</p>')
    p.append(note(b["how"]))
    p.append("<p>&nbsp;</p>")
    for sec in b["sections"]:
        internal = sec.get("internal", False)
        p.append(f'<h2{" class=n" if internal else ""}>{esc(sec["h"])}</h2>')
        if sec.get("intro"):
            p.append(f'<p class="s">{esc(sec["intro"])}</p>')
        p.append(table(sec["rows"], internal=internal))
    p.append(f'<p>&nbsp;</p><p style="color:{FG2};font-size:9pt">noisia · social intelligence architects · '
             f'Información confidencial</p></body></html>')
    return "".join(p)


HOW = ("<b>Cómo se llena.</b> Escribe dentro de las cajas azules y marca las casillas que apliquen. "
       "Si una respuesta todavía no la tienes, déjala vacía: la resolvemos juntos en el workshop.")

GENERAL_MARCA = {"h": "Datos generales", "rows": [
    ("Empresa", None, "text", 1),
    ("Marca, producto o servicio", "El sujeto del trabajo, como lo nombra la gente.", "text", 1),
    ("Industria o categoría", None, "text", 1),
    ("Mercados y ciudades", "País, estados o ciudades que importan.", "text", 1),
    ("Idioma del entregable", None, "opts", ["Español", "Inglés", "Los dos"]),
    ("Quién llena este brief", "Nombre, área y correo.", "text", 1),
    ("Para cuándo lo necesitas", "La fecha en que tomas la decisión, no solo la de entrega.", "text", 1),
]}

GENERAL_POL = {"h": "Datos generales", "rows": [
    ("Cliente", "Campaña, partido, gobierno, consultora o agencia.", "text", 1),
    ("Actor o tema", "La persona, el cargo, la iniciativa o el tema a leer.", "text", 1),
    ("Territorio", "País, estado, municipios o distrito.", "text", 1),
    ("Fecha clave", "Elección, informe, votación, arranque de campaña.", "text", 1),
    ("Idioma del entregable", None, "opts", ["Español", "Inglés", "Los dos"]),
    ("Quién llena este brief", "Nombre, rol y correo.", "text", 1),
]}

LIMITS_POL = {"h": "Lo que acordamos desde el inicio", "intro":
              "Cuatro límites que protegen la lectura y a quien la usa. Márcalos cuando los hayas leído.",
              "rows": [
    ("Conversación no es intención de voto", "El volumen de conversación no proyecta votos ni resultados.", "opts", ["Leído y acordado"]),
    ("La ubicación depende de la fuente", "La precisión geográfica cambia según la red y la publicación.", "opts", ["Leído y acordado"]),
    ("Sugerimos mensajes", "Las recomendaciones de mensaje son sugerencias; no prometemos mover la opinión pública.", "opts", ["Leído y acordado"]),
    ("Un pico se explica con su origen", "Un pico solo se atribuye a la publicación que lo inició, verificada.", "opts", ["Leído y acordado"]),
]}

HAVE = {"h": "Lo que ya tienes", "rows": [
    ("¿Usas una herramienta de social listening?", None, "opts", ["Sí", "No"]),
    ("¿Cuál, y qué te deja corto?", None, "text", 2),
    ("Datos propios que puedes compartir", "NPS, encuestas, ventas por ciudad o canal, CRM, desempeño de campañas.", "text", 2),
    ("Estudios o reportes previos sobre el tema", "Nombre, fecha y quién los hizo.", "text", 2),
]}

BRIEFS = {
"estudio-marca": {
  "title": "Brief · Estudio de marca",
  "subtitle": "Para responder una pregunta de negocio concreta, por proyecto. Lo usamos en el workshop para cerrar la pregunta, el alcance y la entrega.",
  "how": HOW,
  "sections": [
    GENERAL_MARCA,
    {"h": "La decisión", "rows": [
      ("¿Qué decisión vas a tomar con este estudio?", "Lanzar, reposicionar, entrar a un mercado, ajustar un mensaje, priorizar un producto.", "text", 3),
      ("¿Qué pasa si te equivocas?", "Ayuda a medir el riesgo y la profundidad que necesita el estudio.", "text", 2),
      ("¿Quién va a usar el resultado?", "Las personas o áreas que van a actuar con él.", "text", 2),
      ("¿Qué intentaste antes y por qué no alcanzó?", None, "text", 2),
    ]},
    {"h": "La pregunta", "rows": [
      ("¿En qué momento de decisión estás?", "Marca una. Si no estás seguro, márcalo y lo definimos juntos.", "opts", [
        "Para lanzar: ¿sobre qué territorio construyo sin sonar genérico?",
        "Para entrar: ¿cómo funciona esta categoría o mercado?",
        "Para defender: ¿qué capitaliza mi competencia y dónde soy vulnerable?",
        "Para optimizar: ¿dónde se rompe el camino entre la intención y la compra?",
        "Para innovar: ¿qué necesidad sigue sin resolverse?",
        "No estoy seguro"]),
      ("La pregunta de negocio, en una frase", "Ejemplo: ¿qué empuja a probar una bebida fría nueva, y qué la frena?", "text", 2),
      ("¿Qué crees que está pasando?", "Tus hipótesis. Las medimos una por una; no las damos por buenas.", "text", 3),
    ]},
    {"h": "El alcance", "rows": [
      ("¿Sobre quién es el estudio?", None, "opts", [
        "Mi marca", "Mi marca frente a mis competidores", "La categoría completa, sin una marca protagonista"]),
      ("Competidores", "Los que tu cliente compara contigo hoy. Hasta cuatro.", "text", 2),
      ("Periodo", None, "opts", ["Últimos 3 meses", "Últimos 6 meses", "Últimos 12 meses", "Otro (escríbelo abajo)"]),
      ("Fechas o momentos clave dentro del periodo", "Lanzamientos, campañas, temporadas, crisis.", "text", 2),
      ("Dónde crees que se habla de tu marca", "Marca todas las que apliquen.", "opts", [
        "Redes sociales", "Reseñas y calificaciones", "Búsqueda y respuestas de IA", "Foros y comunidades", "Medios"]),
      ("Palabras que se confunden con tu marca", "Nombres compartidos, otros significados, cuentas que no son tuyas.", "text", 2),
    ]},
    HAVE,
    {"h": "La entrega", "rows": [
      ("Formato", "Marca todas las que necesites.", "opts", ["Presentación en vivo", "Documento PDF", "PPTX editable"]),
      ("¿Quién va a estar en la presentación?", None, "opts", [
        "Dirección", "Marketing y marca", "Insights o investigación", "Agencia o creativos", "Producto", "Otro"]),
      ("Temas sensibles o confidenciales", "Lo que no debe aparecer en el documento.", "text", 2),
    ]},
    {"h": "Lo completa Noisia", "internal": True,
     "intro": "Después del workshop. Es lo que necesita el equipo para arrancar sin volver a preguntar.",
     "rows": [
      ("Metodología", None, "text", 1),
      ("Pregunta de investigación final", None, "text", 2),
      ("Sujeto", None, "opts", ["Marca", "Categoría, con la marca leída dentro", "Comparativo"]),
      ("Universo y cortes", "Qué búsqueda representa el universo y cuáles son cortes, contexto o competidor.", "text", 2),
      ("Fecha completamente cerrada del periodo", None, "text", 1),
      ("Idiomas y canales que se conservan", None, "text", 1),
      ("Exclusiones y homónimos esperados", None, "text", 2),
      ("Si el volumen no alcanza", "Bajar el alcance del método, ampliar la ventana o subir el sujeto a categoría.", "text", 1),
      ("Responsable y fecha de entrega", None, "text", 1),
    ]},
  ]},

"reporte-marca": {
  "title": "Brief · Reporte de marca",
  "subtitle": "Para el monitoreo continuo de tu marca, tu competencia o una campaña. Con esto armamos el primer mes, que construye la línea base.",
  "how": HOW,
  "sections": [
    GENERAL_MARCA,
    {"h": "Qué quieres seguir", "rows": [
      ("Tipo de reporte", "Marca uno.", "opts", [
        "Monitoreo de marca: qué se dice de mi marca y de qué depende",
        "Marca y competencia: cómo estoy contra ellos y qué capitalizan",
        "Lectura de campaña o momento: cómo le fue a lo que lancé"]),
      ("¿Qué quieres saber cada periodo?", "Las preguntas que el reporte tiene que contestar siempre.", "text", 3),
      ("¿Qué decisiones toma tu equipo con esta lectura?", None, "text", 2),
      ("¿Quién recibe el reporte y qué hace con él?", None, "text", 2),
    ]},
    {"h": "Qué se escucha", "intro": "Cada marca, producto, servicio, influencer o persona que el reporte sigue es un factor. Una industria no es un factor: contiene varios.", "rows": [
      ("Marcas, productos o personas a seguir", "Uno por línea, con sus cuentas oficiales si las hay.", "text", 4),
      ("Competidores", "Hasta cuatro, con sus cuentas oficiales.", "text", 3),
      ("Campañas o momentos a seguir", "Nombre, fechas y hashtags.", "text", 2),
      ("Palabras que se confunden con tu marca", None, "text", 2),
      ("Temas sensibles que hay que vigilar", "Lo que, si aparece, quieres saber antes que nadie.", "text", 2),
    ]},
    {"h": "Cadencia y entrega", "rows": [
      ("Cadencia", "Marca una. La diaria es para seguimiento en crisis.", "opts", ["Diaria", "Semanal", "Quincenal", "Mensual"]),
      ("Fecha de arranque", "El contrato es mensual, con mínimo de tres meses.", "text", 1),
      ("Formato", "Marca todas las que necesites.", "opts", [
        "PDF", "PPTX", "Executive summary", "Email", "WhatsApp", "Dashboard en vivo"]),
      ("Identidad del reporte", None, "opts", ["Marca Noisia", "Tu marca", "Las dos"]),
      ("Quién recibe las alertas, y por qué canal", None, "text", 2),
    ]},
    HAVE,
    {"h": "Lo completa Noisia", "internal": True,
     "intro": "Después del workshop. Es lo que necesita el equipo para arrancar sin volver a preguntar.",
     "rows": [
      ("Factores y búsquedas", "Una búsqueda por factor; cada competidor con su propio universo.", "text", 3),
      ("Periodo base", "El primer mes construye la línea base contra la que se compara el resto.", "text", 1),
      ("Métricas por periodo", None, "text", 2),
      ("Fecha completamente cerrada de cada corte", None, "text", 1),
      ("Exclusiones y homónimos esperados", None, "text", 2),
      ("Responsable y fecha de la primera entrega", None, "text", 1),
    ]},
  ]},

"estudio-politico": {
  "title": "Brief · Estudio político",
  "subtitle": "Para responder una pregunta estratégica sobre un actor, un tema o un territorio, por proyecto. Lo usamos en el workshop para cerrar la pregunta, el alcance y la entrega.",
  "how": HOW,
  "sections": [
    GENERAL_POL,
    {"h": "La decisión", "rows": [
      ("¿Qué decisión estratégica vas a tomar?", "Mensaje, posicionamiento, agenda, prioridad territorial, alianzas.", "text", 3),
      ("¿Para cuándo?", None, "text", 1),
      ("¿Quién va a usar el resultado?", "Candidatura, coordinación, comunicación, estrategia territorial.", "text", 2),
      ("¿Qué intentaste antes y por qué no alcanzó?", None, "text", 2),
    ]},
    {"h": "La pregunta", "rows": [
      ("¿Qué necesitas entender?", "Marca todas las que apliquen.", "opts", [
        "Qué acerca y qué aleja a la gente del actor",
        "Qué temas mueven la conversación en el territorio",
        "Cómo cambia la lectura por región o por segmento",
        "Cómo se compara el actor con sus contrincantes",
        "Cómo se recibe una iniciativa o una decisión de gobierno",
        "Cómo se leyó un momento: debate, informe, crisis"]),
      ("La pregunta, en una frase", "Ejemplo: ¿qué acerca y qué aleja a los votantes jóvenes del candidato en la capital?", "text", 2),
      ("¿Qué crees que está pasando?", "Tus hipótesis. Las medimos una por una; no las damos por buenas.", "text", 3),
    ]},
    {"h": "El alcance", "rows": [
      ("Contrincantes y otros actores a comparar", "Personas, partidos o figuras. Hasta cuatro.", "text", 2),
      ("Regiones o municipios prioritarios", None, "text", 2),
      ("Periodo", None, "opts", ["Últimos 3 meses", "Últimos 6 meses", "Últimos 12 meses", "Otro (escríbelo abajo)"]),
      ("Momentos clave dentro del periodo", "Debates, informes, anuncios, crisis, eventos.", "text", 2),
      ("Nombres que se confunden con el actor", "Homónimos, apodos, cuentas que no son oficiales.", "text", 2),
      ("Temas que deben quedar fuera", None, "text", 2),
    ]},
    {"h": "Lo que ya tienes", "rows": [
      ("Encuestas propias", "Casa encuestadora, fechas y temas. Sirven para validar lo que la conversación muestra.", "text", 2),
      ("Monitoreo o estudios previos", None, "text", 2),
      ("Cuentas oficiales del actor", None, "text", 2),
    ]},
    {"h": "La entrega", "rows": [
      ("Formato", "Marca todas las que necesites.", "opts", ["Presentación en vivo", "Documento PDF", "PPTX editable"]),
      ("¿Quién va a estar en la presentación?", None, "opts", [
        "Candidatura o titular", "Coordinación de campaña", "Comunicación", "Estrategia territorial", "Otro"]),
      ("Nivel de confidencialidad", None, "opts", ["Solo el equipo núcleo", "Equipo ampliado", "Se puede compartir"]),
    ]},
    LIMITS_POL,
    {"h": "Lo completa Noisia", "internal": True,
     "intro": "Después del workshop. Es lo que necesita el equipo para arrancar sin volver a preguntar.",
     "rows": [
      ("Metodología y marco", "Si el tema se mueve rápido, se lee con un marco de volatilidad e incertidumbre explicado en su propia slide.", "text", 2),
      ("Pregunta de investigación final", None, "text", 2),
      ("Universo y cortes", "Una búsqueda por actor; cada contrincante con su propio universo.", "text", 2),
      ("Fecha completamente cerrada del periodo", None, "text", 1),
      ("Ruido esperado", "Homónimos, conversación de otros territorios, cuentas automatizadas.", "text", 2),
      ("Terminología del entregable", "Contrincantes, sugerencias de mensaje, en vivo.", "text", 1),
      ("Responsable y fecha de entrega", None, "text", 1),
    ]},
  ]},

"reporte-politico": {
  "title": "Brief · Reporte político",
  "subtitle": "Para el monitoreo continuo de una campaña, una gestión o un tema público. La frecuencia sube conforme se acerca la fecha clave.",
  "how": HOW,
  "sections": [
    GENERAL_POL,
    {"h": "Qué quieres seguir", "rows": [
      ("Tipo de seguimiento", "Marca uno.", "opts", [
        "Campaña electoral", "Gestión de gobierno", "Una iniciativa o tema público", "Una crisis en curso"]),
      ("¿Qué quieres saber cada periodo?", "Las preguntas que el reporte tiene que contestar siempre.", "text", 3),
      ("¿Qué decisiones toma tu equipo con esta lectura?", None, "text", 2),
    ]},
    {"h": "Qué se escucha", "rows": [
      ("Actor y cuentas oficiales", None, "text", 2),
      ("Contrincantes y otros actores", "Con sus cuentas oficiales. Hasta cuatro.", "text", 3),
      ("Temas de agenda a seguir", "Seguridad, economía, servicios, obras, lo que esté en juego.", "text", 2),
      ("Regiones o municipios prioritarios", None, "text", 2),
      ("Temas sensibles que hay que vigilar", "Lo que, si aparece, quieres saber antes que nadie.", "text", 2),
      ("Nombres que se confunden con el actor", None, "text", 1),
    ]},
    {"h": "Cadencia y entrega", "intro": "En campaña, la frecuencia sigue al calendario: mensual hasta seis meses antes, quincenal a tres meses, semanal a dos meses y diaria el último mes.", "rows": [
      ("Cadencia inicial", "Marca una.", "opts", ["Mensual", "Quincenal", "Semanal", "Diaria, en vivo"]),
      ("¿Sigue el calendario de campaña?", None, "opts", ["Sí, que suba conforme se acerca la fecha", "No, frecuencia fija"]),
      ("Fecha de arranque", None, "text", 1),
      ("Formato", "Marca todas las que necesites.", "opts", ["PDF", "PPTX", "Executive summary", "WhatsApp", "Email", "Dashboard en vivo"]),
      ("Quién recibe las alertas, por qué canal y en qué horario", None, "text", 2),
    ]},
    {"h": "Lo que ya tienes", "rows": [
      ("Encuestas propias", "Casa encuestadora, fechas y temas.", "text", 2),
      ("Monitoreo actual", "Herramienta, agencia o equipo interno, y qué le falta.", "text", 2),
    ]},
    LIMITS_POL,
    {"h": "Lo completa Noisia", "internal": True,
     "intro": "Después del workshop. Es lo que necesita el equipo para arrancar sin volver a preguntar.",
     "rows": [
      ("Factores y búsquedas", "Una búsqueda por actor; cada contrincante con su propio universo.", "text", 3),
      ("Calendario de cadencia", "Fechas en que cambia la frecuencia.", "text", 2),
      ("Periodo base", "El primer mes construye la línea base.", "text", 1),
      ("Ruido esperado", "Homónimos, conversación de otros territorios, cuentas automatizadas.", "text", 2),
      ("Protocolo de alertas", "Qué dispara una alerta y a quién le llega.", "text", 2),
      ("Responsable y fecha de la primera entrega", None, "text", 1),
    ]},
  ]},
}

if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for k, b in BRIEFS.items():
        h = build(b)
        assert "—" not in h, k
        open(os.path.join(out, f"{k}.html"), "w").write(h)
        print(k, len(h))
