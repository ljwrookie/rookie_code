import { createPrompt, useState, useKeypress, isEnterKey, isTabKey } from '@inquirer/core';
const testPrompt = createPrompt((config, done) => {
  const [value, setValue] = useState('');
  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      done(value);
    } else if (isTabKey(key)) {
      rl.clearLine(0);
      rl.write('/commit ');
      setValue(rl.line);
    } else {
      setValue(rl.line);
    }
  });
  return ['? ' + value];
});
testPrompt({}).then(console.log);
