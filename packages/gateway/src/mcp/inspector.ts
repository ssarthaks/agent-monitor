const MAX_RESULT_BYTES = 500 * 1024; // 500 KB limit for single tool result

export interface ResultInspection {
  modified: boolean;
  result: any;
  warning?: string;
  sizeBytes: number;
}

export class McpResultInspector {
  static inspect(result: any): ResultInspection {
    if (!result) {
      return { modified: false, result, sizeBytes: 0 };
    }

    const serialized = JSON.stringify(result);
    const sizeBytes = Buffer.byteLength(serialized, "utf8");

    // 1. Check for private key leaks in text contents
    const privateKeyRegex = /BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY/i;
    const leakDetected = privateKeyRegex.test(serialized);

    // 2. Truncate oversized results
    if (sizeBytes > MAX_RESULT_BYTES) {
      const truncatedNotice = `\n\n[WARNING: Agent Monitor truncated output because it exceeded ${MAX_RESULT_BYTES / 1024} KB limit]`;
      if (Array.isArray(result.content)) {
        const modifiedContent = result.content.map((item: any) => {
          if (
            item.type === "text" &&
            typeof item.text === "string" &&
            item.text.length > 10000
          ) {
            return {
              ...item,
              text: item.text.slice(0, 10000) + truncatedNotice,
            };
          }
          return item;
        });
        return {
          modified: true,
          result: { ...result, content: modifiedContent },
          warning: "Tool result was truncated to prevent memory exhaustion",
          sizeBytes,
        };
      } else if (Array.isArray(result.contents)) {
        // Support MCP resources/read contents format
        const modifiedContents = result.contents.map((item: any) => {
          if (typeof item.text === "string" && item.text.length > 10000) {
            return {
              ...item,
              text: item.text.slice(0, 10000) + truncatedNotice,
            };
          }
          return item;
        });
        return {
          modified: true,
          result: { ...result, contents: modifiedContents },
          warning:
            "Resource content was truncated to prevent memory exhaustion",
          sizeBytes,
        };
      }
    }

    if (leakDetected) {
      return {
        modified: false,
        result,
        warning:
          "High risk: Tool response contains cryptographic private key material",
        sizeBytes,
      };
    }

    return { modified: false, result, sizeBytes };
  }
}
