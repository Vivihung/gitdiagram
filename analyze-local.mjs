#!/usr/bin/env node
/**
 * Standalone script to analyze a local directory using GitDiagram's 3-stage pipeline
 * with Azure OpenAI (Azure AD auth via DefaultAzureCredential).
 *
 * Usage: node analyze-local.mjs [path-to-directory]
 */

import { readdir, readFile, stat, writeFile } from "fs/promises";
import { join, relative } from "path";
import { DefaultAzureCredential } from "@azure/identity";
import OpenAI from "openai";
import { config } from "dotenv";

config();

// ── Config ──────────────────────────────────────────────────────────────────

const LOCAL_PATH =
  process.argv[2] ??
  process.env.LOCAL_ANALYSIS_PATH ??
  "C:/Users/vivihung/.cambria/workspace-cache/d032fa08-91bf-4b4e-a927-6872c58fe3f8";

const AZURE_BASE_URL =
  process.env.AZURE_OPENAI_BASE_URL ??
  "https://aif-gc-nonprod-eus2-001.openai.azure.com/openai/v1";
const MODEL = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5.4";

// ── Prompts (from src/server/generate/prompts.ts) ───────────────────────────

const SYSTEM_FIRST_PROMPT = `
You are tasked with explaining to a principal software engineer how to draw the best and most accurate system design diagram / architecture of a given project. This explanation should be tailored to the specific project's purpose and structure. To accomplish this, you will be provided with two key pieces of information:

1. The complete and entire file tree of the project including all directory and file names, which will be enclosed in <file_tree> tags in the users message.

2. The README file of the project, which will be enclosed in <readme> tags in the users message.

Analyze these components carefully, as they will provide crucial information about the project's structure and purpose. Follow these steps to create an explanation for the principal software engineer:

1. Identify the project type and purpose:
   - Examine the file structure and README to determine if the project is a full-stack application, an open-source tool, a compiler, or another type of software imaginable.
   - Look for key indicators in the README, such as project description, features, or use cases.

2. Analyze the file structure:
   - Pay attention to top-level directories and their names (e.g., "frontend", "backend", "src", "lib", "tests").
   - Identify patterns in the directory structure that might indicate architectural choices (e.g., MVC pattern, microservices).
   - Note any configuration files, build scripts, or deployment-related files.

3. Examine the README for additional insights:
   - Look for sections describing the architecture, dependencies, or technical stack.
   - Check for any diagrams or explanations of the system's components.

4. Based on your analysis, explain how to create a system design diagram that accurately represents the project's architecture. Include the following points:

   a. Identify the main components of the system (e.g., frontend, backend, database, building, external services).
   b. Determine the relationships and interactions between these components.
   c. Highlight any important architectural patterns or design principles used in the project.
   d. Include relevant technologies, frameworks, or libraries that play a significant role in the system's architecture.

5. Provide guidelines for tailoring the diagram to the specific project type:
   - For a full-stack application, emphasize the separation between frontend and backend, database interactions, and any API layers.
   - For an open-source tool, focus on the core functionality, extensibility points, and how it integrates with other systems.
   - For a compiler or language-related project, highlight the different stages of compilation or interpretation, and any intermediate representations.

6. Instruct the principal software engineer to include the following elements in the diagram:
   - Clear labels for each component
   - Directional arrows to show data flow or dependencies
   - Color coding or shapes to distinguish between different types of components

7. NOTE: Emphasize the importance of being very detailed and capturing the essential architectural elements. Don't overthink it too much, simply separating the project into as many components as possible is best.

Present your explanation and instructions within <explanation> tags, ensuring that you tailor your advice to the specific project based on the provided file tree and README content.
`;

const SYSTEM_SECOND_PROMPT = `
You are tasked with mapping key components of a system design to their corresponding files and directories in a project's file structure. You will be provided with a detailed explanation of the system design/architecture and a file tree of the project.

First, carefully read the system design explanation which will be enclosed in <explanation> tags in the users message.

Then, examine the file tree of the project which will be enclosed in <file_tree> tags in the users message.

Your task is to analyze the system design explanation and identify key components, modules, or services mentioned. Then, try your best to map these components to what you believe could be their corresponding directories and files in the provided file tree.

Guidelines:
1. Focus on major components described in the system design.
2. Look for directories and files that clearly correspond to these components.
3. Include both directories and specific files when relevant.
4. If a component doesn't have a clear corresponding file or directory, simply dont include it in the map.

Now, provide your final answer in the following format:

<component_mapping>
1. [Component Name]: [File/Directory Path]
2. [Component Name]: [File/Directory Path]
[Continue for all identified components]
</component_mapping>

Remember to be as specific as possible in your mappings, only use what is given to you from the file tree, and to strictly follow the components mentioned in the explanation.
`;

