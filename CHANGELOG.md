# CHANGELOG — PlusMedik V2

## Cambios aplicados

### 1. Agente conversacional LLM (OpenAI) activado para todos los contactos

**Problema:** El agente conversacional (`PLUSMEDIK_LLM_CONVERSATION=on`) nunca respondía a mensajes de texto individuales porque dependía del `agentPilot`, que requiere:
- El interruptor de base de datos `plusmedic_agent_pilot_state` (migración 25), que no se puede aplicar sin tocar Supabase.
- Una lista de teléfonos piloto (`PLUSMEDIK_TEXT_PILOT_GUARD`), que limita el alcance.

**Solución:**
- `api/kapso/webhook.ts`: El `switch` del piloto ahora lee `PLUSMEDIK_LLM_CONVERSATION` (variable de entorno local) en lugar de leer de Supabase. Se pasa `agentModel` al objeto `turns` siempre que `agentSettings` exista.
- `src/guarded-turn.ts`: Se agregó `agentModel` a la interfaz `TurnsConfig`.
- `src/turns.ts`: `producerFor()` selecciona `agentConversationalProducer` para **todos** los mensajes de texto cuando `PLUSMEDIK_LLM_CONVERSATION=on`, sin depender del piloto ni de `agentPilot`.
- `src/turns.ts`: `agentConversationalProducer()` recupera el modelo desde variables de entorno si no llegó por `deps.turns`.

### 2. Capa de recuperación determinista de datos

**Problema:** El agente respondía con texto genérico sin consultar Supabase ni BUSINESS_DATA. No cotizaba precios reales ni daba ubicaciones/horarios.

**Solución:** Nuevo archivo `src/agent/retrieval.ts` con la función `retrieveVerifiedContext()` que se ejecuta **antes** de llamar al modelo OpenAI:

- **BUSINESS_INFO** (ubicación, horarios, servicios, contacto): lee `BUSINESS_DATA` vía `answerFromBusinessData()`. Si esa función no devuelve nada, hace fallback directo a `validateBusinessData(BUSINESS_DATA)` para leer la sección que coincida con el mensaje.
- **STUDY_PRICE / STUDY_SEARCH / QUOTE**: busca en el catálogo de Supabase vía `loadActiveCatalog()` + `searchCatalog()`, devolviendo estudios con precios reales de `price_bs`.

El contexto verificado se inyecta en el mensaje enviado al modelo, junto con la instrucción de no inventar datos.

### 3. Clasificación de intenciones mejorada

**`src/text-handler.ts`:**
- La regex `INFO` ahora reconoce `ubican` y `se ubican`, para que "donde se ubican" se clasifique como `INFO_REQUEST` → `BUSINESS_INFO`.

### 4. Corrección de lectura de precios desde Supabase

**`src/supabase-catalog.ts`:**
- `price_bs` ahora acepta string o número vía `z.preprocess(Number, z.number().finite())`, porque PostgREST devuelve columnas `numeric` como string (`"440.00"`). Antes Zod las rechazaba y el catálogo quedaba vacío.

### 5. Instrumentación de observabilidad

Logs estructurados en cada etapa del flujo del agente:
- `agent_webhook_config`, `agent_realdeps_config` (en `webhook.ts`)
- `agent_producer_for_entered`, `agent_producer_selection` (en `turns.ts`)
- `agent_turn_received`, `agent_model_available`, `agent_model_recovered`
- `agent_prepare_started`, `agent_prepare_completed`, `agent_prepare_skipped`
- `agent_llm_started`, `agent_llm_completed`, `agent_llm_failed`
- `agent_decision_status`, `agent_reply_produced`
- `agent_retrieval_started`, `agent_retrieval_completed`, `agent_retrieval_failed`
- `agent_fallback_triggered` (con motivo explícito)

No se registran credenciales, teléfonos completos ni texto de pacientes.

### 6. Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `api/kapso/webhook.ts` | Switch local para el agente, `agentModel` en `turns`, logs de configuración |
| `src/guarded-turn.ts` | `agentModel` en `TurnsConfig` |
| `src/turns.ts` | `agentConversationalProducer`, recuperación determinista, logging completo |
| `src/text-handler.ts` | Regex `INFO` mejora detección de ubicación |
| `src/supabase-catalog.ts` | `price_bs` acepta string/número |
| `src/conversation-state-store.ts` | Modificaciones previas (replyQualityOf) |
| `src/agent/retrieval.ts` | **NUEVO**: capa de recuperación determinista |
| `start.bat` | Script de inicio rápido para Windows |

### 7. Archivos nuevos (no commiteados, utilidades locales)

- `scripts/import-lab-tests.js`: Script para importar 100 estudios de `lab_tests` a Supabase vía REST API.
- `lab_tests_import.json`: Datos de ejemplo de 100 estudios.
- `dev-server.ts`: Servidor local para pruebas con ngrok.

### 8. Cómo activar el agente conversacional

En `.env`:
```env
PLUSMEDIK_LLM_CONVERSATION=on
PLUSMEDIK_TURNS=on
PLUSMEDIK_TEXT_HANDLER=on
OPENAI_API_KEY=tu_clave
OPENAI_CONVERSATION_MODEL=gpt-6.1-sol
OPENAI_CONVERSATION_REASONING=medium
```

No se requieren migraciones de Supabase.

### 9. Comportamiento por tipo de consulta

| Mensaje del paciente | Intención | Fuente de datos |
|---|---|---|
| "¿dónde se ubican?" | BUSINESS_INFO | BUSINESS_DATA (SUCURSALES) |
| "¿cuáles son sus horarios?" | BUSINESS_INFO | BUSINESS_DATA (HORARIOS) |
| "¿cuánto cuesta un hemograma?" | STUDY_PRICE | Supabase `lab_tests` (precio real) |
| "quiero cotizar hemograma y glucosa" | QUOTE | Supabase `lab_tests` + motor de cotización |
| "hola" | GREETING | Respuesta conversacional del LLM |
| "tengo fiebre y mareos" | MEDICAL | Modo esencial (sin orientación clínica) |
