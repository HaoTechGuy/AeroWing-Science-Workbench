function splitShellWords(value: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of value.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping || quote) {
    throw new Error("Invalid SSH command quoting.");
  }
  if (current) {
    words.push(current);
  }
  return words;
}

export function assertSshCommand(value: unknown): string {
  const command = typeof value === "string" ? value.trim() : "";
  const words = splitShellWords(command);
  if (words[0] !== "ssh" || words.length < 2) {
    throw new Error("SSH command must start with ssh and include a host.");
  }
  const optionsWithValue = new Set([
    "-B",
    "-b",
    "-c",
    "-D",
    "-E",
    "-e",
    "-F",
    "-I",
    "-i",
    "-J",
    "-L",
    "-l",
    "-m",
    "-O",
    "-o",
    "-p",
    "-Q",
    "-R",
    "-S",
    "-W",
    "-w",
  ]);
  let destinationIndex = -1;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--") {
      destinationIndex = index + 1 < words.length ? index + 1 : -1;
      break;
    }
    if (word.startsWith("-")) {
      if (optionsWithValue.has(word)) {
        index += 1;
      }
      continue;
    }
    destinationIndex = index;
    break;
  }
  if (destinationIndex < 0) {
    throw new Error("SSH command must include a host.");
  }
  if (destinationIndex !== words.length - 1) {
    throw new Error("SSH command must not include a remote command.");
  }
  return command;
}

export function sshArgsFromCommand(
  sshCommand: string,
  extraOptions: string[] = []
): string[] {
  const [binary, ...args] = splitShellWords(assertSshCommand(sshCommand));
  return [binary, ...extraOptions, ...args];
}