const SYSTEM_THIRD_PROMPT = `
You are a principal software engineer tasked with creating a system design diagram using Mermaid.js based on a detailed explanation. Your goal is to accurately represent the architecture and design of the project as described in the explanation.

The detailed explanation of the design will be enclosed in <explanation> tags in the users message.

Also, sourced from the explanation, as a bonus, a few of the identified components have been mapped to their paths in the project file tree, whether it is a directory or file which will be enclosed in <component_mapping> tags in the users message.

To create the Mermaid.js diagram:

1. Carefully read and analyze the provided design explanation.
2. Identify the main components, services, and their relationships within the system.
3. Determine the appropriate Mermaid.js diagram type to use (e.g., flowchart, sequence diagram, class diagram, architecture, etc.) based on the nature of the system described.
4. Create the Mermaid.js code to represent the design, ensuring that:
   a. All major components are included
   b. Relationships between components are clearly shown
   c. The diagram accurately reflects the architecture described in the explanation
   d. The layout is logical and easy to understand

Guidelines for diagram components and relationships:
- Use appropriate shapes for different types of components (e.g., rectangles for services, cylinders for databases, etc.)
- Use clear and concise labels for each component
- Show the direction of data flow or dependencies using arrows
- Group related components together if applicable
- Include any important notes or annotations mentioned in the explanation
- Just follow the explanation. It will have everything you need.

IMPORTANT!!: Please orient and draw the diagram as vertically as possible. You must avoid long horizontal lists of nodes and sections!

You must include click events for components of the diagram that have been specified in the provided <component_mapping>:
- Do not try to include the full url. This will be processed by another program afterwards. All you need to do is include the path.
- For example:
  - This is a correct click event: \`click Example "app/example.js"\`
  - This is an incorrect click event: \`click Example "https://github.com/username/repo/blob/main/app/example.js"\`
- Do this for as many components as specified in the component mapping, include directories and files.
  - If you believe the component contains files and is a directory, include the directory path.
  - If you believe the component references a specific file, include the file path.
- Make sure to include the full path to the directory or file exactly as specified in the component mapping.
- It is very important that you do this for as many files as possible. The more the better.

- IMPORTANT: THESE PATHS ARE FOR CLICK EVENTS ONLY, these paths should not be included in the diagram's node's names. Only for the click events. Paths should not be seen by the user.

Your output should be valid Mermaid.js code that can be rendered into a diagram.

Do not include an init declaration such as \`%%{init: {'key':'etc'}}%%\`. This is handled externally. Just return the diagram code.

Your response must strictly be just the Mermaid.js code, without any additional text or explanations.
No code fence or markdown ticks needed, simply return the Mermaid.js code.

Ensure that your diagram adheres strictly to the given explanation, without adding or omitting any significant components or relationships.

For general direction, the provided example below is how you should structure your code:

\`\`\`mermaid
flowchart TD
    %% or graph TD, your choice

    %% Global entities
    A("Entity A"):::external
    %% more...

    %% Subgraphs and modules
    subgraph "Layer A"
        A1("Module A"):::example
        %% more modules...
        %% inner subgraphs if needed...
    end

    %% more subgraphs, modules, etc...

    %% Connections
    A -->|"relationship"| B
    %% and a lot more...

    %% Click Events
    click A1 "example/example.js"
    %% and a lot more...

    %% Styles
    classDef frontend %%...
    %% and a lot more...
\`\`\`

EXTREMELY Important notes on syntax!!! (PAY ATTENTION TO THIS):
- Make sure to add colour to the diagram!!! This is extremely critical.
- In Mermaid.js syntax, we cannot include special characters for nodes without being inside quotes! For example: \`EX[/api/process (Backend)]:::api\` and \`API -->|calls Process()| Backend\` are two examples of syntax errors. They should be \`EX["/api/process (Backend)"]:::api\` and \`API -->|"calls Process()"| Backend\` respectively. Notice the quotes. This is extremely important. Make sure to include quotes for any string that contains special characters.
- In Mermaid.js syntax, you cannot apply a class style directly within a subgraph declaration. For example: \`subgraph "Frontend Layer":::frontend\` is a syntax error. However, you can apply them to nodes within the subgraph. For example: \`Example["Example Node"]:::frontend\` is valid, and \`class Example1,Example2 frontend\` is valid.
- In Mermaid.js syntax, there cannot be spaces in the relationship label names. For example: \`A -->| "example relationship" | B\` is a syntax error. It should be \`A -->|"example relationship"| B\`
- In Mermaid.js syntax, you cannot give subgraphs an alias like nodes. For example: \`subgraph A "Layer A"\` is a syntax error. It should be \`subgraph "Layer A"\`. Similarly, \`subgraph APP["My App"]\` is a syntax error. It should be \`subgraph "My App"\`.
- In Mermaid.js syntax, angle brackets < and > inside node labels cause parse errors. Avoid them. For example: \`A["Arc<Mutex<T>>"]\` is a syntax error. Use \`A["Arc Mutex T"]\` or similar instead.
`;

