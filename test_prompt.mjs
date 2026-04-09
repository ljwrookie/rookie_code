import { createPrompt, useState, useKeypress, isEnterKey, isTabKey, isUpKey, isDownKey } from '@inquirer/core';
import chalk from 'chalk';

const replPrompt = createPrompt((config, done) => {
  const [value, setValue] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const commands = ['/help', '/clear', '/commit', '/review'];
  const suggestions = value.startsWith('/') && !value.includes(' ')
    ? commands.filter(c => c.startsWith(value))
    : [];

  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      done(value);
    } else if (isUpKey(key) && suggestions.length > 0) {
      setActiveIdx(Math.max(0, activeIdx - 1));
    } else if (isDownKey(key) && suggestions.length > 0) {
      setActiveIdx(Math.min(suggestions.length - 1, activeIdx + 1));
    } else if (isTabKey(key) && suggestions.length > 0) {
      const suggestion = suggestions[activeIdx];
      // clear readline buffer
      rl.clearLine(0);
      rl.write(suggestion + ' ');
      setValue(rl.line);
      setActiveIdx(0);
    } else {
      setValue(rl.line);
      setActiveIdx(0);
    }
  });

  const promptLine = '? ' + value;
  
  let bottomContent = '';
  if (suggestions.length > 0) {
    bottomContent = suggestions.map((s, i) => 
      i === activeIdx ? chalk.cyan(`> ${s}`) : `  ${s}`
    ).join('\n');
  }

  return [promptLine, bottomContent];
});

replPrompt({}).then(console.log);
