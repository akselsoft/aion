AION is an orchestration framework that is based around three core processes:

1. Collect
2. Analyze/Interpret
3. Respond

Despite the name and the default implementations, AION does not necessarily require popular artificial intelligence LLMs. The phases are built around clear separation of purposes. Each phase creates output that can be read in plain text at its completion as well as a structured format explaining its purpose.

The Collection phase downloads, converts and reads information from various sources and puts them into a common format, whether it be markdown (text) or CSV/spreadsheet formats for easier review.

The Analyze/Interpret phase takes the information from the Collection phase and does specific actions on it. It creates outputs that summarize information.

The Respond phase takes the information from the previous phase and acts on them. The most obvious “act” would be to simply generate new markdown or text formats of the information but it may also email, present or initiate other actions.

These processes are defined by a configuration file that specifies the order and any additional attributes related to an individual phase. The configuration file has a standard format. The tool that reads and executes the content may be written in any tool.

This may be easier to understand by walking through an example using some simple engines or implementations for each phase.

Imagine a folder structure that contains different files. You have a folder for meetings, budgets and code.  You also use a Task-based system like Azure DevOps.

A Collector would itemize the files in the folders , also identifying the purpose for each folder using a configuration like this:

Meeting folder: Purpose: Track conversations with dates and multiple people
Budgets: Purpose: Track money,
Code: Purpose: A list of all code used to perform a given task.

A “convert” collector may also go through files in given folders and if they are binary files, such as Word or Excel documents, it converts them to textual formats (such as columnar CSV or plain markdown).

A “DevOps” collector would return all of the user story or feature work items related to a given Project. This would include the Activity, Area Phase and Iterations.

A “Wiki” collector would return all articles in an online Wiki article.

A configuration file for these collectors might look like this:

```
{
  "persona": "becca",
  "free": true,
  "params": {
    "rootDir": "./",
    "collectors": [
      {
        "engine": "./implementations/becca/bootstrapCollector.js",
        "codeType": "js",
        "seedDir": "./Project",
        "createPolicy": "fill-missing",
        "dryRun": false
      }
    ],
    "interpreters": [
      {"engine":"tokenTrimmer"},
        
      {
        "engine": "chatgpt",
        "codeType": "js",
        "inputType": "artifact",
        "replace": true,
        "outputType": "ChatGPTSummary",
        "prompt": "Review the provided project materials. If details are insufficient, clearly list missing elements and propose the next 3 actions. Acknowledge if scaffolding/HELPER files were created.",
        "emitSuggestions": true,
        "suggestionScope": "both",
        "suggestionCount": 12,
        "applySuggestions": "write-file",
        "seedDir": "./Project"
      }
    ],
    "responders": [
      { "engine": "default", "codeType": "js", "outputType": "file", "filename": "Summary.md" }
    ]
  }
}

```

Note that the “engine” attribute instructs the AION tool how to retrieve this information.  

The Analysis/Interpretation phase has only two different configuration files.

A spreadsheet engine that looks at any spreadsheet or CSV file include in the Collection phase and groups the output based on columns noted in the configuration. This sample configuration looks specifically at columns named Category ( that might be found in a Budget), Area (possibly in a DevOps file) and Date (found in multiple entries). So given the output from collections, it might create output like

```
{type: Budget,content:[ 
{Subscription Costs: 10 Items, $1000},
{Hiring: 5 items, $25,000}
]}
{type: Areas, content: [
{UX: 10 items,
Internals: 5 items,
External integration: 2 items
]}
```

LLM which has a prompt collection that says

```
[
{type: budget, prompt: “Break down"}
]
```

The engines run in sequential fashion so the output from the previous phase (the analyzes the spreadsheet) would pass its output to the LLM. The output from the LLM would add to the “passed files” like

```
{type: LLM Summary, content: xxxxx}
{type: LLM Analysis, content: yyyy}
```

The configuration file then has the Responder phase which contains

Document Markdown Output
Presentation

Note that the engine attributes specify an output file or output folder.