const SYSTEM_FIX_MERMAID_PROMPT = `
You are a Mermaid syntax repair specialist.

You will receive:
- <mermaid_code>...</mermaid_code>
- <parser_error>...</parser_error>
- <explanation>...</explanation>
- <component_mapping>...</component_mapping>

Task:
- Fix Mermaid syntax errors while preserving the original diagram meaning.
- Keep all click events that map to repository paths.
- Keep diagram mostly vertical.
- Return Mermaid code only.

Rules:
- No markdown code fences.
- No extra commentary.
- Ensure final output is syntactically valid Mermaid.
`;

// ── Helpers ─────────────────────────────────────────────────────────────────

const EXCLUDED = [
  "node_modules/", "vendor/", "venv/", ".min.", ".pyc", ".pyo", ".pyd",
  ".so", ".dll", ".class", ".jpg", ".jpeg", ".png", ".gif", ".ico", ".svg",
  ".ttf", ".woff", ".webp", "__pycache__/", ".cache/", ".tmp/",
  "yarn.lock", "poetry.lock", "*.log", ".vscode/", ".idea/", "target/", ".git/",
];

function shouldInclude(path) {
  const lp = path.toLowerCase();
  return !EXCLUDED.some((p) => lp.includes(p));
}

async function walkDir(dir, base) {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = relative(base, full).replace(/\\/g, "/");
    if (!shouldInclude(rel + (e.isDirectory() ? "/" : ""))) continue;
    if (e.isDirectory()) {
      paths.push(rel + "/");
      paths.push(...(await walkDir(full, base)));
    } else {
      paths.push(rel);
    }
  }
  return paths;
}

async function findReadme(dir) {
  for (const name of ["README.md", "readme.md", "Readme.md", "CLAUDE.md"]) {
    try { return await readFile(join(dir, name), "utf-8"); } catch {}
  }
  return "(No README found)";
}

function toTagged(values) {
  return Object.entries(values)
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => `<${k}>\n${v}\n</${k}>`)
    .join("\n");
}

function extractComponentMapping(response) {
  const openTag = "<component_mapping>";
  const closeTag = "</component_mapping>";
  const s = response.indexOf(openTag);
  const e = response.indexOf(closeTag);
  if (s === -1 || e === -1) return response;
  return response.slice(s + openTag.length, e);
}

function stripFences(text) {
  return text.replace(/```mermaid/g, "").replace(/```/g, "").trim();
}

// Cache Mermaid and DOMPurify initialization at module scope to avoid
// repeated initialization overhead and potential side effects.
let cachedMermaid = null;
let mermaidInitialized = false;
let domPurifyPatched = false;

