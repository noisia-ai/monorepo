const STOPWORDS = new Set([
  "para", "pero", "como", "con", "que", "por", "una", "uno", "los", "las", "del", "este", "esta",
  "esto", "muy", "mas", "menos", "porque", "cuando", "todo", "toda", "todos", "todas", "solo", "bien",
  "mal", "sin", "hay", "son", "soy", "fue", "ser", "mis", "sus", "me", "mi", "ya", "no", "si",
  "tambien", "marca", "producto", "personas", "gente", "hacer", "dice", "dicen", "video", "comentario",
  "hasta", "siempre", "ellos", "ellas", "estan", "estas", "estos", "tiene", "tienen", "tener",
  "sera", "seria", "puede", "pueden", "donde", "quien", "ahora", "aqui", "alla", "algo", "cada",
  "mismo", "misma", "mismos", "mismas", "otro", "otra", "otros", "otras"
]);

const NON_ACTIONABLE_TERMS = new Set([
  "amen", "dios", "jesus", "gracias", "felicidades", "bendiciones", "saludos",
  "link", "links", "http", "https", "www", "click", "clic", "viral",
  "futbol", "partido", "gol", "equipo", "botana",
  "puto", "puta", "pendejo", "pendeja", "verga", "chingar",
  "pinche", "hasta", "siempre", "ellos", "ellas", "estan", "esta", "estas", "este", "estos",
  "manejar", "velocidad", "mejor", "nada", "tiene", "tienen", "tener",
  "morena", "amlo", "claudia", "elecciones", "diputado", "senador"
]);

const RAW_SIGNAL_KEYWORDS = new Set([
  "accidente", "accidentes", "aclarar", "actuan", "alcanzó", "alcanzo", "antojo", "aseguradora",
  "aseguradoras", "auto", "autos", "choque", "choques", "danos", "daños", "dano", "daño",
  "directo", "excelente", "gobernador", "groseras", "manicomio", "padrino", "particulares",
  "potosi", "potosí", "qualitas", "quálitas", "responsable", "saber", "sabritas", "seguro",
  "seguros", "situacion", "situación", "vehiculo", "vehículo", "vehiculos", "vehículos", "vieja"
]);

export const RAW_SIGNAL_OUTPUT_TERMS = RAW_SIGNAL_KEYWORDS;

export function normalizeSignalPhrase(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isRawKeywordSignalPhrase(value: string) {
  const normalized = normalizeSignalPhrase(value);
  if (!normalized) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 1) return true;
  if (words.every((word) => RAW_SIGNAL_KEYWORDS.has(word) || STOPWORDS.has(word) || NON_ACTIONABLE_TERMS.has(word))) {
    return true;
  }
  const rawWordCount = words.filter((word) => RAW_SIGNAL_KEYWORDS.has(word)).length;
  if (words.length <= 3 && rawWordCount >= Math.max(1, words.length - 1)) return true;
  return [
    /^friccion\s+/,
    /^oportunidad\s+/,
    /^territorio\s+/,
    /^(alcanzo|alcanz[oó]) aseguradora/,
    /^actuan aseguradoras/,
    /^aclarar situacion/,
    /^directo manicomio$/
  ].some((pattern) => pattern.test(normalized));
}

export function isActionableSignalPulseTerm(term: string) {
  const normalized = normalizeSignalPhrase(term);
  if (!normalized || normalized.length < 4 || /^\d+$/.test(normalized)) return false;
  if (NON_ACTIONABLE_TERMS.has(normalized)) return false;
  if (normalized.includes("http") || normalized.includes("www")) return false;
  return true;
}
