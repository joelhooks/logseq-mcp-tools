[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/joelhooks-logseq-mcp-tools-badge.png)](https://mseep.ai/app/joelhooks-logseq-mcp-tools)

# Logseq MCP Tools

[![smithery badge](https://smithery.ai/badge/@joelhooks/logseq-mcp-tools)](https://smithery.ai/server/@joelhooks/logseq-mcp-tools)

A Model Context Protocol (MCP) server that provides AI assistants with structured access to your Logseq knowledge graph.

## Overview

This project creates an MCP server that allows AI assistants like Claude to interact with your Logseq knowledge base. It
provides tools for:

- Retrieving a list of all pages
- Getting content from specific pages
- Generating journal summaries for flexible date ranges
- Extracting linked pages and exploring connections

## Installation

### Installing via Smithery

To install Logseq Tools for Claude Desktop automatically
via [Smithery](https://smithery.ai/server/@joelhooks/logseq-mcp-tools):

```bash
npx -y @smithery/cli install @joelhooks/logseq-mcp-tools --client claude
```

1. Clone this repository
2. Install dependencies using npm, yarn, or pnpm:

```bash
# Using npm
npm install

# Using yarn
yarn install

# Using pnpm
pnpm install
```

3. Copy the environment template and configure your Logseq token:

```bash
cp .env.template .env
# Edit .env with your Logseq authentication token
```

## Configuration

This project includes a `.env.template` file that you can copy and rename to `.env`.

You can find your Logseq auth token by:

1. Opening Logseq
2. Enabling the HTTP API in Settings > Features > Enable HTTP API
3. Setting your authentication token in Settings > Features > HTTP API Authentication Token

## Usage

### Running the MCP Server

The server can be started using:

```bash
# Using the npm script
npm start

# Or directly with tsx
npx tsx index.ts
```

### Connecting with Claude

#### Claude Desktop

Follow the [Claude MCP Quickstart guide](https://modelcontextprotocol.io/quickstart/user):

1. **Important**: Install Node.js globally via Homebrew (or whatever):

```bash
brew install node
```

2. Install the Claude desktop app
3. Open the Claude menu and select "Settings..."
4. Click on "Developer" in the left sidebar, then click "Edit Config"
5. This will open your `claude_desktop_config.json` file. Replace its contents with:

```json
{
  "mcpServers": {
    "logseq": {
      "command": "npx",
      "args": [
        "tsx",
        "/path/to/your/index.ts"
      ]
    }
  }
}
```

**IMPORTANT:** Replace `/path/to/your/index.ts` with the **exact** absolute path to your index.ts file (e.g.,
`/Users/username/Code/logseq-mcp-tools/index.ts`)

6. Save the file and restart Claude Desktop

Now you can chat with Claude and ask it to use your Logseq data:

- "Show me my recent journal entries"
- "Summarize my notes from last week"
- "Find all pages related to [topic]"

#### Claude in Cursor

Follow the [Cursor MCP documentation](https://docs.cursor.com/context/model-context-protocol):

1. Open Cursor
2. Add a new MCP service from settings
3. Enter the following command:

```
npx tsx "/path/to/index.ts"
```

4. Give your service a name like "Logseq Tools"

Now you can use Claude in Cursor with your Logseq data.

#### Claude in Anthropic API (generic)

When using the Claude API or CLI tools, you can add the MCP service with:

```
claude mcp add "logseq" npx tsx "/path/to/index.ts"
```

### Jetbrains Junie Setup

To run this project with JetBrains Junie, follow these steps:

Build the Docker image:

```bash
docker build -t logseq-mcp .
# run in project root
```

Then add the following config to your Junie MCP configuration:

```
    "logseq": {
      "command": "c:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
      "args": [
        "run",
        "-i",
        "--rm",
        "--network=host",
        "-e",
        "LOGSEQ_TOKEN=<Your Token>",
        "-e",
        "LOGSEQ_HOST=host.docker.internal",
        "logseq-mcp"
      ]
    }
```


## Available Tools

### getAllPages

Retrieves a list of all pages in your Logseq graph.

### getPage

Gets the content of a specific page.

Parameters:

- `pageName`: The name of the page to retrieve

### getJournalSummary

Generates a summary of journal entries for a specified date range.

Parameters:

- `dateRange`: Natural language date range like "today", "this week", "last month", "this year", etc.

This tool will:

- Collect journal entries in the specified range
- Format them in a readable way
- Extract and analyze referenced pages/concepts
- Show the most frequently referenced concepts

### createPage

Creates a new page in your Logseq graph.

Parameters:

- `pageName`: Name for the new page
- `content`: (Optional) Initial content for the page

### searchPages

Searches for pages by name.

Parameters:

- `query`: Search query to filter pages by name

### getBacklinks

Finds all pages that reference a specific page.

Parameters:

- `pageName`: The page name for which to find backlinks

### analyzeGraph

Performs a comprehensive analysis of your knowledge graph.

Parameters:

- `daysThreshold`: (Optional) Number of days to look back for "recent" content (default: 30)

Features:

- Identifies frequently referenced pages
- Tracks recent updates
- Discovers page clusters and connections
- Lists outstanding tasks
- Suggests potential updates needed

### findKnowledgeGaps

Analyzes your knowledge graph to identify potential gaps and areas for improvement.

Parameters:

- `minReferenceCount`: (Optional) Minimum references to consider (default: 3)
- `includeOrphans`: (Optional) Include orphaned pages in analysis (default: true)

Features:

- Identifies missing pages that are frequently referenced
- Finds underdeveloped pages that need expansion
- Lists orphaned pages with no incoming links
- Provides summary statistics

### analyzeJournalPatterns

Analyzes patterns in your journal entries over time.

Parameters:

- `timeframe`: (Optional) Time period to analyze (e.g., "last 30 days", "this year")
- `includeMood`: (Optional) Analyze mood patterns if present (default: true)
- `includeTopics`: (Optional) Analyze topic patterns (default: true)

Features:

- Topic trends and evolution
- Mood pattern analysis
- Habit tracking statistics
- Project progress tracking

### smartQuery

Executes natural language queries using Logseq's DataScript capabilities.

Parameters:

- `request`: Natural language description of what you want to find
- `includeQuery`: (Optional) Include the generated Datalog query in results
- `advanced`: (Optional) Use advanced analysis features

Features:

- Page connections and relationships
- Content clustering
- Task progress analysis
- Concept evolution tracking

### suggestConnections

Uses AI to analyze your graph and suggest interesting connections.

Parameters:

- `minConfidence`: (Optional) Minimum confidence score for suggestions (0-1, default: 0.6)
- `maxSuggestions`: (Optional) Maximum number of suggestions to return (default: 10)
- `focusArea`: (Optional) Topic or area to focus suggestions around

Features:

- Discovers potential connections between pages
- Identifies knowledge synthesis opportunities
- Suggests exploration paths based on recent interests
- Provides confidence scores for suggestions

## Development

The server is built using:

- Model Context Protocol TypeScript SDK
- Zod for parameter validation
- Logseq HTTP API for data access

To extend with new tools, add additional `server.tool()` definitions in `index.ts`.

## Troubleshooting

### Common Issues

#### Node.js Version Managers (fnm, nvm, etc.)

If you're using a Node.js version manager like fnm or nvm, Claude Desktop won't be able to access the Node.js binaries
properly, as it runs outside of your shell environment where the PATH is modified.

**Solution**: Install a system-wide Node.js with Homebrew:

```bash
brew install node
```

This ensures Node.js is available to all applications, including Claude Desktop.

#### Basic Troubleshooting Steps

- Ensure Logseq is running with the HTTP API enabled
- Verify your auth token in `.env` matches the one set in Logseq
- Check that the path to your index.ts file is correct in the Claude configuration
- Try running `npx tsx index.ts` directly in your terminal to verify it works

#### Viewing Logs in Claude Desktop

Monitor logs in real-time:

```bash
# macOS
tail -n 20 -F ~/Library/Logs/Claude/mcp*.log
```

For more detailed debugging information, refer to
the [official MCP debugging documentation](https://modelcontextprotocol.io/docs/tools/debugging).
