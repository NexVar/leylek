/**
 * @leylek/prompts — Versioned Gemini prompt templates.
 *
 * Every prompt lives here, in plain TS exports, so:
 *   - Changes are visible in git diffs (jury can audit reasoning quality)
 *   - Agents import a stable name, not an ad-hoc string in their source
 *   - Versioning is explicit via filename suffix when we evolve
 */

export { CONTENT_AGENT_SYSTEM, CONTENT_AGENT_USER } from './content-agent';
export { OPTIMIZER_AGENT_SYSTEM, OPTIMIZER_AGENT_USER } from './optimizer-agent';
