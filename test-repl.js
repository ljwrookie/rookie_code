const commands = [
  { name: '/help' },
  { name: '/clear' },
  { name: '/undo' },
  { name: '/diff' },
  { name: '/status' },
  { name: '/compact' },
  { name: '/tokens' },
  { name: '/exit' },
  { name: '/quit' }
];

const getCommandSuggestion = (val) => {
  if (!val.startsWith('/')) return '';
  const spaceIndex = val.indexOf(' ');
  if (spaceIndex !== -1) return '';
  
  const matchedCommand = commands.find(c => c.name.startsWith(val));
  if (matchedCommand) {
    return matchedCommand.name.slice(val.length);
  }
  return '';
};

console.log("'/h':", getCommandSuggestion('/h'));
console.log("'/hel':", getCommandSuggestion('/hel'));
console.log("'/s':", getCommandSuggestion('/s'));
console.log("'/none':", getCommandSuggestion('/none'));
