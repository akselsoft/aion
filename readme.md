// AION: Artificial Intelligence Orchestration Network
// Example use-case for chaining LLMs:
// Step 1: Use "summarizer" to condense lengthy input into a manageable format.
// Step 2: Pass summarized content into "chatgpt" for interpretation, analysis, or transformation.

// LLM prompt behavior:
// Different LLMs (e.g., gpt-3.5, gpt-4) can behave differently with the same prompt. To account for this:
// - Allow config.promptTemplates.[engine] to define engine-specific system/user prompt overrides.
// - Prompt merging will honor `mode` ("replace" or "additive") when combining config + helper.md.
