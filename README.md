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

---

### Summary

AION provides an overall framework for understanding data in both a manual and AI fashion as well as demonstrating that understanding through different output mechanism. By condensing this into a basic configuration file and multiple engines, it allows for custom engines to be built to provide better collection, analysis and output.