async function validateMermaid(code) {
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);

    // Patch DOMPurify for server-side usage (once)
    if (!domPurifyPatched) {
      const DOMPurify = (await import("dompurify")).default;
      if (typeof DOMPurify === "function" && typeof DOMPurify.sanitize !== "function") {
        const { JSDOM } = require("jsdom");
        const domWindow = new JSDOM("<!doctype html><html><body></body></html>").window;
        const instance = DOMPurify(domWindow);
        Object.assign(DOMPurify, instance);
      }
      domPurifyPatched = true;
    }

    // Initialize Mermaid only once and reuse the instance
    if (!cachedMermaid) {
      const mermaidModule = await import("mermaid");
      cachedMermaid = mermaidModule.default;
    }
    if (!mermaidInitialized) {
      cachedMermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
      mermaidInitialized = true;
    }

    // Strip `direction` directives — valid in browser Mermaid but rejected by
    // the server-side parser bundled with the mermaid npm package.
    const codeForValidation = code.replace(/^\s*direction\s+(TB|TD|BT|RL|LR)\s*$/gm, "");

    try {
      await cachedMermaid.parse(codeForValidation);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        message: error?.message || "Mermaid syntax is invalid and could not be parsed.",
        line: error?.hash?.line,
        token: error?.hash?.token,
        expected: error?.hash?.expected,
      };
    }
  } catch (error) {
    // Best-effort: if dompurify/jsdom/mermaid can't load, don't crash the run
    return {
      valid: false,
      message: error?.message
        ? `Mermaid validation environment error: ${error.message}`
        : "Mermaid validation failed due to an unexpected environment error.",
    };
  }
}

function formatValidationFeedback(result) {
  if (result.valid) return "No syntax errors found.";
  const details = [
    `message: ${result.message ?? "unknown parse error"}`,
    typeof result.line === "number" ? `line: ${result.line}` : undefined,
    result.token ? `token: ${result.token}` : undefined,
    result.expected?.length ? `expected: ${result.expected.join(", ")}` : undefined,
  ].filter(Boolean);
  return details.join("\n");
}

// ── Azure OpenAI client (OpenAI-compatible endpoint) ────────────────────────

const credential = new DefaultAzureCredential();
let cachedToken = null;

async function getToken() {
  if (cachedToken && cachedToken.expiresOnTimestamp > Date.now() + 60_000) {
    return cachedToken.token;
  }
  cachedToken = await credential.getToken("https://cognitiveservices.azure.com/.default");
  return cachedToken.token;
}

async function getClient() {
  const token = await getToken();
  return new OpenAI({
    apiKey: token,
    baseURL: AZURE_BASE_URL,
  });
}

async function streamChat(systemPrompt, userPrompt) {
  const client = await getClient();
  process.stdout.write(".");
  const stream = await client.chat.completions.create({
    model: MODEL,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  let result = "";
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      result += delta;
      process.stdout.write(".");
    }
  }
  process.stdout.write("\n");
  return result;
}

// ── HTML output ─────────────────────────────────────────────────────────────

