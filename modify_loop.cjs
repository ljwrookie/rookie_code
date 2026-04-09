const fs = require('fs');

let code = fs.readFileSync('src/agent/loop.ts', 'utf-8');

const targetLoop = `      // Execute tools and collect results
      const toolResults: ContentBlock[] = [];
      for (const toolUse of toolUseBlocks) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const result = await this.executeToolCall(toolUse);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result.content,
          is_error: result.is_error,
        });

        this.emit({
          type: 'tool_result',
          data: { name: toolUse.name, result },
        });
      }`;

const replacementLoop = `      // Execute tools and collect results
      const toolResultsPromises = toolUseBlocks.map(async (toolUse) => {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        this.emit({
          type: 'tool_call',
          data: { id: toolUse.id, name: toolUse.name, input: toolUse.input },
        });

        const result = await this.executeToolCall(toolUse);

        this.emit({
          type: 'tool_result',
          data: { name: toolUse.name, result },
        });

        return {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: result.content,
          is_error: result.is_error,
        };
      });

      const toolResults: ContentBlock[] = await Promise.all(toolResultsPromises);`;

const targetStreamEvent = `        case 'tool_use_start': {
          // Flush accumulated text as a text block
          if (currentText) {
            contentBlocks.push({ type: 'text', text: currentText });
            currentText = '';
          }
          if (event.toolCall) {
            this.emit({
              type: 'tool_call',
              data: { id: event.toolCall.id, name: event.toolCall.name },
            });
          }
          break;
        }`;

const replacementStreamEvent = `        case 'tool_use_start': {
          // Flush accumulated text as a text block
          if (currentText) {
            contentBlocks.push({ type: 'text', text: currentText });
            currentText = '';
          }
          break;
        }`;

if (!code.includes(targetLoop)) {
  console.error("Could not find the target loop.");
  process.exit(1);
}

if (!code.includes(targetStreamEvent)) {
  console.error("Could not find the target stream event.");
  process.exit(1);
}

code = code.replace(targetLoop, replacementLoop);
code = code.replace(targetStreamEvent, replacementStreamEvent);

fs.writeFileSync('src/agent/loop.ts', code);
console.log("Successfully modified src/agent/loop.ts");
