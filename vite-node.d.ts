declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function writeFile(path: string, data: string): Promise<void>;
}

declare module 'node:path' {
  const path: {
    resolve(...segments: string[]): string;
    join(...segments: string[]): string;
  };
  export default path;
}
