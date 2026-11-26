# ValorAI MCP

Valor AI for VA disability benefits. Ask general questions about VA claims and get answers from Valor's reviewed knowledge base with official VA.gov sources. Getting out soon? Get a Benefits Delivery at Discharge (BDD) prep checklist and see where you are in the 180 to 90 day window. Have ratings already? Combine them with the official VA math, bilateral factor included, step by step. The public endpoint offers read-only tools with no sign-in. Use general questions and numeric examples; do not submit personal or medical records. General education only, not legal advice or a VA decision.

This repository distributes the MCP client configuration, Cursor plugin manifest, and registry metadata. The hosted server implementation is maintained separately. Installing this repository connects your MCP client to `tryvalor.ai`; it does not run a local benefits server.

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

All three tools are advertised by the public server as read-only and need no account or sign-in. These configuration files contain no API keys, cookies, or authorization headers. Your MCP client sends tool arguments to the hosted endpoint over HTTPS, so keep inputs general and exclude names, SSNs, claim identifiers, and records.

Server-side logging, retention, abuse controls, and rate-limit enforcement cannot be audited from these manifests. Review the [Privacy Policy](https://www.tryvalor.ai/privacy) and [Terms of Service](https://www.tryvalor.ai/terms) for the hosted service. A successful smoke check verifies protocol operation at that moment; it does not establish retention guarantees or medical/legal correctness.

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

## Verification

Node.js 20 or later is sufficient; there are no package dependencies to install.

```sh
npm run check
npm test
```

The offline checks verify that endpoint URLs and versions agree across manifests, referenced assets exist, and the README lists the public tools. These are repository consistency checks, not a full replacement for the MCP Registry's schema validator. Protocol tests use a local fixture server and cover JSON/SSE framing, initialization, session/version headers, notifications, pagination, cleanup, timeouts, HTTP errors, tool errors, and a synthetic rating fixture. Pull requests and main-branch pushes run these checks on Node 20 and 22 without contacting the hosted endpoint.

To check the live service explicitly:

```sh
npm run smoke
```

This sends initialization, the initialized notification, and a paginated tools listing, then makes one call to each documented tool using fixed synthetic inputs: a general BDD question, 120 days until separation, and ratings of 50 and 30. The rating fixture must return a whole-person value of 65 and payable rating of 70. No personal data or credentials are sent. Each request has a 15-second total deadline and a 1 MiB response limit; tool listing is capped at 10 pages. The client preserves a negotiated session if supplied and requests cleanup afterward. It checks the endpoint's supported 2025 Streamable HTTP protocol versions; it is not a general MCP client or a full conformance suite.

The GitHub Actions **Verify connector** workflow also exposes an optional `live` checkbox for a manually requested run. Normal CI never calls the public service. Live failures can indicate an unavailable endpoint, rate limiting, a protocol change, or a tool regression; the command exits nonzero and reports the failed operation without retrying or load testing.

Protocol references: [MCP 2025-11-25 Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), and [Cursor plugin reference](https://cursor.com/docs/reference/plugins).

## Links

- Website: https://www.tryvalor.ai
- Privacy Policy: https://www.tryvalor.ai/privacy
- Terms of Service: https://www.tryvalor.ai/terms

Valor AI is independent from the U.S. Department of Veterans Affairs. General education only, not legal advice or a VA decision.