The Document Markdown output would take the output from the LLM Summary and generate a document using a specific format.

The Presentation would take the summary and analysis and build a Powerpoint presentation that could be used by others.

The above represents a sample workflow tool based on the AION framework concepts of Collect, Analyze and Respond. The implementation included with the AION codebase shows a tool that implements the framework using Node and therefore engines written in JavaScript or Typescript.

Further examples might be:

An “artifacts” collector that works similar to the above but uses a “Helper.md” file or extra item to generate better descriptions of files in the folder so they don’t need to be specified in the configuration file. In this case, it would only need to have a “starting” directory.

Another collector engine might actually READ the contents of the file and assume that the very first paragraph would explain its content, matching key words in that paragraph to specific types (costs-> budget, items -> to do, minutes-> meeting, etc).

---

### Implementation

The initial Node based implementation is called

```
node runner.js ./folder/config.json
```

### Watcher (auto-run configs on change)

Use `AION_Watcher.js` to automatically rerun AION configurations when source files change. This is useful for working on iterative content analysis where configs need to re-execute as inputs are modified.

**Single config mode (for monitoring one folder-config pair)**
```bash
node AION_Watcher.js <watchDir> <configPath> [options]
```

Example with parameters:
```bash
node AION_Watcher.js ./project project/config.json --interval=5000 --debounce=1500
```

**Map mode (recommended for multiple independent projects/domains)**

When monitoring multiple separate directories, each with its own config file, use a watch-map JSON file to define the folder-to-config mappings.

1. Create a watch-map file (e.g., `workspace/watch-map.json`):
```json
[
  { "folder": "project-a", "config": "project-a/config.json" },
  { "folder": "project-b", "config": "project-b/config.json" },
  { "folder": "project-c", "config": "project-c/config.json" },
  { "folder": "research/papers", "config": "research/papers-config.json" }
]
```

Field descriptions:
- `folder`: Directory to monitor for changes (relative to the directory containing the watch-map file, or use absolute paths).
- `config`: AION config file to execute when this folder changes (relative to the map file directory, or use absolute paths).

2. Start the watcher with the map file:
```bash
node AION_Watcher.js <rootDir> <watchMapPath> [options]
```

Example:
```bash
node AION_Watcher.js . workspace/watch-map.json --interval=3000 --debounce=1000
```

**Parameters**

- `--interval` (default: 2000ms)  
  How often to scan folders for changes. Smaller values = more responsive but higher CPU usage.

- `--debounce` (default: 750ms)  
  Time to wait after detecting a change before triggering a config run. Prevents rapid re-triggering if multiple files change in quick succession.

**Watch-map Walkthrough**

Given this watch-map structure:
```json
[
  { "folder": "Daily", "config": "Daily/watch-map.json" },
  { "folder": "Book-analysis", "config": "Book-analysis/config.json" },
  { "folder": "project", "config": "project/config.json" }
]
```

and you run:
```bash
node AION_Watcher.js . watch-map.json --interval=3000 --debounce=1000
```

**What happens:**

1. Watcher monitors three folders: `Daily/`, `Book-analysis/`, and `project/`
2. Each folder is tracked independently with its own hash of file contents
3. When a file in `Daily/` changes → runs `Daily/watch-map.json`
4. When a file in `Book-analysis/` changes → runs `Book-analysis/config.json`
5. When a file in `project/` changes → runs `project/config.json`
6. Changes are debounced by 1 second, so if 5 files change in 500ms, only one run is triggered
7. Scans for new changes every 3 seconds

**Behavior Notes**

- Each mapped folder's state is hashed independently; only its matching config executes when that folder changes
- Runs are queued and processed sequentially to prevent race conditions or redundant API calls
- Default ignored patterns: `node_modules`, `.git`, `.DS_Store`, `tmp`, `dist`, `outputs`, `history`
- The watcher continues running until manually stopped (Ctrl+C)
- Each run logs timestamp, folder detected, and config being executed

---

## Engines

