import { createPrompt, useState, useKeypress, isEnterKey, isTabKey, isUpKey, isDownKey } from '@inquirer/core';
import chalk from 'chalk';

const replPrompt = createPrompt((config, done) => {
  const [value, setValue] = useState('');

  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      done(value);
    } else if (isUpKey(key)) {
      rl.clearLine(0);
      rl.write('/commit ');
      setValue(rl.line);
    } else {
      setValue(rl.line);
    }
  });

  return ['? ' + value, ''];
});

// We can't run interactive prompt easily in this terminal without getting ExitPromptError,
// but we know the code compiles and `rl.clearLine(0)` is valid in the context of inquirer!