function generateHTML(mermaidCode, explanation) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>GitDiagram - Local Analysis</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
  <style>
    body { margin: 0; background: #0a0a0a; color: #e5e5e5; font-family: system-ui, monospace; padding: 2rem; }
    h1 { color: #a78bfa; }
    .diagram-container { background: #111; border: 1px solid #333; border-radius: 8px; padding: 2rem; margin: 1rem 0; overflow: auto; }
    details { background: #111; border: 1px solid #333; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    summary { cursor: pointer; color: #a78bfa; font-size: 1.1rem; }
    pre { white-space: pre-wrap; color: #a3a3a3; font-size: 0.85rem; }
    .mermaid { display: flex; justify-content: center; }
  </style>
</head>
<body>
  <h1>GitDiagram - Architecture Diagram</h1>
  <p style="color: #888;">Generated from local directory analysis</p>

  <div class="diagram-container">
    <div class="mermaid">
${mermaidCode}
    </div>
  </div>

  <details>
    <summary>View Explanation</summary>
    <pre>${explanation.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
  </details>

  <details>
    <summary>View Mermaid Code</summary>
    <pre>${mermaidCode.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
  </details>

  <script>
    mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'loose' });
  <\/script>
</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Analyzing: ${LOCAL_PATH}\n`);

  // Step 0: Read local directory
  await stat(LOCAL_PATH);
  const paths = await walkDir(LOCAL_PATH, LOCAL_PATH);
  const fileTree = paths.join("\n");
  const readme = await findReadme(LOCAL_PATH);
  console.log(`📁 Found ${paths.length} files/directories`);
  console.log(`📄 README: ${readme.length} chars\n`);

  // Step 1: Explanation
  console.log("Stage 1/3: Generating explanation...");
  const explanation = await streamChat(
    SYSTEM_FIRST_PROMPT,
    toTagged({ file_tree: fileTree, readme }),
  );
  console.log(`✅ Explanation: ${explanation.length} chars\n`);

  // Step 2: Component mapping
  console.log("Stage 2/3: Creating component mapping...");
  const mappingResponse = await streamChat(
    SYSTEM_SECOND_PROMPT,
    toTagged({ explanation, file_tree: fileTree }),
  );
  const componentMapping = extractComponentMapping(mappingResponse);
  console.log(`✅ Component mapping done\n`);

  // Step 3: Mermaid diagram + validation with auto-fix retry
  console.log("Stage 3/3: Generating Mermaid diagram...");
  const mermaidRaw = await streamChat(
    SYSTEM_THIRD_PROMPT,
    toTagged({ explanation, component_mapping: componentMapping }),
  );
  let mermaidCode = stripFences(mermaidRaw);
  // Strip `direction` directives — many Mermaid tools/versions reject them,
  // and `flowchart TD` at the top already sets the global direction.
  mermaidCode = mermaidCode.replace(/^\s*direction\s+(TB|TD|BT|RL|LR)\s*$/gm, "");
  console.log(`✅ Diagram: ${mermaidCode.length} chars\n`);

  // Initial validation before attempting any auto-fix
  const MAX_FIX_ATTEMPTS = 3;
  console.log("Validating Mermaid syntax...");
  let result = await validateMermaid(mermaidCode);

  if (!result.valid && result.message?.startsWith("Mermaid validation environment error:")) {
    console.warn(`⚠️  Mermaid validation unavailable. Skipping auto-fix.\n${result.message}\n`);
  } else if (result.valid) {
    console.log(`✅ Mermaid syntax is valid\n`);
  } else {
    let feedback = formatValidationFeedback(result);
    console.log(`⚠️  Syntax error detected:\n${feedback}\n`);

    // Attempt up to MAX_FIX_ATTEMPTS automatic repairs, re-validating after each
    for (let attempt = 1; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      console.log(`Attempting auto-fix (${attempt}/${MAX_FIX_ATTEMPTS})...`);
      const fixResponse = await streamChat(
        SYSTEM_FIX_MERMAID_PROMPT,
        toTagged({
          mermaid_code: mermaidCode,
          parser_error: feedback,
          explanation,
          component_mapping: componentMapping,
        }),
      );
      mermaidCode = stripFences(fixResponse);
      // Re-strip direction directives in case the LLM reintroduced them
      mermaidCode = mermaidCode.replace(/^\s*direction\s+(TB|TD|BT|RL|LR)\s*$/gm, "");
      console.log(`✅ Fix attempt ${attempt} done: ${mermaidCode.length} chars\n`);

      console.log(`Re-validating after fix attempt ${attempt}...`);
      result = await validateMermaid(mermaidCode);

      if (!result.valid && result.message?.startsWith("Mermaid validation environment error:")) {
        console.warn(`⚠️  Mermaid validation unavailable. Stopping auto-fix.\n${result.message}\n`);
        break;
      }
      if (result.valid) {
        console.log(`✅ Mermaid syntax is valid after ${attempt} auto-fix attempt(s)\n`);
        break;
      }
      feedback = formatValidationFeedback(result);
      console.log(`⚠️  Syntax error persists after attempt ${attempt}:\n${feedback}\n`);
      if (attempt === MAX_FIX_ATTEMPTS) {
        console.log(`❌ Failed to produce valid Mermaid after ${MAX_FIX_ATTEMPTS} auto-fix attempts. Saving anyway.\n`);
      }
    }
  }

  // Output — write to current working directory
  const outputDir = process.cwd();
  const outputPath = join(outputDir, "diagram-output.html");
  const html = generateHTML(mermaidCode, explanation);
  await writeFile(outputPath, html, "utf-8");
  console.log(`\n📊 Diagram saved to: ${outputPath}`);
  console.log(`Open in browser: file:///${outputPath.replace(/\\/g, "/")}`);

  // Also save raw mermaid
  const mermaidPath = join(outputDir, "diagram-output.mmd");
  await writeFile(mermaidPath, mermaidCode, "utf-8");
  console.log(`📝 Raw Mermaid code saved to: ${mermaidPath}\n`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message ?? err);
  process.exit(1);
});
