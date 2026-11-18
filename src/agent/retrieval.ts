// Capa de recuperación determinista de datos para el agente conversacional LLM.
// El backend recupera datos verificados de Supabase y BUSINESS_DATA ANTES de llamar al modelo.
// OpenAI solo interpreta y comunica naturalmente; nunca inventa precios ni direcciones.
// La intención se obtiene ÚNICAMENTE de classifyText() (clasificador existente del proyecto),
// nunca de palabras clave propias de esta capa.

import { classifyText } from "../text-handler.js";
import { searchCatalog } from "../catalog-search.js";
import { answerFromBusinessData } from "../business-answers.js";
import type { CatalogStudy } from "../types.js";
import type { KnowledgeAnswer } from "../knowledge-answers.js";
import { BUSINESS_DATA } from "../system-prompt.js";
import { validateBusinessData, type DataSection } from "../conversation-facts.js";

export type BackendIntent =
  | "BUSINESS_INFO"
  | "STUDY_PRICE"
  | "STUDY_SEARCH"
  | "QUOTE"
  | "MEDICAL"
  | "GREETING"
  | "OTHER";

function mapClassifierIntent(classifierIntent: string): BackendIntent {
  switch (classifierIntent) {
    case "INFO_REQUEST": return "BUSINESS_INFO";
    case "RECIPE_OR_QUOTE": return "STUDY_PRICE";
    case "GREETING": return "GREETING";
    case "MEDICAL": return "MEDICAL";
    default: return "OTHER";
  }
}

export interface RetrievedStudy {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  sampleType: string | null;
  priceBs: number;
  source: "SUPABASE";
}

export interface RetrievedBusinessInfo {
  type: "LOCATION" | "HOURS" | "SERVICES" | "PHONES" | "OTHER";
  content: string;
  source: "BUSINESS_DATA";
}

export interface RetrievedContext {
  intent: BackendIntent;
  sources: Array<"SUPABASE" | "BUSINESS_DATA">;
  studies: RetrievedStudy[];
  businessInfo: RetrievedBusinessInfo[] | null;
  retrievalStatus: "FOUND" | "NOT_FOUND" | "ERROR" | "NOT_REQUIRED";
  contextText: string;
}

function formatBs(amount: number): string {
  return `Bs ${Number.isInteger(amount) ? amount : amount.toFixed(2).replace(".", ",")}`;
}

function sectionMatchesMessage(section: DataSection, message: string): boolean {
  const folded = message.toLowerCase();
  const text = section.text.toLowerCase();
  if (section.id === "SUCURSALES" && /\b(donde|dónde|ubican|ubicación|direccion|dirección|sucursal|sucursales|mapa|llegar)\b/.test(folded)) return true;
  if (section.id === "HORARIOS" && /\b(horario|horarios|abren|cierran|atencion|atención|dia|día|semana|a que hora|a qué hora)\b/.test(folded)) return true;
  if (section.id === "SERVICIOS" && /\b(servicios|áreas|hematología|bioquímica|serología|microbiología)\b/.test(folded)) return true;
  if (section.id === "TELEFONOS" && /\b(teléfono|telefono|whatsapp|contacto)\b/.test(folded)) return true;
  return false;
}

function businessInfoType(message: string): RetrievedBusinessInfo["type"] {
  const folded = message.toLowerCase();
  if (/\b(donde|dónde|ubican|ubicación|direccion|dirección|sucursal|sucursales|mapa|llegar)\b/i.test(folded)) return "LOCATION";
  if (/\b(horario|horarios|abren|cierran|atencion|atención|dia|día|semana)\b/i.test(folded)) return "HOURS";
  if (/\b(servicios|áreas|hematología|bioquímica|serología|microbiología)\b/i.test(folded)) return "SERVICES";
  if (/\b(teléfono|telefono|whatsapp|contacto)\b/i.test(folded)) return "PHONES";
  return "OTHER";
}

export async function retrieveVerifiedContext(
  message: string,
  options: {
    loadCatalog: () => Promise<readonly CatalogStudy[]>;
    answerFromBusinessData: (question: string) => Promise<KnowledgeAnswer | undefined>;
  }
): Promise<RetrievedContext> {
  const classifierIntent = classifyText(message);
  const intent = mapClassifierIntent(classifierIntent);
  const sources: Array<"SUPABASE" | "BUSINESS_DATA"> = [];
  const studies: RetrievedStudy[] = [];
  const businessInfo: RetrievedBusinessInfo[] = [];
  let retrievalStatus: RetrievedContext["retrievalStatus"] = "NOT_REQUIRED";
  const contextParts: string[] = [];

  // ── Consulta institucional (ubicación, horarios, servicios, contacto) ──
  if (intent === "BUSINESS_INFO") {
    try {
      const answer = await options.answerFromBusinessData(message);
      if (answer && answer.status !== "CLARIFY" && answer.body.trim() !== "") {
        sources.push("BUSINESS_DATA");
        retrievalStatus = "FOUND";
        businessInfo.push({ type: businessInfoType(message), content: answer.body, source: "BUSINESS_DATA" });
        contextParts.push(`Información del laboratorio:\n${answer.body}`);
      } else {
        // Fallback directo: leer BUSINESS_DATA y devolver la sección que coincida con el mensaje.
        const report = validateBusinessData(BUSINESS_DATA);
        for (const section of report.sections) {
          if (section.status === "CONFIRMED" && sectionMatchesMessage(section, message)) {
            sources.push("BUSINESS_DATA");
            retrievalStatus = "FOUND";
            businessInfo.push({ type: businessInfoType(message), content: section.text, source: "BUSINESS_DATA" });
            contextParts.push(`Información del laboratorio:\n${section.text}`);
            break;
          }
        }
      }
    } catch {
      retrievalStatus = "ERROR";
    }
  }

  // ── Consulta de precio o estudio ──
  if (intent === "STUDY_PRICE" || intent === "STUDY_SEARCH" || intent === "QUOTE") {
    try {
      const catalog = await options.loadCatalog();
      const hits = searchCatalog(message, catalog, { limit: 5, minScore: 0.6 });

      if (hits.length > 0) {
        sources.push("SUPABASE");
        if (retrievalStatus === "NOT_REQUIRED") retrievalStatus = "FOUND";

        const studyLines = hits.map((hit) => {
          const s: RetrievedStudy = {
            id: hit.study.id,
            code: hit.study.code,
            name: hit.study.name,
            category: hit.study.category,
            sampleType: hit.study.sampleType,
            priceBs: hit.study.priceBs,
            source: "SUPABASE"
          };
          studies.push(s);
          return `- ${s.name}${s.code ? ` (código ${s.code})` : ""}: ${formatBs(s.priceBs)}${s.category ? ` — ${s.category}` : ""}`;
        });

        contextParts.push(`Estudios encontrados en el catálogo del laboratorio:\n${studyLines.join("\n")}`);
      } else {
        if (retrievalStatus === "NOT_REQUIRED") retrievalStatus = "NOT_FOUND";
      }
    } catch {
      if (retrievalStatus === "NOT_REQUIRED") retrievalStatus = "ERROR";
    }
  }

  const contextText =
    contextParts.length > 0
      ? `\n\nDATOS VERIFICADOS (fuente: laboratorio):\n${contextParts.join("\n\n")}\nUsa estos datos para responder al paciente. No inventes precios ni direcciones.`
      : "";

  return {
    intent,
    sources,
    studies,
    businessInfo: businessInfo.length > 0 ? businessInfo : null,
    retrievalStatus,
    contextText
  };
}