AION supports a wide range of built-in and custom engines for collection, analysis, and response workflows. Engines are referenced in config files by name and run in the order specified.

### Core LLM Engines (`core/engines/`)

These engines send content to various LLM providers for analysis and synthesis.

| Engine | Provider | Model (default) | Notes |
|--------|----------|-----------------|-------|
| `chatgpt` | OpenAI | gpt-4 | Industry standard; requires OPENAI_API_KEY |
| `claude` | Anthropic | claude-3-5-sonnet-20241022 | Strong reasoning; requires ANTHROPIC_API_KEY |
| `grok` | xAI | grok-beta | OpenAI-compatible; requires GROK_API_KEY |
| `groq` | Groq | mixtral-8x7b-32768 | Ultra-fast inference; requires GROQ_API_KEY |
| `perplexity` | Perplexity | llama-3.1-70b-instruct | OpenAI-compatible; requires PERPLEXITY_API_KEY |
| `cohere` | Cohere | command-r-plus | Specialized for production workloads; requires COHERE_API_KEY |
| `mistral` | Mistral | mistral-large-latest | Open-source friendly; requires MISTRAL_API_KEY |
| `ollama` | Local (Ollama) | mistral | Runs locally on http://localhost:11434; no API key needed |
| `huggingface` | Hugging Face | mistralai/Mistral-7B-Instruct-v0.1 | Inference API for HF models; requires HUGGINGFACE_API_KEY |

**Common LLM Engine Config Properties:**
```json
{
  "engine": "chatgpt",
  "model": "gpt-4",
  "temperature": 0.3,
  "maxTokens": 4096,
  "tokenLimit": 12000,
  "inputType": "artifact",
  "outputType": "ChatGPT",
  "writeInput": true,
  "writeOutputs": true,
  "prompt": "Your analysis prompt here"
}
```

For the `ollama` wrapper, `tokenLimit` (or `tokenlimit`) can be used to split oversized inputs before the request is sent. AION estimates the prompt size after `inputType` and `inputFileTypes` filtering. If the total is above the limit and there are multiple matching `passedFiles` entries, it sends one Ollama request per matching entry, preserving that entry's prompt, then concatenates the responses with separators. Splitting only happens at the `passedFiles` entry boundary; a single oversized entry is still sent as one call.

### Common Free/Built-in Data Engines

`sql.collector`

- Purpose: run a SQL query and add the JSON result directly into `ctx.passedFiles`.
- Config:

```json
{
  "engine": "sql.collector",
  "codeType": "js",
  "name": "orders",
  "client": "postgres",
  "connection": {
    "host": "localhost",
    "port": 5432,
    "user": "app",
    "password": "secret",
    "database": "sales"
  },
  "query": "select id, status, total from orders where status = 'open'",
  "outputType": "orders-json"
}
```

- Output shape in `passedFiles`: one JSON document with `{ rows: [...], rowCount: N }`.
- Supported clients: `postgres`, `mssql`, `mysql`, `sqlite`.
- Driver note: database drivers are loaded optionally at runtime. Install the matching package before use:
  `pg`, `mssql`, `mysql2`, `better-sqlite3` or `sqlite3`.

`json-evaluator`

- Purpose: evaluate JSON data already present in `passedFiles`, then emit a new JSON result bundle under `outputType`.
- Config:

```json
{
  "engine": "json-evaluator",
  "codeType": "js",
  "inputType": "orders-json",
  "outputType": "open-order-count",
  "action": "count",
  "filters": [
    { "attribute": "status", "operator": "=", "value": "open" }
  ]
}
```

- Supported actions: `count`, `sum`, `avg`, `min`, `max`, `distinct`, `pluck`.
- `field` is required for all actions except `count`.
- `group` accepts one or more attributes and returns grouped results.
- `groupFilter` applies after grouping against the grouped output rows.
- Result behavior:
  if the result is a single scalar, `result` is that scalar;
  if grouped output has one row, `result` is that row object;
  if multiple grouped rows exist, `result` is an array.

### Core Utility Engines (`core/engines/`)

