import { redactSecretsDeep } from "@agent-monitor/core";

export const MAX_RESULT_BYTES = 500 * 1024; // 500 KB limit for single tool result

export interface ResultInspection {
  modified: boolean;
  result: any;
  warning?: string;
  sizeBytes: number;
  secretLeakDetected?: boolean;
  secretType?: string;
  secretTypes?: string[];
}

export class McpResultInspector {
  static inspect(rawResult: any): ResultInspection {
    if (!rawResult) {
      return { modified: false, result: rawResult, sizeBytes: 0 };
    }

    // 1. Redact detected secrets across the entire result structure
    const redaction = redactSecretsDeep(rawResult);
    let result = redaction.value;
    let modified = redaction.hasSecrets;
    const secretLeakDetected = redaction.hasSecrets;
    const detectedType = redaction.types[0];
    const secretTypes = redaction.types;

    // 2. Measure serialized byte size
    const serialized = JSON.stringify(result);
    const sizeBytes = Buffer.byteLength(serialized, "utf8");

    // 3. Truncate oversized results
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
        result = { ...result, content: modifiedContent };
        modified = true;
      } else if (Array.isArray(result.contents)) {
        const modifiedContents = result.contents.map((item: any) => {
          if (typeof item.text === "string" && item.text.length > 10000) {
            return {
              ...item,
              text: item.text.slice(0, 10000) + truncatedNotice,
            };
          }
          return item;
        });
        result = { ...result, contents: modifiedContents };
        modified = true;
      } else {
        result = {
          isError: true,
          content: [
            {
              type: "text",
              text: `[ERROR: Tool result exceeded maximum allowed size of ${MAX_RESULT_BYTES / 1024} KB and could not be safely structured without truncation]`,
            },
          ],
        };
        modified = true;
      }

      // If still exceeding 500KB after text truncation, replace with bounded error content
      if (
        Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_RESULT_BYTES
      ) {
        result = {
          isError: true,
          content: [
            {
              type: "text",
              text: `[ERROR: Tool result exceeded maximum allowed size of ${MAX_RESULT_BYTES / 1024} KB]`,
            },
          ],
        };
        modified = true;
      }

      let warning = "Tool result was truncated to prevent memory exhaustion";
      if (secretLeakDetected) {
        warning += `; also detected and redacted sensitive secrets (${secretTypes.join(", ")})`;
      }

      return {
        modified,
        result,
        warning,
        sizeBytes,
        secretLeakDetected,
        secretType: detectedType,
        secretTypes,
      };
    }

    if (secretLeakDetected) {
      return {
        modified: true,
        result,
        warning:
          detectedType === "PRIVATE_KEY"
            ? "High risk: Tool response contains cryptographic private key material"
            : `High risk: Tool response contains detected credential or secret (${detectedType})`,
        sizeBytes,
        secretLeakDetected: true,
        secretType: detectedType,
        secretTypes,
      };
    }

    return { modified, result, sizeBytes };
  }
}
