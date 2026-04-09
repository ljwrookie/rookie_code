import { createPrompt, useState, useKeypress, isEnterKey, isUpKey, isDownKey } from '@inquirer/core';
import chalk from 'chalk';
import type { InquirerReadline } from '@inquirer/type';

const commands = [
  { name: '/help', description: 'Show help' },
  { name: '/clear', description: 'Clear screen' },
  { name: '/commit', description: 'Commit changes' },
];

const replPrompt = createPrompt<string, { message: string }>((config, done) => {
  const [value, setValue] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const isCommand = value.startsWith('/');
  const hasSpace = value.includes(' ');
  const suggestions = (isCommand && !hasSpace)
    ? commands.filter(c => c.name.startsWith(value))
    : [];

  useKeypress((key, rl) => {
    const readline = rl as InquirerReadline & { cursor: number };

    if (isEnterKey(key)) {
      done(value);
    } else if (key.name === 'tab') {
      if (suggestions.length > 0) {
        const suggestion = suggestions[activeIdx].name;
        readline.line = suggestion + ' ';
        readline.cursor = readline.line.length;
        setValue(readline.line);
        setActiveIdx(0);
      }
    } else if (key.name === 'up' || isUpKey(key)) {
      if (suggestions.length > 0) {
        setActiveIdx(prev => (prev > 0 ? prev - 1 : suggestions.length - 1));
      }
    } else if (key.name === 'down' || isDownKey(key)) {
      if (suggestions.length > 0) {
        setActiveIdx(prev => (prev < suggestions.length - 1 ? prev + 1 : 0));
      }
    } else {
      if (value !== readline.line) {
        setValue(readline.line);
        setActiveIdx(0);
      }
    }
  });

  const message = config.message;
  let formattedValue = value;
  
  if (suggestions.length > 0 && activeIdx < suggestions.length) {
    const suggestion = suggestions[activeIdx].name;
    if (suggestion.startsWith(value)) {
      const hint = suggestion.slice(value.length);
      formattedValue = value + chalk.gray(hint);
    }
  }

  let output = `${message}${formattedValue}`;

  if (suggestions.length > 0 && !hasSpace) {
    const list = suggestions.map((s, i) => {
      const prefix = i === activeIdx ? chalk.cyan('❯') : ' ';
      const name = i === activeIdx ? chalk.cyan(s.name) : s.name;
      return `${prefix} ${name}  ${chalk.gray(s.description)}`;
    }).join('\n');
    return [output, list];
  }

  return output;
});

async function main() {
  try {
    const res = await replPrompt({ message: 'test>' });
    console.log('Result:', res);
  } catch (err) {
    console.error(err);
  }
}
main();
