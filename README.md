# ValorAI MCP

Valor AI for VA disability benefits. Ask general questions about VA claims and get answers from Valor's reviewed knowledge base with official VA.gov sources. Getting out soon? Get a Benefits Delivery at Discharge (BDD) prep checklist and see where you are in the 180 to 90 day window. Have ratings already? Combine them with the official VA math, bilateral factor included, step by step. Free, read-only, and no sign-in. It never asks for or stores personal or medical records. General education only, not legal advice or a VA decision.

## Endpoint

```
https://www.tryvalor.ai/mcp/public
```

Transport: remote, streamable HTTP. No API key, no OAuth.

## Tools

| Tool | What it does |
| --- | --- |
| `ask_va_benefits_question` | Answers a general VA claims question from Valor's reviewed knowledge base, with official VA.gov sources. |
| `bdd_separation_checklist` | Returns a Benefits Delivery at Discharge (BDD) prep checklist and where you are in the 180 to 90 day window. |
| `estimate_combined_rating` | Combines disability ratings with the official VA math, bilateral factor included, step by step. |

## No sign-in, read-only

All three tools are read-only and need no account or sign-in. The connector does not ask for, read, or store personal or medical records, and it does not use cookies or authorization headers. Requests are rate limited per IP.

## Setup

### Cursor

This repo includes a Cursor plugin in `.cursor-plugin/` and an `mcp.json`. Or add this to your MCP config:

```json
{
  "mcpServers": {
    "valor-ai": {
      "url": "https://www.tryvalor.ai/mcp/public"
    }
  }
}
```

### Other MCP clients

Add a remote (streamable HTTP) MCP server with the URL `https://www.tryvalor.ai/mcp/public`.

## Links

- Website: https://www.tryvalor.ai
- Privacy Policy: https://www.tryvalor.ai/privacy
- Terms of Service: https://www.tryvalor.ai/terms

Valor AI is independent from the U.S. Department of Veterans Affairs. General education only, not legal advice or a VA decision.