| Engine | Purpose |
|--------|---------|
| `tokenTrimmer` | Reduces token count by removing or summarizing content; respects configured thresholds |
| `stopWordReducer` | Removes common stop words to reduce file size; useful for pre-processing |
| `llmsummarizer` | Generic summarization using configured LLM |
| `heatmap` | Analyzes frequency and importance of terms across documents |

### Built-in Engines (`lib/impl/builtin/`)

Engines that ship with AION for data collection, transformation, and output.

**Collectors & Processors:**
| Engine | Purpose |
|--------|---------|
| `documents.collector.js` | Discovers and collects documents from folders per config |
| `extract-blocks.js` | Extracts specific blocks (e.g., code, quotes) from markdown or text |
| `archive.js` | Archives processed outputs to timestamped backups |

**Transformers:**
| Engine | Purpose |
|--------|---------|
| `artifacts.js` | Manages artifact files and metadata; supports JSON/CSV/Markdown |
| `dumpPassed.js` | Debug utility; writes current `ctx.passedFiles` to JSON for inspection |
| `lifelog.js` | Processes personal/daily log entries into structured summaries |

**Responders & Utilities:**
| Engine | Purpose |
|--------|---------|
| `default.js` | Default responder; writes outputs to files |
| `notAuthorized.js` | Permission handler; skips execution if authorization fails |
| `heatmap.js` | (wrapper) Delegates to core heatmap engine |
| `tokenTrimmer.js` | (wrapper) Delegates to core tokenTrimmer engine |

### Implementations (Personas)

Implementations are predefined workflow packages combining custom engines, prompts, and configurations for specific domains.

**`implementations/becca/`**
- **Purpose:** Personal/daily journaling, summarization, and reflection
- **Components:** Custom collectors, diary summarization engines
- **Config:** `implementations/becca/config.json`, `implementations/becca/template.json`
- **Key Files:** `bootstrapCollector.js`, source adapters for various input types

**`implementations/deacon/`**
- **Purpose:** Code analysis and documentation
- **Components:** Custom code parsing engines, documentation generators
- **Config:** `implementations/deacon/template.json`
- **Key Files:** Custom engines in `implementations/deacon/engines/`

**`implementations/free/`**
- **Purpose:** Free/open-source reference implementation
- **Components:** Basic collectors and summarizers
- **Config:** `implementations/free/template.json`
- **Use Case:** Starting point for custom implementations

**`implementations/orion/`**
- **Purpose:** Project and organizational analysis
- **Components:** Project structure parsing, task aggregation, roadmap generation
- **Config:** `implementations/orion/template.json`
- **Key Files:** Custom engines in `implementations/orion/engines/`

### Using Engines in Configs

Engines are referenced in config files under `params.collectors`, `params.interpreters`, or `params.responders`:

```json
{
  "persona": "free",
  "params": {
    "collectors": [
      {
        "engine": "documents.collector",
        "seedDir": "./input"
      }
    ],
    "interpreters": [
      {
        "engine": "chatgpt",
        "inputType": "artifact",
        "prompt": "Summarize these documents"
      }
    ],
    "responders": [
      {
        "engine": "default",
        "outputType": "file",
        "filename": "analysis.md"
      }
    ]
  }
}
```

### Custom Engines

To create a custom engine, implement the standard interface:

```javascript
module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    // ctx.passedFiles: array of { name, type, documents: [{ filename, content }] }
    // engineCfg: configuration from the config.json
    // personaCfg: full persona configuration
    
    // Process data, modify ctx.passedFiles as needed
    ctx.passedFiles.push({
      name: 'my-result',
      type: 'custom',
      documents: [{ 
        filename: 'output.md', 
        content: 'Analysis result...' 
      }]
    });
  }
};
```

---

### Summary

AION provides an overall framework for understanding data in both a manual and AI fashion as well as demonstrating that understanding through different output mechanism. By condensing this into a basic configuration file and multiple engines, it allows for custom engines to be built to provide better collection, analysis and output.
