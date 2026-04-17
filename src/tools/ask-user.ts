import { input, select, checkbox } from '@inquirer/prompts';
import type { Tool, ToolExecutionContext } from './base.js';
import type { ToolDefinition, ToolResult } from '../types.js';

export class AskUserTool implements Tool {
  definition: ToolDefinition = {
    name: 'ask_user',
    description:
      'Ask the user a question or present a form with options. ' +
      'Use this when you need the user to clarify requirements, select an approach, or provide preferences. ' +
      'It pauses execution, displays the questions in the CLI, and returns the user answers.',
    input_schema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'A list of questions to ask the user.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Unique identifier for the question (used as the key in the response map).',
              },
              type: {
                type: 'string',
                description: 'The type of question (input, select, or checkbox).',
                enum: ['input', 'select', 'checkbox'],
              },
              message: {
                type: 'string',
                description: 'The question text to display to the user.',
              },
              options: {
                type: 'array',
                description: 'List of choices for select or checkbox type questions.',
                items: {
                  type: 'string',
                },
              },
              default: {
                type: 'string',
                description: 'Optional default value.',
              },
            },
            required: ['id', 'type', 'message'],
          },
        },
      },
      required: ['questions'],
    },
  };

  async executeWithContext(inputArg: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const questions = inputArg['questions'] as any[];
    const answers: Record<string, any> = {};

    try {
      for (const q of questions) {
        if (ctx.signal?.aborted) {
          throw new Error('Cancelled by user');
        }

        switch (q.type) {
          case 'input': {
            answers[q.id] = await input({
              message: q.message,
              default: q.default,
            });
            break;
          }
          case 'select': {
            if (!q.options || q.options.length === 0) {
              throw new Error(`Question "${q.id}" of type "select" requires options.`);
            }
            const choices = q.options.map((opt: string) => ({ value: opt }));
            answers[q.id] = await select({
              message: q.message,
              choices,
            });
            break;
          }
          case 'checkbox': {
            if (!q.options || q.options.length === 0) {
              throw new Error(`Question "${q.id}" of type "checkbox" requires options.`);
            }
            const choices = q.options.map((opt: string) => ({ value: opt }));
            answers[q.id] = await checkbox({
              message: q.message,
              choices,
            });
            break;
          }
          default:
            throw new Error(`Unknown question type: ${q.type}`);
        }
      }

      return {
        tool_use_id: '',
        content: JSON.stringify(answers, null, 2),
        is_error: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        tool_use_id: '',
        content: `Error collecting answers: ${msg}`,
        is_error: true,
      };
    }
  }

  async execute(inputArg: Record<string, unknown>): Promise<ToolResult> {
    return this.executeWithContext(inputArg, { depth: 0 });
  }
}
