import { Button } from "@/components/ui/Button";
import { CasosFilter } from "@/components/marketing/CasosFilter";
import { useCases } from "@/content/site";

export const metadata = {
  title: "Casos de uso",
  description: "Diez preguntas de negocio que Noisia puede responder con inteligencia social."
};

const heroCases = [
  {
    timing: "2-4 sem",
    title: "Crisis",
    summary: "Decodificar qué sostiene la crisis antes de responder por volumen."
  },
  {
    timing: "4-8 sem",
    title: "Defensa competitiva",
    summary: "Entender por qué migran al competidor y dónde se quiebra la lealtad."
  },
  {
    timing: "6-10 sem",
    title: "Nuevo mercado",
    summary: "Reconstruir el código local antes de entrar con una hipótesis importada."
  }
];

const decisionArchetypes = [
  {
    label: "Lanzar con permiso",
    title: "Cuando el riesgo no es salir tarde, sino salir con un territorio que la categoría no te concede.",
    text: "Aquí importan los códigos culturales, la tensión activa y el ángulo que la conversación ya acepta como legítimo. No es creatividad primero. Es permiso primero.",
    methods: "Cultural Codes + Triggers & Barriers",
    route: "/casos-de-uso/lanzamiento-de-campana"
  },
  {
    label: "Defender o reparar",
    title: "Cuando la fuga ya empezó y necesitas entender qué rompe la confianza antes de reaccionar por volumen.",
    text: "Estos casos suelen exigir leer fricción, migración o crisis estructural. La pregunta correcta no es quién gritó más, sino qué narrativa se volvió creíble y por qué.",
    methods: "Journey Friction + Influence Architecture",
    route: "/casos-de-uso/defensa-competitiva"
  },
  {
    label: "Mover la categoría",
    title: "Cuando necesitas entrar a un mercado, reposicionar la marca o detectar una tendencia antes de que se vuelva obvia.",
    text: "Aquí la conversación no se usa para medir awareness. Se usa para reconstruir el sistema simbólico local y detectar qué se está moviendo antes de que aparezca en dashboards.",
    methods: "Cultural Codes + Influence Architecture",
    route: "/casos-de-uso/entrada-a-nuevo-mercado"
  },
  {
    label: "Encontrar oportunidad",
    title: "Cuando el problema no es de comunicación, sino de producto, valor o jobs que siguen mal resueltos.",
    text: "Estos casos sirven para separar deseo declarado de oportunidad real. No buscan ideas sueltas: buscan qué decisión de portafolio, roadmap o propuesta de valor sí resiste evidencia.",
    methods: "Triggers & Barriers + Value Perception Matrix",
    route: "/casos-de-uso/desarrollo-de-producto"
  }
];

export default function UseCasesPage() {
  return (
    <>
      <section className="hero-experience page-hero">
        <div className="hero-experience__inner page-hero__inner">
          <div className="hero-copy">
            <span className="eyebrow">CASOS DE USO</span>
            <h1 className="display-lg">No entramos por industria. Entramos por la decisión que tienes enfrente.</h1>
            <p className="body-lg">
              Cada caso arranca con una pregunta de negocio real. Lo que cambia no es solo el tema: cambian las
              fuentes, la combinación metodológica, la profundidad del corpus y la forma del output que termina
              defendiendo la decisión.
            </p>
            <div className="hero-actions">
              <Button href="/diagnostico" variant="primary">
                Iniciar diagnóstico
              </Button>
              <Button href="#casos-grid" variant="secondary">
                Explorar casos
              </Button>
            </div>
            <div className="hero-proof">
              <div className="glass">
                <strong>10</strong>
                <span>preguntas ya resueltas con protocolo propio</span>
              </div>
              <div className="glass">
                <strong>2-10</strong>
                <span>semanas según la urgencia y el riesgo</span>
              </div>
              <div className="glass">
                <strong>6</strong>
                <span>metodologías combinables según el tipo de decisión</span>
              </div>
            </div>
          </div>

          <aside className="page-hero-panel glass">
            <span className="chip">Preguntas ya calibradas</span>
            <h2>Esto no es un catálogo. Es un mapa de decisiones que ya hemos estructurado.</h2>
            <ul className="page-hero-list">
              {heroCases.map((item) => (
                <li key={item.title}>
                  <b>{item.title}</b>
                  <span>{item.summary}</span>
                  <small>{item.timing}</small>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <div className="section-heading">
            <span className="eyebrow">PRIMERO, UBICA EL TIPO DE DECISIÓN</span>
            <h2 className="display-md">Antes de filtrar por caso, ubica qué clase de problema tienes enfrente.</h2>
            <p className="body-lg">
              Los casos no cambian solo por industria. Cambian por la estructura de la decisión: lanzar, defender,
              reinscribir la categoría o encontrar una oportunidad todavía mal resuelta.
            </p>
          </div>

          <div className="decision-archetype-grid">
            {decisionArchetypes.map((item) => (
              <a className="decision-archetype-card glass" href={item.route} key={item.title}>
                <span className="chip">{item.label}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <div className="decision-archetype-card__meta">
                  <span>{item.methods}</span>
                  <b>
                    Ver lectura <span>→</span>
                  </b>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--compact">
        <div className="section__inner">
          <div className="section-heading">
            <span className="eyebrow">DESPUÉS, COMPARA LOS CASOS</span>
            <h2 className="display-md">Encuentra la pregunta que más se parece a la que estás enfrentando.</h2>
            <p className="body-lg">
              Ahora sí: filtra por tipo de decisión y por velocidad esperada. Cada tarjeta resume qué había que
              entender, qué metodología entró y qué forma tomó la respuesta.
            </p>
          </div>
          <div id="casos-grid">
            <CasosFilter useCases={useCases} />
          </div>
        </div>
      </section>
    </>
  );
}
